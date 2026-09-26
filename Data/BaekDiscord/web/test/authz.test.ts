import { describe, expect, it } from "vitest";
import {
  canEditDigestRow,
  canInstallApp,
  canJoinViaInvite,
  canManageTeam,
  canSeeEditorTime,
  canTriggerDigest,
  canViewDigest,
  isContributor,
  type MembershipRow,
} from "@/lib/authz";

const lead = { id: "u_lead" };
const member = { id: "u_member" };
const stranger = { id: "u_other" };
const memberships: MembershipRow[] = [
  { teamId: "t1", userId: "u_lead", role: "lead" },
  { teamId: "t1", userId: "u_member", role: "member" },
  { teamId: "t1", userId: "u_pending", role: "member", status: "pending" },
  { teamId: "t2", userId: "u_other", role: "lead" },
];
const digestT1 = { id: "d1", teamId: "t1" };

describe("canViewDigest", () => {
  it("allows active members of the digest's team only", () => {
    expect(canViewDigest(lead, memberships, digestT1)).toBe(true);
    expect(canViewDigest(member, memberships, digestT1)).toBe(true);
    expect(canViewDigest({ id: "u_pending" }, memberships, digestT1)).toBe(false);
    expect(canViewDigest(stranger, memberships, digestT1)).toBe(false); // 다른 팀의 digest id → 403
    expect(canViewDigest(null, memberships, digestT1)).toBe(false);
  });
});

describe("canEditDigestRow", () => {
  const publishedAt = new Date("2026-09-22T12:00:00Z");
  const at = (min: number) => new Date(publishedAt.getTime() + min * 60_000);
  it("own row within 60 minutes only", () => {
    expect(canEditDigestRow(member, "u_member", publishedAt, at(10))).toBe(true);
    expect(canEditDigestRow(member, "u_member", publishedAt, at(61))).toBe(false);
    expect(canEditDigestRow(member, "u_lead", publishedAt, at(10))).toBe(false); // 타인 행 PATCH → 403
  });
  it("gives the lead no exception", () => {
    expect(canEditDigestRow(lead, "u_member", publishedAt, at(1))).toBe(false);
    expect(canEditDigestRow(lead, "u_lead", publishedAt, at(1))).toBe(true);
  });
  it("is closed when unpublished", () => {
    expect(canEditDigestRow(member, "u_member", null, at(0))).toBe(false);
  });
});

describe("team management helpers", () => {
  it("canManageTeam / canTriggerDigest / canInstallApp are lead-only and team-scoped", () => {
    for (const fn of [canManageTeam, canTriggerDigest, canInstallApp]) {
      expect(fn(lead, memberships, "t1")).toBe(true);
      expect(fn(member, memberships, "t1")).toBe(false);
      expect(fn(stranger, memberships, "t1")).toBe(false);
      expect(fn(lead, memberships, "t2")).toBe(false);
      expect(fn(null, memberships, "t1")).toBe(false);
    }
  });
});

describe("canJoinViaInvite", () => {
  const now = new Date("2026-09-22T00:00:00Z");
  it("requires an existing, unexpired token", () => {
    expect(canJoinViaInvite({ token: "x", teamId: "t1", expiresAt: new Date("2026-09-23T00:00:00Z") }, now)).toBe(true);
    expect(canJoinViaInvite({ token: "x", teamId: "t1", expiresAt: new Date("2026-09-21T00:00:00Z") }, now)).toBe(false);
    expect(canJoinViaInvite(null, now)).toBe(false);
  });
});

describe("isContributor", () => {
  it("matches logins case-insensitively and rejects missing logins", () => {
    expect(isContributor("MinSu", ["minsu", null, "yuna"])).toBe(true);
    expect(isContributor("seojin", ["minsu"])).toBe(false);
    expect(isContributor(null, ["minsu"])).toBe(false);
  });
});

describe("canSeeEditorTime", () => {
  it("is self-only (never team)", () => {
    expect(canSeeEditorTime(member, "u_member")).toBe(true);
    expect(canSeeEditorTime(lead, "u_member")).toBe(false);
    expect(canSeeEditorTime(null, "u_member")).toBe(false);
  });
});
