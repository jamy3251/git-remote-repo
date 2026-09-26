import { and, eq, gte, inArray, lt } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";
import { decryptSecret, newId } from "@/lib/crypto";
import { canEditDigestRow } from "@/lib/authz";
import { patchWebhookMessage, postWebhook, WebhookInvalidError, type FetchLike } from "@/lib/discord";
import { commitDedupKey } from "@/lib/github/webhook";
import { isTeamEvent, renderDigestEmbed, shouldSkip, type RenderEvent, type RenderMember } from "./render";
import { digestDayBounds, editWindowOpen } from "./window";

export interface CompareCommit {
  sha: string;
  title: string;
  login: string | null;
  authoredAt: string | null;
}

/** Injectable Compare API fetch (repo, before, after) → commits. Default: GitHub REST via installation token resolver. */
export type CompareFetch = (repo: string, before: string, after: string) => Promise<CompareCommit[]>;

export interface PipelineDeps {
  now?: Date;
  fetchImpl?: FetchLike;
  compareFetch?: CompareFetch;
  /** Public base URL used for the edit link, e.g. https://devhub.example */
  baseUrl: string;
}

export class DigestNotFoundError extends Error {
  name = "DigestNotFoundError";
}
export class ForbiddenError extends Error {
  name = "ForbiddenError";
}
export class EditWindowClosedError extends Error {
  name = "EditWindowClosedError";
}

export interface DigestView {
  digest: typeof schema.digests.$inferSelect;
  team: typeof schema.teams.$inferSelect;
  members: (RenderMember & { allEvents: (RenderEvent & { included: boolean })[] })[];
  unregistered: { login: string; commits: number }[];
  unlinkedCommits: number;
}

interface TeamContext {
  team: typeof schema.teams.$inferSelect;
  members: { userId: string; handle: string; logins: string[] }[];
  repos: string[];
}

async function loadTeamContext(db: Db, teamId: string): Promise<TeamContext | null> {
  const [team] = await db.select().from(schema.teams).where(eq(schema.teams.id, teamId)).limit(1);
  if (!team) return null;
  const rows = await db
    .select({
      userId: schema.teamMembers.userId,
      handle: schema.users.handle,
      login: schema.identities.githubLogin,
    })
    .from(schema.teamMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.teamMembers.userId))
    .leftJoin(
      schema.identities,
      and(eq(schema.identities.userId, schema.users.id), eq(schema.identities.provider, "github")),
    )
    .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.status, "active")));
  const byUser = new Map<string, { userId: string; handle: string; logins: string[] }>();
  for (const r of rows) {
    const m = byUser.get(r.userId) ?? { userId: r.userId, handle: r.handle, logins: [] };
    if (r.login) m.logins.push(r.login.toLowerCase());
    byUser.set(r.userId, m);
  }
  const repos = (
    await db
      .select({ repo: schema.teamRepos.repoFullName })
      .from(schema.teamRepos)
      .where(and(eq(schema.teamRepos.teamId, teamId), eq(schema.teamRepos.active, true)))
  ).map((r) => r.repo);
  return { team, members: [...byUser.values()], repos };
}

function toRenderEvent(e: typeof schema.activityEvents.$inferSelect): RenderEvent {
  const p = e.payloadJson as { title?: string; number?: number };
  return { id: e.id, type: e.type, repo: e.repo ?? "", title: p.title, prNumber: p.number };
}

/** Compare-API backfill for pushes that carried more than 20 commits. Runs inside the 21:00 cron only. */
async function backfill(db: Db, repos: string[], start: Date, end: Date, compareFetch: CompareFetch | undefined, now: Date) {
  if (!compareFetch || repos.length === 0) return;
  const flagged = await db
    .select()
    .from(schema.activityEvents)
    .where(
      and(
        inArray(schema.activityEvents.repo, repos),
        eq(schema.activityEvents.needsBackfill, true),
        gte(schema.activityEvents.tsReceived, start),
        lt(schema.activityEvents.tsReceived, end),
      ),
    );
  for (const ev of flagged) {
    const cmp = (ev.payloadJson as { compare?: { before?: string; after?: string } }).compare;
    if (cmp?.before && cmp.after && ev.repo) {
      try {
        const commits = await compareFetch(ev.repo, cmp.before, cmp.after);
        for (const c of commits) {
          await db
            .insert(schema.activityEvents)
            .values({
              id: newId("ev"),
              githubLogin: c.login,
              sourceKind: "github",
              type: "commit",
              tsReceived: ev.tsReceived,
              tsAuthored: c.authoredAt ? new Date(c.authoredAt) : null,
              repo: ev.repo,
              payloadJson: { sha: c.sha, title: c.title, backfilled: true, at: now.toISOString() },
              dedupKey: commitDedupKey(ev.repo, c.sha),
            })
            .onConflictDoNothing();
        }
      } catch {
        // Leave the flag set; next manual trigger retries.
        continue;
      }
    }
    await db.update(schema.activityEvents).set({ needsBackfill: false }).where(eq(schema.activityEvents.id, ev.id));
  }
}

