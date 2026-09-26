import { formatDigestDateKo } from "./window";

/** Event types that may appear in a team digest. editor_session is never one of them. */
export const TEAM_EVENT_TYPES = ["commit", "pr_opened", "pr_merged", "pr_closed"] as const;
export type TeamEventType = (typeof TEAM_EVENT_TYPES)[number];

export interface RenderEvent {
  id: string;
  type: string;
  repo: string;
  /** commit title or PR title */
  title?: string;
  prNumber?: number;
}

export interface RenderMember {
  userId: string;
  handle: string;
  optedOut: boolean;
  blockedNote: string | null;
  events: RenderEvent[];
}

export interface RenderInput {
  teamName: string;
  /** YYYY-MM-DD */
  date: string;
  editUrl: string;
  showCommitTitles: boolean;
  members: RenderMember[];
  /** login exists but no registered user */
  unregistered: { login: string; commits: number }[];
  /** commits whose git email is not linked to any GitHub account */
  unlinkedCommits: number;
}

export interface EmbedField {
  name: string;
  value: string;
  inline: boolean;
}

export interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
  fields: EmbedField[];
}

export const LIMITS = { fieldValue: 1024, fieldName: 256, fields: 25, total: 6000, title: 256, description: 4096 };

export class DigestTooLargeError extends Error {
  constructor(public readonly fieldCount: number) {
    super(`digest needs ${fieldCount} fields; Discord allows ${LIMITS.fields}`);
    this.name = "DigestTooLargeError";
  }
}

export function isTeamEvent(e: { type: string }): boolean {
  return (TEAM_EVENT_TYPES as readonly string[]).includes(e.type);
}

/** 전원 "기록 없음"이면 발행하지 않는다. */
export function shouldSkip(members: Pick<RenderMember, "events" | "blockedNote">[]): boolean {
  return members.every((m) => m.events.filter(isTeamEvent).length === 0 && !m.blockedNote?.trim());
}

interface RepoGroup {
  repo: string;
  commits: RenderEvent[];
  prs: RenderEvent[];
}

function groupByRepo(events: RenderEvent[]): RepoGroup[] {
  const map = new Map<string, RepoGroup>();
  for (const e of events) {
    if (!isTeamEvent(e)) continue;
    let g = map.get(e.repo);
    if (!g) {
      g = { repo: e.repo, commits: [], prs: [] };
      map.set(e.repo, g);
    }
    if (e.type === "commit") g.commits.push(e);
    else g.prs.push(e);
  }
  return [...map.values()];
}

function prLabel(e: RenderEvent): string {
  const n = e.prNumber !== undefined ? `#${e.prNumber}` : "";
  switch (e.type) {
    case "pr_merged":
      return `PR ${n} 머지`;
    case "pr_opened":
      return `PR ${n} 열림`;
    case "pr_closed":
      return `PR ${n} 닫힘`;
    default:
      return `PR ${n}`;
  }
}

function shortRepo(full: string): string {
  const i = full.indexOf("/");
  return i >= 0 ? full.slice(i + 1) : full;
}

function memberValue(m: RenderMember, showCommitTitles: boolean, maxTitles: number): string {
  if (m.optedOut) return "(발행 안 함)";
  const groups = groupByRepo(m.events);
  const lines: string[] = [];
  if (groups.length === 0) {
    lines.push("(기록 없음)");
  }
  for (const g of groups) {
    const parts = [shortRepo(g.repo)];
    if (g.commits.length) parts.push(`커밋 ${g.commits.length}`);
    for (const pr of g.prs) parts.push(prLabel(pr));
    lines.push(parts.join(" · "));
    if (showCommitTitles && g.commits.length && maxTitles > 0) {
      const titles = g.commits.map((c) => (c.title ?? "").split("\n")[0].trim()).filter(Boolean);
      const shown = titles.slice(0, maxTitles);
      const rest = titles.length - shown.length;
      if (shown.length) lines.push(`  ${shown.join(" / ")}${rest > 0 ? ` / +${rest}` : ""}`);
    }
  }
  if (m.blockedNote?.trim()) lines.push(`⛔ 막힘: ${m.blockedNote.trim()}`);
  return lines.join("\n");
}

function fitValue(m: RenderMember, showCommitTitles: boolean): string {
  for (let maxTitles = 3; maxTitles >= 0; maxTitles--) {
    const v = memberValue(m, showCommitTitles, maxTitles);
    if (v.length <= LIMITS.fieldValue) return v;
  }
  const v = memberValue(m, false, 0);
  return v.length <= LIMITS.fieldValue ? v : `${v.slice(0, LIMITS.fieldValue - 2)} …`;
}

function embedLength(e: DiscordEmbed): number {
  return e.title.length + e.description.length + e.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
}

/** Build the single Discord embed for a team digest (렌더링 근사 → 실제 임베드). */
export function renderDigestEmbed(input: RenderInput): DiscordEmbed {
  const fields: EmbedField[] = input.members.map((m) => ({
    name: m.handle.slice(0, LIMITS.fieldName),
    value: fitValue(m, input.showCommitTitles),
    inline: false,
  }));

  const unknownLines: string[] = [];
  for (const u of input.unregistered) unknownLines.push(`미가입: @${u.login} ${u.commits} commits`);
  if (input.unlinkedCommits > 0) unknownLines.push(`이메일 미연결: ${input.unlinkedCommits} commits`);
  if (unknownLines.length) {
    let v = unknownLines.join("\n");
    if (v.length > LIMITS.fieldValue) v = `${v.slice(0, LIMITS.fieldValue - 2)} …`;
    fields.push({ name: "미확인 기여자", value: v, inline: false });
  }

  if (fields.length > LIMITS.fields) throw new DigestTooLargeError(fields.length);

  const embed: DiscordEmbed = {
    title: `📋 ${input.teamName} · ${formatDigestDateKo(input.date)} 다이제스트`.slice(0, LIMITS.title),
    description: `발행 후 60분 안에 편집 → ${input.editUrl}`,
    color: 0x5b7fff,
    fields,
  };

  // Total budget: shrink the longest field values until the embed fits.
  let guard = 0;
  while (embedLength(embed) > LIMITS.total && guard++ < 100) {
    const over = embedLength(embed) - LIMITS.total;
    const longest = embed.fields.reduce((a, b) => (b.value.length > a.value.length ? b : a), embed.fields[0]);
    if (!longest || longest.value.length <= 16) break;
    const target = Math.max(16, longest.value.length - over - 2);
    longest.value = `${longest.value.slice(0, target)} …`;
  }
  return embed;
}
