import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, schema, type Db } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { EditWindowClosedError, ForbiddenError, runDigestForTeam, updateDigestRow, loadDigestView } from "@/lib/digest/pipeline";
import { upsertGitHubUser } from "@/lib/auth/github";

let db: Db;

const WEBHOOK = "https://discord.com/api/webhooks/123/abc";

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function fakeFetch(behaviour: { status?: number } = {}): { calls: Call[]; fetch: typeof fetch } {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    const status = behaviour.status ?? 200;
    return new Response(status === 200 ? JSON.stringify({ id: "msg_1" }) : "err", {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { calls, fetch: impl };
}

let seq = 0;

/** Each seeded team gets its own repo so tests sharing the in-memory DB stay isolated. */
async function seedTeam(name = "캡스톤팀") {
  const suffix = `${name}${++seq}`;
  const teamId = `t_${suffix}`;
  const repo = `team/runclue-app-${suffix}`;
  await db.insert(schema.teams).values({ id: teamId, name, discordWebhookUrlEnc: encryptSecret(WEBHOOK), showCommitTitles: true });
  const { userId: minsu } = await upsertGitHubUser(db, { id: 1001, login: "minsu" });
  const { userId: jamy } = await upsertGitHubUser(db, { id: 1002, login: "jamy" });
  await db.insert(schema.teamMembers).values([
    { teamId, userId: minsu, role: "lead" },
    { teamId, userId: jamy, role: "member" },
  ]);
  await db.insert(schema.teamRepos).values({ teamId, repoFullName: repo });
  const seedEvent = async (over: Partial<typeof schema.activityEvents.$inferInsert> & { id: string }) => {
    const id = `${over.id}_${suffix}`;
    await db.insert(schema.activityEvents).values({
      githubLogin: "minsu",
      sourceKind: "github",
      type: "commit",
      tsReceived: new Date("2026-09-22T05:00:00Z"), // 14:00 KST → 2026-09-22 digest
      repo,
      payloadJson: { title: `feat: ${over.id}` },
      dedupKey: `${repo}+${id}`,
      ...over,
      id,
    });
  };
  return { teamId, minsu, jamy, repo, seedEvent };
}

beforeAll(async () => {
  db = await createTestDb();
});

describe("db (in-memory PGlite)", () => {
  it("applies migrations and round-trips a team + digest", async () => {
    const { teamId } = await seedTeam("smoke");
    await db.insert(schema.digests).values({ id: "d_smoke", teamId, date: "2026-09-22", status: "skipped" });
    const [row] = await db.select().from(schema.digests).where(eq(schema.digests.id, "d_smoke"));
    expect(row.teamId).toBe(teamId);
    expect(row.status).toBe("skipped");
    const [team] = await db.select().from(schema.teams).where(eq(schema.teams.id, teamId));
    expect(decryptSecret(team.discordWebhookUrlEnc)).toBe(WEBHOOK);
  });

  it("re-login refreshes the github login without creating a second user", async () => {
    await upsertGitHubUser(db, { id: 5555, login: "old-name" });
    const again = await upsertGitHubUser(db, { id: 5555, login: "new-name" });
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, again.userId));
    expect(u.handle).toBe("new-name");
    const idents = await db.select().from(schema.identities).where(eq(schema.identities.externalId, "5555"));
    expect(idents).toHaveLength(1);
    expect(idents[0].githubLogin).toBe("new-name");
  });
});

describe("runDigestForTeam", () => {
  it("skips when every member has no record", async () => {
    const { teamId } = await seedTeam("empty");
    const r = await runDigestForTeam(db, teamId, "2026-09-22", { baseUrl: "https://devhub.test", fetchImpl: fakeFetch().fetch });
    expect(r.status).toBe("skipped");
  });

  it("publishes with ?wait=true, stores the message id, and separates unknown contributors", async () => {
    const { teamId, seedEvent, repo } = await seedTeam("pub");
    await seedEvent({ id: "sha_a" });
    await seedEvent({ id: "sha_b", githubLogin: "seojin" }); // 미가입
    await seedEvent({ id: "sha_c", githubLogin: null }); // 이메일 미연결
    await seedEvent({ id: "sha_late", tsReceived: new Date("2026-09-22T12:00:00Z") }); // 21:00 KST → 다음 날
    await seedEvent({ id: "ed_1", type: "editor_session", sourceKind: "editor" }); // never in team digest
    const f = fakeFetch();
    const now = new Date("2026-09-22T12:00:30Z");
    const r = await runDigestForTeam(db, teamId, "2026-09-22", { baseUrl: "https://devhub.test", fetchImpl: f.fetch, now });
    expect(r.status).toBe("published");
    expect(f.calls[0].url).toBe(`${WEBHOOK}?wait=true`);
    const embed = (f.calls[0].body as { embeds: { fields: { name: string; value: string }[]; description: string }[] }).embeds[0];
    expect(embed.description).toContain(`https://devhub.test/d/${r.digestId}`);
    const byName = Object.fromEntries(embed.fields.map((x) => [x.name, x.value]));
    expect(byName.minsu).toContain(`${repo.split("/")[1]} · 커밋 1`);
    expect(byName.minsu).toContain("feat: sha_a");
    expect(byName.minsu).not.toContain("sha_late");
    expect(byName.jamy).toBe("(기록 없음)");
    expect(byName["미확인 기여자"]).toContain("미가입: @seojin 1 commits");
    expect(byName["미확인 기여자"]).toContain("이메일 미연결: 1 commits");
    expect(JSON.stringify(embed)).not.toContain("ed_1");
    const [d] = await db.select().from(schema.digests).where(eq(schema.digests.id, r.digestId));
    expect(d.discordMessageId).toBe("msg_1");
    expect(d.publishedAt?.toISOString()).toBe(now.toISOString());
  });

  it("marks failed + webhook invalid on 404 and recovers on the next success", async () => {
    const { teamId, seedEvent } = await seedTeam("fail");
    await seedEvent({ id: "sha_f" });
    const r = await runDigestForTeam(db, teamId, "2026-09-22", { baseUrl: "https://x", fetchImpl: fakeFetch({ status: 404 }).fetch });
    expect(r.status).toBe("failed");
    let [team] = await db.select().from(schema.teams).where(eq(schema.teams.id, teamId));
    expect(team.webhookInvalid).toBe(true);
    const r2 = await runDigestForTeam(db, teamId, "2026-09-22", { baseUrl: "https://x", fetchImpl: fakeFetch().fetch });
    expect(r2.status).toBe("published");
    [team] = await db.select().from(schema.teams).where(eq(schema.teams.id, teamId));
    expect(team.webhookInvalid).toBe(false);
    const digestsForDate = await db.select().from(schema.digests).where(eq(schema.digests.teamId, teamId));
    expect(digestsForDate).toHaveLength(1); // re-trigger replaces
  });
});

