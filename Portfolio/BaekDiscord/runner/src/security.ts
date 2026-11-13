import { timingSafeEqual } from "node:crypto";

/** Constant-time token comparison; mismatched lengths are rejected without leaking timing. */
export function tokenMatches(presented: string | null | undefined, expected: string): boolean {
  if (typeof presented !== "string" || presented.length === 0) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface LockoutOptions {
  maxFailures: number;
  windowMs: number;
  lockMs: number;
}

/** Per-client auth failure tracking with temporary lockout (defends the token against guessing through a tunnel). */
export class AuthLockout {
  private failures = new Map<string, { count: number; first: number; lockedUntil: number }>();
  constructor(private opts: LockoutOptions = { maxFailures: 5, windowMs: 10 * 60_000, lockMs: 15 * 60_000 }) {}

  isLocked(client: string, now = Date.now()): boolean {
    const f = this.failures.get(client);
    if (!f) return false;
    if (f.lockedUntil > now) return true;
    if (now - f.first > this.opts.windowMs) this.failures.delete(client);
    return false;
  }

  recordFailure(client: string, now = Date.now()): { locked: boolean; remaining: number } {
    const f = this.failures.get(client);
    if (!f || now - f.first > this.opts.windowMs) {
      this.failures.set(client, { count: 1, first: now, lockedUntil: 0 });
      return { locked: false, remaining: this.opts.maxFailures - 1 };
    }
    f.count += 1;
    if (f.count >= this.opts.maxFailures) {
      f.lockedUntil = now + this.opts.lockMs;
      return { locked: true, remaining: 0 };
    }
    return { locked: false, remaining: this.opts.maxFailures - f.count };
  }

  recordSuccess(client: string): void {
    this.failures.delete(client);
  }

  lockedFor(client: string, now = Date.now()): number {
    const f = this.failures.get(client);
    return f && f.lockedUntil > now ? f.lockedUntil - now : 0;
  }
}

/** Simple fixed-window rate limiter keyed by client id. */
export class RateLimiter {
  private hits = new Map<string, { count: number; windowStart: number }>();
  constructor(
    private limit: number,
    private windowMs: number,
  ) {}
  allow(client: string, now = Date.now()): boolean {
    const h = this.hits.get(client);
    if (!h || now - h.windowStart >= this.windowMs) {
      this.hits.set(client, { count: 1, windowStart: now });
      return true;
    }
    h.count += 1;
    return h.count <= this.limit;
  }
}

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-ant-[A-Za-z0-9_-]{10,}/g,
  /\bsk-[A-Za-z0-9]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /(?<=https?:\/\/[^\s/]*:)[^@\s]{4,}(?=@)/g,
  /((?:api[_-]?key|secret|token|password|passwd|authorization)\s*[=:]\s*["']?)([^\s"']{6,})/gi,
];

/** Mask credential-looking substrings before text leaves the machine (brain prompts, notifications). */
export function redactSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (m: string, ...groups: unknown[]) => {
      const prefix = typeof groups[0] === "string" && groups.length > 2 ? (groups[0] as string) : "";
      return `${prefix}[REDACTED]`;
    });
  }
  return out;
}

/** Validate a user-supplied id (session ids, suggestion ids). */
export function isSafeId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

export function clampString(v: unknown, max: number, fallback = ""): string {
  if (typeof v !== "string") return fallback;
  return v.length > max ? v.slice(0, max) : v;
}

export function clientKey(remoteAddress: string | undefined, forwardedFor: string | string[] | undefined): string {
  const xff = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const first = xff?.split(",")[0]?.trim();
  return first || remoteAddress || "unknown";
}
