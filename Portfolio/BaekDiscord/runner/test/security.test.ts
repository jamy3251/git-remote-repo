import { describe, expect, it } from "vitest";
import { AuthLockout, RateLimiter, clientKey, hostAllowed, isSafeId, redactSecrets, tokenMatches } from "../src/security.js";
import { sessionEnv } from "../src/sessions.js";

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
  it("ignores forwarded headers on the local listener", () => {
    expect(clientKey("127.0.0.1", { "x-forwarded-for": "203.0.113.5, 10.0.0.1" })).toBe("127.0.0.1");
    expect(clientKey("127.0.0.1", {}, "local")).toBe("127.0.0.1");
  });

  it("uses the provider-written address on the tunnel listener", () => {
    // ngrok appends the real client as the last entry; earlier entries are whatever the client sent.
    expect(clientKey("127.0.0.1", { "x-forwarded-for": "1.1.1.1, 203.0.113.5" }, "tunnel", "ngrok")).toBe("tunnel:203.0.113.5");
    expect(clientKey("127.0.0.1", { "x-forwarded-for": "9.9.9.9, 203.0.113.5" }, "tunnel", "ngrok")).toBe("tunnel:203.0.113.5");
    // A client-sent CF-Connecting-IP means nothing behind ngrok.
    expect(clientKey("127.0.0.1", { "x-forwarded-for": "203.0.113.5", "cf-connecting-ip": "1.2.3.4" }, "tunnel", "ngrok")).toBe("tunnel:203.0.113.5");
    expect(clientKey("127.0.0.1", { "x-forwarded-for": "6.6.6.6", "cf-connecting-ip": "198.51.100.7" }, "tunnel", "cloudflared")).toBe("tunnel:198.51.100.7");
    // Never collapse into the local key, so tunnel failures cannot lock the person at the PC.
    expect(clientKey("127.0.0.1", {}, "tunnel", "ngrok")).toBe("tunnel:unknown");
  });
});

describe("hostAllowed", () => {
  const origins = ["http://localhost:3000", "http://10.0.2.2:7331"];
  it("accepts loopback names and hosts of allowed origins", () => {
    expect(hostAllowed("127.0.0.1:7331", origins)).toBe(true);
    expect(hostAllowed("localhost:7331", origins)).toBe(true);
    expect(hostAllowed("[::1]:7331", origins)).toBe(true);
    expect(hostAllowed("10.0.2.2:7331", origins)).toBe(true);
  });
  it("rejects other names (DNS rebinding) and a missing header", () => {
    expect(hostAllowed("evil.example:7331", origins)).toBe(false);
    expect(hostAllowed("127.0.0.1.evil.example", origins)).toBe(false);
    expect(hostAllowed(undefined, origins)).toBe(false);
  });
});

describe("sessionEnv", () => {
  it("never passes the runner token to a session", () => {
    const env = sessionEnv({ PATH: "/bin", RUNNER_TOKEN: "admin-secret", runner_token: "lower", HOME: "/h" }, "abc");
    expect(env.RUNNER_TOKEN).toBeUndefined();
    expect(env.runner_token).toBeUndefined();
    expect(env.PATH).toBe("/bin");
    expect(env.DEVHUB_SESSION).toBe("abc");
  });

  it("drops the parent Claude Code session's markers but keeps user configuration", () => {
    const env = sessionEnv(
      { PATH: "/bin", CLAUDECODE: "1", CLAUDE_CODE_CHILD_SESSION: "1", CLAUDE_CODE_MESSAGING_TOKEN: "t", CLAUDE_CODE_USE_BEDROCK: "1", CLAUDE_CODE_GIT_BASH_PATH: "C:/git/bash.exe" },
      "abc",
    );
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.CLAUDE_CODE_CHILD_SESSION).toBeUndefined();
    expect(env.CLAUDE_CODE_MESSAGING_TOKEN).toBeUndefined();
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBe("1");
    expect(env.CLAUDE_CODE_GIT_BASH_PATH).toBe("C:/git/bash.exe");
  });
});
