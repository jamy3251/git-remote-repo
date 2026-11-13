import { describe, expect, it } from "vitest";
import { AuthLockout, RateLimiter, clientKey, isSafeId, redactSecrets, tokenMatches } from "../src/security.js";

describe("tokenMatches", () => {
  it("accepts only the exact token", () => {
    expect(tokenMatches("abc123", "abc123")).toBe(true);
    expect(tokenMatches("abc124", "abc123")).toBe(false);
    expect(tokenMatches("abc12", "abc123")).toBe(false);
    expect(tokenMatches("", "abc123")).toBe(false);
    expect(tokenMatches(null, "abc123")).toBe(false);
    expect(tokenMatches(undefined, "abc123")).toBe(false);
  });
});

describe("AuthLockout", () => {
  it("locks a client after repeated failures and releases after lockMs", () => {
    const l = new AuthLockout({ maxFailures: 3, windowMs: 60_000, lockMs: 1_000 });
    const t0 = 1_000_000;
    expect(l.recordFailure("ip1", t0)).toEqual({ locked: false, remaining: 2 });
    expect(l.recordFailure("ip1", t0 + 10)).toEqual({ locked: false, remaining: 1 });
    expect(l.recordFailure("ip1", t0 + 20)).toEqual({ locked: true, remaining: 0 });
    expect(l.isLocked("ip1", t0 + 30)).toBe(true);
    expect(l.lockedFor("ip1", t0 + 30)).toBeGreaterThan(0);
    expect(l.isLocked("ip2", t0 + 30)).toBe(false);
    expect(l.isLocked("ip1", t0 + 20 + 1_001)).toBe(false);
  });

  it("forgets failures outside the window and on success", () => {
    const l = new AuthLockout({ maxFailures: 2, windowMs: 1_000, lockMs: 5_000 });
    l.recordFailure("ip", 0);
    expect(l.recordFailure("ip", 2_000)).toEqual({ locked: false, remaining: 1 });
    l.recordSuccess("ip");
    expect(l.recordFailure("ip", 2_100)).toEqual({ locked: false, remaining: 1 });
  });
});

describe("RateLimiter", () => {
  it("allows up to the limit per window", () => {
    const r = new RateLimiter(2, 1_000);
    expect(r.allow("a", 0)).toBe(true);
    expect(r.allow("a", 1)).toBe(true);
    expect(r.allow("a", 2)).toBe(false);
    expect(r.allow("b", 2)).toBe(true);
    expect(r.allow("a", 1_001)).toBe(true);
  });
});

describe("redactSecrets", () => {
  it("masks common credential shapes", () => {
    const text = [
      "ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789",
      "token ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      "aws AKIAIOSFODNN7EXAMPLE",
      "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1XzFJUmpPWWlxYnk2VWR3IiwiaWF0IjoxNzkwNDI1.abcdefghijklmnop_signature",
      "password: hunter2secret",
      "https://user:supersecretpw@example.com/x",
    ].join("\n");
    const out = redactSecrets(text);
    expect(out).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
    expect(out).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(out).not.toContain("hunter2secret");
    expect(out).not.toContain("supersecretpw");
    expect(out).toContain("[REDACTED]");
    expect(out).toContain("password: ");
  });

  it("leaves ordinary text alone", () => {
    const text = "PS D:\\Projects> npm test\n21 passed";
    expect(redactSecrets(text)).toBe(text);
  });
});

describe("ids and client keys", () => {
  it("validates ids", () => {
    expect(isSafeId("a1b2c3d4")).toBe(true);
    expect(isSafeId("../etc")).toBe(false);
    expect(isSafeId("")).toBe(false);
    expect(isSafeId(42)).toBe(false);
  });
  it("prefers the first forwarded address", () => {
    expect(clientKey("127.0.0.1", "203.0.113.5, 10.0.0.1")).toBe("203.0.113.5");
    expect(clientKey("127.0.0.1", undefined)).toBe("127.0.0.1");
  });
});
