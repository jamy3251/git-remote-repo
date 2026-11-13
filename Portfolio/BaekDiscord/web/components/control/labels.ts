import type { AgentState, Policy, SessionInfo, SupervisorEvent } from "@/lib/runner/protocol";

export const stateMeta: Record<AgentState, { label: string; cls: string; dot: string }> = {
  starting: { label: "시작 중", cls: "text-muted border-border", dot: "bg-muted" },
  working: { label: "작업 중", cls: "text-accent border-accent/50", dot: "bg-accent" },
  waiting_input: { label: "입력 대기", cls: "text-warn border-warn/60", dot: "bg-warn" },
  idle: { label: "대기", cls: "text-muted border-border", dot: "bg-muted" },
  error: { label: "오류", cls: "text-danger border-danger/60", dot: "bg-danger" },
  done: { label: "완료", cls: "text-ok border-ok/50", dot: "bg-ok" },
  killed: { label: "종료됨", cls: "text-muted border-border", dot: "bg-muted" },
};

export const policyLabel: Record<Policy, string> = { manual: "수동", assist: "제안", auto: "자율" };
export const policyOptions: Policy[] = ["manual", "assist", "auto"];

export const actorLabel: Record<SupervisorEvent["actor"], string> = {
  supervisor: "슈퍼바이저",
  human: "사람",
  chat: "관제 AI",
  system: "시스템",
};

export const levelCls: Record<SupervisorEvent["level"], string> = {
  info: "text-muted",
  warn: "text-warn",
  action: "text-accent",
  error: "text-danger",
};

export function needsAttention(s: SessionInfo): boolean {
  return s.state === "waiting_input" || s.state === "error" || s.suggestion !== null;
}

export function fmtDuration(from: number, to: number | null): string {
  const s = Math.max(0, Math.floor(((to ?? Date.now()) - from) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

export function shortPath(p: string, max = 36): string {
  if (p.length <= max) return p;
  const parts = p.split(/[\\/]/).filter(Boolean);
  let out = parts[parts.length - 1] ?? p;
  for (let i = parts.length - 2; i >= 0; i--) {
    const next = `${parts[i]}/${out}`;
    if (next.length > max - 2) break;
    out = next;
  }
  return `…/${out}`;
}