/** Attribute the day's events to members; returns the render members plus unknown-contributor buckets. */
async function collectDay(db: Db, ctx: TeamContext, start: Date, end: Date) {
  const events =
    ctx.repos.length === 0
      ? []
      : await db
          .select()
          .from(schema.activityEvents)
          .where(
            and(
              inArray(schema.activityEvents.repo, ctx.repos),
              gte(schema.activityEvents.tsReceived, start),
              lt(schema.activityEvents.tsReceived, end),
              inArray(schema.activityEvents.type, ["commit", "pr_opened", "pr_merged", "pr_closed"]),
            ),
          );
  const loginToUser = new Map<string, string>();
  for (const m of ctx.members) for (const l of m.logins) loginToUser.set(l, m.userId);
  const perUser = new Map<string, (typeof events)[number][]>();
  const unregistered = new Map<string, number>();
  let unlinkedCommits = 0;
  for (const e of events) {
    if (!isTeamEvent(e)) continue;
    const login = e.githubLogin?.toLowerCase() ?? null;
    if (!login) {
      if (e.type === "commit") unlinkedCommits++;
      continue;
    }
    const uid = loginToUser.get(login);
    if (!uid) {
      if (e.type === "commit") unregistered.set(e.githubLogin!, (unregistered.get(e.githubLogin!) ?? 0) + 1);
      continue;
    }
    perUser.set(uid, [...(perUser.get(uid) ?? []), e]);
  }
  return {
    perUser,
    unregistered: [...unregistered.entries()].map(([login, commits]) => ({ login, commits })),
    unlinkedCommits,
  };
}

export interface RunResult {
  digestId: string;
  status: "published" | "skipped" | "failed";
  error?: string;
}

/** 21:00 cron body for one team: backfill → draft → publish (or skip / fail). Re-running a date replaces the draft. */
export async function runDigestForTeam(db: Db, teamId: string, date: string, deps: PipelineDeps): Promise<RunResult> {
  const now = deps.now ?? new Date();
  const ctx = await loadTeamContext(db, teamId);
  if (!ctx) throw new DigestNotFoundError(`team ${teamId}`);
  const { start, end } = digestDayBounds(date);

  await backfill(db, ctx.repos, start, end, deps.compareFetch, now);
  const day = await collectDay(db, ctx, start, end);

  // Replace any previous digest for this team/date (manual re-trigger).
  await db.delete(schema.digests).where(and(eq(schema.digests.teamId, teamId), eq(schema.digests.date, date)));
  const digestId = newId("d");

  const members: RenderMember[] = ctx.members.map((m) => ({
    userId: m.userId,
    handle: m.handle,
    optedOut: false,
    blockedNote: null,
    events: (day.perUser.get(m.userId) ?? []).map(toRenderEvent),
  }));

  if (shouldSkip(members) && day.unregistered.length === 0 && day.unlinkedCommits === 0) {
    await db.insert(schema.digests).values({ id: digestId, teamId, date, status: "skipped" });
    return { digestId, status: "skipped" };
  }

  await db.insert(schema.digests).values({ id: digestId, teamId, date, status: "draft" });
  if (members.length) {
    await db.insert(schema.digestMembers).values(members.map((m) => ({ digestId, userId: m.userId, optedOut: false })));
  }
  const itemRows = members.flatMap((m) => m.events.map((e) => ({ digestId, eventId: e.id, included: true })));
  if (itemRows.length) await db.insert(schema.digestItems).values(itemRows);

  const embed = renderDigestEmbed({
    teamName: ctx.team.name,
    date,
    editUrl: `${deps.baseUrl}/d/${digestId}`,
    showCommitTitles: ctx.team.showCommitTitles,
    members,
    unregistered: day.unregistered,
    unlinkedCommits: day.unlinkedCommits,
  });

  try {
    const url = decryptSecret(ctx.team.discordWebhookUrlEnc);
    const messageId = await postWebhook(url, embed, deps.fetchImpl);
    await db
      .update(schema.digests)
      .set({ status: "published", publishedAt: now, discordMessageId: messageId })
      .where(eq(schema.digests.id, digestId));
    if (ctx.team.webhookInvalid) await db.update(schema.teams).set({ webhookInvalid: false }).where(eq(schema.teams.id, teamId));
    return { digestId, status: "published" };
  } catch (e) {
    await db.update(schema.digests).set({ status: "failed" }).where(eq(schema.digests.id, digestId));
    if (e instanceof WebhookInvalidError) {
      await db.update(schema.teams).set({ webhookInvalid: true }).where(eq(schema.teams.id, teamId));
    }
    return { digestId, status: "failed", error: (e as Error).message };
  }
}

