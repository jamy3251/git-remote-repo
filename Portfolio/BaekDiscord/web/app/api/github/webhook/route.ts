import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/crypto";
import {
  parsePullRequestEvent,
  parsePushEvent,
  verifySignature,
  type ParsedEvent,
  type PullRequestPayload,
  type PushPayload,
} from "@/lib/github/webhook";

export const dynamic = "force-dynamic";

interface InstallationPayload {
  action?: string;
  installation?: { id?: number };
  repositories?: { full_name: string }[];
  repositories_added?: { full_name: string }[];
  repositories_removed?: { full_name: string }[];
}

async function insertEvents(events: ParsedEvent[], receivedAt: Date) {
  if (!events.length) return 0;
  const db = await getDb();
  let inserted = 0;
  for (const e of events) {
    const r = await db
      .insert(schema.activityEvents)
      .values({
        id: newId("ev"),
        githubLogin: e.githubLogin,
        sourceKind: "github",
        type: e.type,
        tsReceived: receivedAt,
        tsAuthored: e.tsAuthored,
        repo: e.repo,
        payloadJson: e.payloadJson,
        dedupKey: e.dedupKey,
        needsBackfill: e.needsBackfill,
      })
      .onConflictDoNothing()
      .returning({ id: schema.activityEvents.id });
    inserted += r.length;
  }
  return inserted;
}

async function handleInstallation(event: string, payload: InstallationPayload) {
  const db = await getDb();
  const ghId = payload.installation?.id;
  if (!ghId) return;
  const [inst] = await db
    .select()
    .from(schema.installations)
    .where(eq(schema.installations.githubInstallationId, ghId))
    .limit(1);
  if (event === "installation" && payload.action === "deleted") {
    if (inst) {
      await db.update(schema.installations).set({ active: false }).where(eq(schema.installations.id, inst.id));
      await db.update(schema.teamRepos).set({ active: false }).where(eq(schema.teamRepos.installationId, inst.id));
    }
    return;
  }
  if (!inst?.teamId) return; // not yet mapped to a team (callback page does that)
  const added = payload.repositories_added ?? (event === "installation" ? payload.repositories : undefined) ?? [];
  for (const r of added) {
    await db
      .insert(schema.teamRepos)
      .values({ teamId: inst.teamId, repoFullName: r.full_name, installationId: inst.id, active: true })
      .onConflictDoUpdate({
        target: [schema.teamRepos.teamId, schema.teamRepos.repoFullName],
        set: { active: true, installationId: inst.id },
      });
  }
  for (const r of payload.repositories_removed ?? []) {
    await db
      .update(schema.teamRepos)
      .set({ active: false })
      .where(eq(schema.teamRepos.repoFullName, r.full_name));
  }
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const secret = process.env.GITHUB_WEBHOOK_SECRET ?? "";
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"), secret)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  const delivery = req.headers.get("x-github-delivery");
  const event = req.headers.get("x-github-event") ?? "";
  if (!delivery) return NextResponse.json({ error: "missing delivery id" }, { status: 400 });

  const db = await getDb();
  const receivedAt = new Date();
  const dedup = await db
    .insert(schema.webhookDeliveries)
    .values({ deliveryId: delivery, receivedAt })
    .onConflictDoNothing()
    .returning({ id: schema.webhookDeliveries.deliveryId });
  if (dedup.length === 0) return NextResponse.json({ ok: true, duplicate: true });

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  switch (event) {
    case "push": {
      const { events } = parsePushEvent(payload as PushPayload);
      const inserted = await insertEvents(events, receivedAt);
      return NextResponse.json({ ok: true, inserted });
    }
    case "pull_request": {
      const e = parsePullRequestEvent(payload as PullRequestPayload);
      const inserted = await insertEvents(e ? [e] : [], receivedAt);
      return NextResponse.json({ ok: true, inserted });
    }
    case "installation":
    case "installation_repositories":
      await handleInstallation(event, payload as InstallationPayload);
      return NextResponse.json({ ok: true });
    default:
      return NextResponse.json({ ok: true, ignored: event });
  }
}
