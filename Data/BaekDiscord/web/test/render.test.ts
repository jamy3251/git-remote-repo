import { describe, expect, it } from "vitest";
import { DigestTooLargeError, LIMITS, renderDigestEmbed, shouldSkip, type RenderInput, type RenderMember } from "@/lib/digest/render";

const member = (over: Partial<RenderMember> & { handle: string }): RenderMember => ({
  userId: `u_${over.handle}`,
  optedOut: false,
  blockedNote: null,
  events: [],
  ...over,
});

const base = (members: RenderMember[], over: Partial<RenderInput> = {}): RenderInput => ({
  teamName: "캡스톤팀",
  date: "2026-09-22",
  editUrl: "https://devhub.test/d/abc",
  showCommitTitles: true,
  members,
  unregistered: [],
  unlinkedCommits: 0,
  ...over,
});

const commit = (i: number, repo = "team/runclue-app", title = `feat: 작업 ${i}`) => ({
  id: `c${i}`,
  type: "commit",
  repo,
  title,
});

describe("renderDigestEmbed", () => {
  it("renders the design example shape", () => {
    const embed = renderDigestEmbed(
      base([
        member({
          handle: "minsu",
          events: [commit(1, "team/runclue-app", "feat: 지도 클러스터링"), commit(2, "team/runclue-app", "fix: 마커 겹침"), commit(3), commit(4), { id: "p1", type: "pr_merged", repo: "team/runclue-app", prNumber: 31 }],
        }),
        member({ handle: "jamy", events: [commit(5, "team/runclue-app", "fix: 로그인 리다이렉트"), commit(6)], blockedNote: "카카오 로그인 키 승인 대기" }),
        member({ handle: "yuna", optedOut: true, events: [commit(7)] }),
        member({ handle: "dohyun" }),
      ]),
    );
    expect(embed.title).toBe("📋 캡스톤팀 · 9/22 (화) 다이제스트");
    expect(embed.description).toContain("발행 후 60분 안에 편집");
    expect(embed.description).toContain("https://devhub.test/d/abc");
    expect(embed.fields).toHaveLength(4);
    const [minsu, jamy, yuna, dohyun] = embed.fields;
    expect(minsu.name).toBe("minsu");
    expect(minsu.value).toContain("runclue-app · 커밋 4 · PR #31 머지");
    expect(minsu.value).toContain("feat: 지도 클러스터링 / fix: 마커 겹침 / feat: 작업 3 / +1");
    expect(jamy.value).toContain("⛔ 막힘: 카카오 로그인 키 승인 대기");
    expect(yuna.value).toBe("(발행 안 함)");
    expect(dohyun.value).toBe("(기록 없음)");
  });

  it("separates unregistered logins from unlinked emails", () => {
    const embed = renderDigestEmbed(
      base([member({ handle: "a", events: [commit(1)] })], {
        unregistered: [{ login: "seojin", commits: 2 }],
        unlinkedCommits: 3,
      }),
    );
    const last = embed.fields[embed.fields.length - 1];
    expect(last.name).toBe("미확인 기여자");
    expect(last.value).toContain("미가입: @seojin 2 commits");
    expect(last.value).toContain("이메일 미연결: 3 commits");
  });

  it("omits the unknown-contributor field when nothing is unknown", () => {
    const embed = renderDigestEmbed(base([member({ handle: "a" })]));
    expect(embed.fields.map((f) => f.name)).toEqual(["a"]);
  });

  it("hides commit titles when the team turned them off", () => {
    const embed = renderDigestEmbed(base([member({ handle: "a", events: [commit(1, "t/r", "secret title")] })], { showCommitTitles: false }));
    expect(embed.fields[0].value).toBe("r · 커밋 1");
    expect(embed.fields[0].value).not.toContain("secret");
  });

  it("never includes editor_session events", () => {
    const embed = renderDigestEmbed(
      base([member({ handle: "a", events: [{ id: "e1", type: "editor_session", repo: "t/r", title: "vscode 3h" }] })]),
    );
    expect(embed.fields[0].value).toBe("(기록 없음)");
    expect(JSON.stringify(embed)).not.toContain("vscode");
  });

  it("keeps each field value within 1024 chars by shrinking titles then adding +n", () => {
    const events = Array.from({ length: 60 }, (_, i) => commit(i, "t/r", "x".repeat(120)));
    const embed = renderDigestEmbed(base([member({ handle: "a", events })]));
    expect(embed.fields[0].value.length).toBeLessThanOrEqual(LIMITS.fieldValue);
    expect(embed.fields[0].value).toContain("커밋 60");
  });

  it("throws a typed error beyond 25 fields", () => {
    const members = Array.from({ length: 26 }, (_, i) => member({ handle: `m${i}` }));
    expect(() => renderDigestEmbed(base(members))).toThrow(DigestTooLargeError);
  });

  it("keeps the whole embed within 6000 chars", () => {
    const members = Array.from({ length: 24 }, (_, i) =>
      member({ handle: `m${i}`, events: Array.from({ length: 5 }, (_, j) => commit(i * 10 + j, `t/repo${j}`, "y".repeat(150))) }),
    );
    const embed = renderDigestEmbed(base(members));
    const total = embed.title.length + embed.description.length + embed.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
    expect(total).toBeLessThanOrEqual(LIMITS.total);
  });
});

describe("shouldSkip", () => {
  it("skips only when nobody has events or a blocked note", () => {
    expect(shouldSkip([member({ handle: "a" }), member({ handle: "b" })])).toBe(true);
    expect(shouldSkip([member({ handle: "a" }), member({ handle: "b", events: [commit(1)] })])).toBe(false);
    expect(shouldSkip([member({ handle: "a", blockedNote: "막힘" })])).toBe(false);
    expect(shouldSkip([member({ handle: "a", events: [{ id: "e", type: "editor_session", repo: "r" }] })])).toBe(true);
  });
});