/** Everything the edit page and the re-render need for one digest. */
export async function loadDigestView(db: Db, digestId: string): Promise<DigestView | null> {
  const [digest] = await db.select().from(schema.digests).where(eq(schema.digests.id, digestId)).limit(1);
  if (!digest) return null;
  const ctx = await loadTeamContext(db, digest.teamId);
  if (!ctx) return null;
  const memberRows = await db.select().from(schema.digestMembers).where(eq(schema.digestMembers.digestId, digestId));
  const items = await db
    .select({
      eventId: schema.digestItems.eventId,
      included: schema.digestItems.included,
      event: schema.activityEvents,
    })
    .from(schema.digestItems)
    .innerJoin(schema.activityEvents, eq(schema.activityEvents.id, schema.digestItems.eventId))
    .where(eq(schema.digestItems.digestId, digestId));

  const loginToUser = new Map<string, string>();
  for (const m of ctx.members) for (const l of m.logins) loginToUser.set(l, m.userId);
  const perUser = new Map<string, (RenderEvent & { included: boolean })[]>();
  for (const it of items) {
    const uid = it.event.githubLogin ? loginToUser.get(it.event.githubLogin.toLowerCase()) : undefined;
    if (!uid) continue;
    perUser.set(uid, [...(perUser.get(uid) ?? []), { ...toRenderEvent(it.event), included: it.included }]);
  }

  const { start, end } = digestDayBounds(digest.date);
  const day = await collectDay(db, ctx, start, end);

  const members = memberRows.map((row) => {
    const m = ctx.members.find((x) => x.userId === row.userId);
    const allEvents = perUser.get(row.userId) ?? [];
    return {
      userId: row.userId,
      handle: m?.handle ?? "탈퇴한 사용자",
      optedOut: row.optedOut,
      blockedNote: row.blockedNote,
      allEvents,
      events: allEvents.filter((e) => e.included),
    };
  });
  return { digest, team: ctx.team, members, unregistered: day.unregistered, unlinkedCommits: day.unlinkedCommits };
}

export interface RowPatch {
  excludedEventIds?: string[];
  blockedNote?: string | null;
  optedOut?: boolean;
}

/** 본인 행만, 60분 안에만. 저장 후 같은 디스코드 메시지를 PATCH로 갱신한다. */
export async function updateDigestRow(
  db: Db,
  userId: string,
  digestId: string,
  patch: RowPatch,
  deps: PipelineDeps,
): Promise<void> {
  const now = deps.now ?? new Date();
  const view = await loadDigestView(db, digestId);
  if (!view) throw new DigestNotFoundError(digestId);
  const row = view.members.find((m) => m.userId === userId);
  if (!row) throw new ForbiddenError("not a row owner");
  if (view.digest.status !== "published") throw new EditWindowClosedError("digest not published");
  if (!editWindowOpen(view.digest.publishedAt, now)) throw new EditWindowClosedError("edit window closed");
  if (!canEditDigestRow({ id: userId }, row.userId, view.digest.publishedAt, now)) throw new ForbiddenError("own row only");

  const ownEventIds = new Set(row.allEvents.map((e) => e.id));
  const excluded = (patch.excludedEventIds ?? []).filter((id) => ownEventIds.has(id));
  if (patch.excludedEventIds !== undefined) {
    // reset then apply so the client can send the full excluded set
    for (const e of row.allEvents) {
      await db
        .update(schema.digestItems)
        .set({ included: !excluded.includes(e.id) })
        .where(and(eq(schema.digestItems.digestId, digestId), eq(schema.digestItems.eventId, e.id)));
    }
  }
  const memberSet: Partial<typeof schema.digestMembers.$inferInsert> = {};
  if (patch.blockedNote !== undefined) memberSet.blockedNote = patch.blockedNote?.trim() ? patch.blockedNote.trim().slice(0, 300) : null;
  if (patch.optedOut !== undefined) memberSet.optedOut = patch.optedOut;
  if (Object.keys(memberSet).length) {
    await db
      .update(schema.digestMembers)
      .set(memberSet)
      .where(and(eq(schema.digestMembers.digestId, digestId), eq(schema.digestMembers.userId, userId)));
  }

  const fresh = await loadDigestView(db, digestId);
  if (!fresh || !fresh.digest.discordMessageId) return;
  const embed = renderDigestEmbed({
    teamName: fresh.team.name,
    date: fresh.digest.date,
    editUrl: `${deps.baseUrl}/d/${digestId}`,
    showCommitTitles: fresh.team.showCommitTitles,
    members: fresh.members,
    unregistered: fresh.unregistered,
    unlinkedCommits: fresh.unlinkedCommits,
  });
  const url = decryptSecret(fresh.team.discordWebhookUrlEnc);
  await patchWebhookMessage(url, fresh.digest.discordMessageId, embed, deps.fetchImpl);
}
