import { editWindowOpen } from "./digest/window";

/** Plain-object inputs so these helpers are unit-testable without a DB. */
export interface AuthUser {
  id: string;
}
export interface MembershipRow {
  teamId: string;
  userId: string;
  role: "lead" | "member";
  status?: "active" | "pending";
}
export interface DigestRef {
  id: string;
  teamId: string;
}
export interface InviteRef {
  token: string;
  teamId: string;
  expiresAt: Date;
}

function activeMembership(user: AuthUser | null, memberships: MembershipRow[], teamId: string): MembershipRow | null {
  if (!user) return null;
  return (
    memberships.find((m) => m.teamId === teamId && m.userId === user.id && (m.status ?? "active") === "active") ?? null
  );
}

/** 1. 팀 멤버(활성)만 그 팀 다이제스트를 볼 수 있다. 다른 팀 id → 거부. */
export function canViewDigest(user: AuthUser | null, memberships: MembershipRow[], digest: DigestRef): boolean {
  return activeMembership(user, memberships, digest.teamId) !== null;
}

/** 2. 본인 행만, 발행 후 60분 안에만. lead 예외 없음. */
export function canEditDigestRow(
  user: AuthUser | null,
  rowUserId: string,
  publishedAt: Date | null | undefined,
  now: Date,
): boolean {
  if (!user || user.id !== rowUserId) return false;
  return editWindowOpen(publishedAt, now);
}

/** 3. 팀 설정(웹훅, 리포, 초대) — lead만. */
export function canManageTeam(user: AuthUser | null, memberships: MembershipRow[], teamId: string): boolean {
  return activeMembership(user, memberships, teamId)?.role === "lead";
}

/** 4. 수동 트리거 — lead만. */
export function canTriggerDigest(user: AuthUser | null, memberships: MembershipRow[], teamId: string): boolean {
  return canManageTeam(user, memberships, teamId);
}

/** 5. 초대 링크 — 토큰 존재 + 미만료. */
export function canJoinViaInvite(invite: InviteRef | null | undefined, now: Date): boolean {
  if (!invite) return false;
  return invite.expiresAt.getTime() > now.getTime();
}

/** 6. 기여자 판정 — 팀 리포 이벤트에 login이 등장하면 즉시 member, 아니면 pending. */
export function isContributor(githubLogin: string | null | undefined, teamEventLogins: Iterable<string | null>): boolean {
  if (!githubLogin) return false;
  const target = githubLogin.toLowerCase();
  for (const l of teamEventLogins) if (l && l.toLowerCase() === target) return true;
  return false;
}

/** 7. GitHub App 설치를 팀에 붙이기 — lead만. */
export function canInstallApp(user: AuthUser | null, memberships: MembershipRow[], teamId: string): boolean {
  return canManageTeam(user, memberships, teamId);
}

/** 8. 에디터 작업시간 — 본인만. 팀 뷰/다이제스트에는 절대 노출하지 않는다. */
export function canSeeEditorTime(user: AuthUser | null, ownerUserId: string): boolean {
  return !!user && user.id === ownerUserId;
}