describe("updateDigestRow", () => {
  async function publishedDigest() {
    const seeded = await seedTeam("edit");
    await seeded.seedEvent({ id: "e1" });
    await seeded.seedEvent({ id: "e2" });
    await seeded.seedEvent({ id: "e_jamy", githubLogin: "jamy" });
    const publishedAt = new Date("2026-09-22T12:00:30Z");
    const r = await runDigestForTeam(db, seeded.teamId, "2026-09-22", { baseUrl: "https://x", fetchImpl: fakeFetch().fetch, now: publishedAt });
    expect(r.status).toBe("published");
    return { ...seeded, digestId: r.digestId, publishedAt };
  }

  it("lets a member edit own row and PATCHes the same message", async () => {
    const { digestId, minsu, publishedAt } = await publishedDigest();
    const view0 = await loadDigestView(db, digestId);
    const ownIds = view0!.members.find((m) => m.userId === minsu)!.allEvents.map((e) => e.id);
    expect(ownIds).toHaveLength(2);
    const f = fakeFetch();
    await updateDigestRow(
      db,
      minsu,
      digestId,
      { excludedEventIds: [ownIds[0]], blockedNote: "카카오 키 대기" },
      { baseUrl: "https://x", fetchImpl: f.fetch, now: new Date(publishedAt.getTime() + 10 * 60_000) },
    );
    expect(f.calls[0].method).toBe("PATCH");
    expect(f.calls[0].url).toBe(`${WEBHOOK}/messages/msg_1`);
    const embed = (f.calls[0].body as { embeds: { fields: { name: string; value: string }[] }[] }).embeds[0];
    const minsuField = embed.fields.find((x) => x.name === "minsu")!;
    expect(minsuField.value).toContain("커밋 1");
    expect(minsuField.value).toContain("⛔ 막힘: 카카오 키 대기");
  });

  it("cannot exclude another member's events (silently ignored) and lead has no exception", async () => {
    const { digestId, minsu, jamy, publishedAt } = await publishedDigest();
    const view0 = await loadDigestView(db, digestId);
    const jamyIds = view0!.members.find((m) => m.userId === jamy)!.allEvents.map((e) => e.id);
    const f = fakeFetch();
    // minsu (lead) tries to exclude jamy's event via own-row PATCH → ignored
    await updateDigestRow(db, minsu, digestId, { excludedEventIds: jamyIds }, { baseUrl: "https://x", fetchImpl: f.fetch, now: new Date(publishedAt.getTime() + 60_000) });
    const view1 = await loadDigestView(db, digestId);
    expect(view1!.members.find((m) => m.userId === jamy)!.events).toHaveLength(1);
  });

  it("rejects non-members (403) and late edits (409)", async () => {
    const { digestId, minsu, publishedAt } = await publishedDigest();
    const { userId: outsider } = await upsertGitHubUser(db, { id: 9999, login: "outsider" });
    await expect(
      updateDigestRow(db, outsider, digestId, { optedOut: true }, { baseUrl: "https://x", fetchImpl: fakeFetch().fetch, now: new Date(publishedAt.getTime() + 60_000) }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      updateDigestRow(db, minsu, digestId, { optedOut: true }, { baseUrl: "https://x", fetchImpl: fakeFetch().fetch, now: new Date(publishedAt.getTime() + 61 * 60_000) }),
    ).rejects.toBeInstanceOf(EditWindowClosedError);
  });

  it("opt-out renders (발행 안 함)", async () => {
    const { digestId, minsu, publishedAt } = await publishedDigest();
    const f = fakeFetch();
    await updateDigestRow(db, minsu, digestId, { optedOut: true }, { baseUrl: "https://x", fetchImpl: f.fetch, now: new Date(publishedAt.getTime() + 60_000) });
    const embed = (f.calls[0].body as { embeds: { fields: { name: string; value: string }[] }[] }).embeds[0];
    expect(embed.fields.find((x) => x.name === "minsu")!.value).toBe("(발행 안 함)");
  });
});
