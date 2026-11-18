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

/**
 * Values masked by exact match, next to the patterns above: per-session hook secrets, which look
 * like nothing in particular. Registered when a session starts, dropped when it ends.
 */
const exactSecrets = new Set<string>();

export function registerExactSecret(value: string): void {
  if (value.length >= 8) exactSecrets.add(value);
}

export function unregisterExactSecret(value: string): void {
  exactSecrets.delete(value);
}

/** Mask credential-looking substrings before text leaves the machine (brain prompts, notifications). */
export function redactSecrets(text: string): string {
  let out = text;
  for (const s of exactSecrets) if (out.includes(s)) out = out.split(s).join("[REDACTED]");
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

/** Which socket a request arrived on. The tunnel process connects only to the tunnel listener. */
export type Listener = "local" | "tunnel";
export type TunnelProvider = "ngrok" | "cloudflared" | null;

function firstHeader(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Key for rate limits and auth lockout.
 *
 * - Local listener: the socket address only. Forwarded headers come from the caller and are ignored,
 *   so nobody on this machine can pick their own key.
 * - Tunnel listener: every request arrives from the tunnel process on 127.0.0.1, so the socket address
 *   says nothing. Use the value the tunnel provider itself wrote: cloudflared sets `CF-Connecting-IP`;
 *   ngrok appends the client address as the LAST `X-Forwarded-For` entry. Earlier entries are
 *   client-controlled and never used. Keys are prefixed so tunnel failures never lock the local user.
 */
export function clientKey(
  remoteAddress: string | undefined,
  headers: Record<string, string | string[] | undefined>,
  listener: Listener = "local",
  provider: TunnelProvider = null,
): string {
  if (listener === "local") return remoteAddress || "unknown";
  if (provider === "cloudflared") {
    const cf = firstHeader(headers["cf-connecting-ip"])?.trim();
    if (cf) return `tunnel:${cf}`;
  }
  const xff = headers["x-forwarded-for"];
  const joined = Array.isArray(xff) ? xff.join(",") : xff;
  const last = joined
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .pop();
  return `tunnel:${last || "unknown"}`;
}

/** Hosts the local listener answers to. Blocks DNS-rebinding pages that resolve their own name to 127.0.0.1. */
export function hostAllowed(hostHeader: string | undefined, allowedOrigins: Iterable<string>): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.toLowerCase();
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  if (name === "localhost" || name === "127.0.0.1" || name === "[::1]") return true;
  for (const o of allowedOrigins) {
    try {
      if (new URL(o).host.toLowerCase() === host) return true;
    } catch {
      /* ignore malformed origin entries */
    }
  }
  return false;
}
