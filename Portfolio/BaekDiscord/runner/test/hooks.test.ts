import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { canInjectHooks, detectAgent, hookSettings, nextHookPhase, parseHookBody, withHookSettings, HOOK_EVENTS, type HookPhase, type HookSignal } from "../src/hooks.js";
import { findOverlaps } from "../src/overlap.js";
import { heuristicSuggestion, isSafeAutoInput, judgeHeuristically } from "../src/supervisor/heuristics.js";
import { SessionManager } from "../src/sessions.js";
import { Supervisor } from "../src/supervisor/supervisor.js";
import { redactSecrets } from "../src/security.js";
import { createRunnerServer } from "../src/server.js";
import type { Brain } from "../src/supervisor/brain.js";
import type { RunnerConfig } from "../src/config.js";
import type { SessionInfo } from "../src/protocol.js";

const isWin = process.platform === "win32";

let n = 0;
const sig = (event: string, over: Partial<HookSignal> & { payload?: Record<string, unknown> } = {}, ts = 1000 + n): HookSignal => {
  n += 1;
  const parsed = parseHookBody({ id: `h${n}`, ts, payload: { hook_event_name: event, session_id: "claude-1", prompt_id: "p1", ...over.payload } });
  if (!parsed) throw new Error(`bad fixture ${event}`);
  return { ...parsed, ...over };
};
const run = (signals: HookSignal[]): HookPhase | null => signals.reduce<HookPhase | null>((p, s) => nextHookPhase(p, s) ?? p, null);

describe("which sessions get hooks", () => {
  it("reads the agent from the command, not the preset name", () => {
    expect(detectAgent("claude --continue", "pty")).toEqual({ agent: "claude", interactive: true });
    expect(detectAgent('"C:\\Tools\\claude.cmd" --resume abc', "pty")).toEqual({ agent: "claude", interactive: true });
    expect(detectAgent("claude -p --output-format text", "pipe")).toEqual({ agent: "claude", interactive: false });
    expect(detectAgent("codex exec -", "pipe")).toEqual({ agent: "codex", interactive: false });
    expect(detectAgent("powershell.exe -NoLogo", "pty").agent).toBe("shell");
    expect(detectAgent("npm run dev", "pty").agent).toBe("custom");
  });

  it("injects only into a plain interactive claude line", () => {
    expect(canInjectHooks("claude", "pty")).toBe(true);
    expect(canInjectHooks("claude --continue", "pty")).toBe(true);
    expect(canInjectHooks("claude -p hello", "pty")).toBe(false);
    expect(canInjectHooks("claude --settings mine.json", "pty")).toBe(false);
    expect(canInjectHooks("claude && del x", "pty")).toBe(false);
    expect(canInjectHooks("codex", "pty")).toBe(false);
  });

  it("registers every event async, without PreToolUse, with a path that survives spaces", () => {
    const s = hookSettings("C:\\Program Files\\nodejs\\node.exe", "D:\\한글 폴더\\bin\\devhub-hook.mjs");
    expect(Object.keys(s.hooks).sort()).toEqual([...HOOK_EVENTS].sort());
    expect(Object.keys(s.hooks)).not.toContain("PreToolUse");
    const h = (s.hooks.Stop[0] as { hooks: Array<{ command: string; async: boolean }> }).hooks[0];
    expect(h.async).toBe(true);
    expect(h.command).toBe('"C:/Program Files/nodejs/node.exe" "D:/한글 폴더/bin/devhub-hook.mjs"');
    expect(withHookSettings("claude --continue", "D:\\a b\\x.json")).toBe('claude --continue --settings "D:/a b/x.json"');
  });
});

describe("hook payloads", () => {
  it("rejects anything that is not a hook call", () => {
    expect(parseHookBody(null)).toBeNull();
    expect(parseHookBody({ id: "a", ts: 1, payload: { hook_event_name: "PreToolUse" } })).toBeNull();
    expect(parseHookBody({ id: "bad id!", ts: 1, payload: { hook_event_name: "Stop" } })).toBeNull();
    expect(parseHookBody({ id: "a", ts: "1", payload: { hook_event_name: "Stop" } })).toBeNull();
    expect(parseHookBody({ id: "a", ts: 1, payload: { hook_event_name: "Stop", session_id: "s" } })?.claudeSessionId).toBe("s");
  });

  it("walks a turn: idle, working, permission, working, turn end", () => {
    expect(run([sig("SessionStart")])?.state).toBe("idle");
    expect(run([sig("SessionStart"), sig("UserPromptSubmit")])?.state).toBe("working");
    const perm = run([sig("SessionStart"), sig("UserPromptSubmit"), sig("PermissionRequest", { payload: { tool_name: "Bash", tool_input: { command: "npm test" } } })]);
    expect(perm).toMatchObject({ kind: "permission", state: "waiting_input", danger: false, tool: "Bash" });
    expect(perm?.reason).toContain("npm test");
    expect(perm?.inputHash).toMatch(/^[0-9a-f]{12}$/);
    expect(run([sig("PermissionRequest", { payload: { tool_name: "Bash", tool_input: { command: "x" } } }), sig("PostToolUse")])?.state).toBe("working");
    expect(run([sig("UserPromptSubmit"), sig("Stop")])).toMatchObject({ kind: "turn_end", state: "waiting_input" });
  });

  it("judges danger from the tool input, and masks secrets in what is shown", () => {
    const p = run([sig("PermissionRequest", { payload: { tool_name: "Bash", tool_input: { command: "git push --force origin main" } } })]);
    expect(p).toMatchObject({ danger: true, dangerReason: "되돌리기 어려운 git 명령" });
    const edit = run([sig("PermissionRequest", { payload: { tool_name: "Edit", tool_input: { file_path: "src/a.ts", new_string: "rm -rf /" } } })]);
    expect(edit?.danger).toBe(false); // a file edit is judged by its path, not by the text it writes
    const secret = run([sig("PermissionRequest", { payload: { tool_name: "Bash", tool_input: { command: "curl -H token=abcdef123456 x" } } })]);
    expect(secret?.reason).not.toContain("abcdef123456");
  });

  it("stays consistent when async hooks arrive out of order", () => {
    const start = sig("UserPromptSubmit", {}, 100);
    const tool = sig("PostToolUse", {}, 200);
    const stop = sig("Stop", {}, 300);
    for (const order of [[start, tool, stop], [start, stop, tool], [stop, tool, start], [tool, stop, start]]) {
      expect(run(order)?.kind, order.map((s) => s.event).join(">")).toBe("turn_end");
    }
  });

  it("keeps what it knows across /clear and uses idle_prompt only when Stop was missed", () => {
    expect(run([sig("UserPromptSubmit"), sig("SessionStart")])?.state).toBe("working");
    expect(run([sig("UserPromptSubmit"), sig("Notification", { payload: { notification_type: "idle_prompt" } })])?.state).toBe("waiting_input");
    const stop = run([sig("Stop")]);
    expect(nextHookPhase(stop, sig("Notification", { payload: { notification_type: "idle_prompt" } }))).toBeNull();
  });
});

describe("folder trust screen", () => {
  const tail = [
    " Accessing workspace:",
    " C:\\Users\\User\\AppData\\Local\\Temp\\x",
    " Quick safety check: Is this a project you created or one you trust? (Like your own code, a",
    " ❯ No, exit",
    "   Yes, I trust this folder",
    " Enter to confirm · Esc to cancel",
  ];
  it("is reported as a wait that is never answered automatically", () => {
    const j = judgeHeuristically({ tail, lastOutputAt: 0, createdAt: 0, now: 60_000, status: "running", exitCode: null, mode: "pty", preset: "claude" });
    expect(j).toMatchObject({ state: "waiting_input", reason: "폴더 신뢰 확인 필요", danger: true });
    expect(j.prompt?.kind).toBe("trust");
    const s = heuristicSuggestion(j);
    expect(s?.kind).toBe("escalate");
    expect(s?.input).toBeUndefined();
    // The plain "Enter to confirm" reading would have proposed Enter, which exits Claude Code.
    expect(isSafeAutoInput("\r")).toBe(true);
  });
});

describe("same-folder warning", () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "devhub-overlap-")));
  const mk = (...p: string[]) => {
    const d = path.join(root, ...p);
    fs.mkdirSync(d, { recursive: true });
    return d;
  };
  const s = (id: string, cwd: string, over: Partial<SessionInfo> = {}): SessionInfo => ({ id, name: id, cwd, status: "running", preset: "claude", tags: [], ...over }) as SessionInfo;
  const a = mk("app");
  const sub = mk("app", "src");
  const other = mk("other");

  it("finds same, parent, child and root relations, and nothing for a sibling", () => {
    const running = [s("same", a), s("child", sub), s("root", root), s("sib", other)];
    expect(findOverlaps(a, running, root).map((o) => [o.id, o.relation])).toEqual([["same", "same"], ["child", "child"], ["root", "root"]]);
    expect(findOverlaps(sub, [s("p", a)], root)[0].relation).toBe("parent");
    expect(findOverlaps(other, [s("x", a)], root)).toEqual([]);
  });

  it("ignores letter case, finished sessions and read-only reviews", () => {
    if (isWin) expect(findOverlaps(a.toUpperCase(), [s("x", a)], root)).toHaveLength(1);
    expect(findOverlaps(a, [s("done", a, { status: "exited" }), s("rev", a, { preset: "codex-review" }), s("tagged", a, { tags: ["review"] })], root)).toEqual([]);
  });

  it.skipIf(!isWin)("sees through a junction", () => {
    const link = path.join(root, "link");
    fs.symlinkSync(a, link, "junction");
    expect(findOverlaps(link, [s("x", a)], root)[0]?.relation).toBe("same");
  });
});

class NoBrain implements Brain {
  kind = "heuristic" as const;
  model = null;
  async judge(): Promise<null> {
    return null;
  }
  async complete(): Promise<null> {
    return null;
  }
}

describe("Supervisor with hook signals", () => {
  let sessions: SessionManager;
  beforeEach(() => {
    sessions = new SessionManager({ cwdRoot: os.tmpdir(), maxSessions: 4, historyBytes: 64 * 1024, defaultPolicy: "assist" });
  });
  afterEach(() => sessions.killAll());
  const idle = isWin ? "cmd.exe /q /k" : "cat";

  it("moves the state at once, marks it as confirmed, and takes the Claude session id", async () => {
    const sup = new Supervisor(sessions, new NoBrain(), { enabled: true, defaultPolicy: "assist", intervalMs: 100_000, hooksEnabled: true });
    const s = sessions.create({ preset: "custom", command: idle, cwd: os.tmpdir() });
    expect(sessions.get(s.id)?.signal).toBe("output");
    expect(sup.hookSignal(s.id, sig("UserPromptSubmit", {}, Date.now()))).toBe("ok");
    expect(sessions.get(s.id)).toMatchObject({ state: "working", signal: "hook", claudeSessionId: "claude-1" });
    const dup = sig("Stop", {}, Date.now() + 1);
    expect(sup.hookSignal(s.id, dup)).toBe("ok");
    expect(sup.hookSignal(s.id, dup)).toBe("duplicate");
    expect(sessions.get(s.id)?.state).toBe("waiting_input");
    expect(sup.config().hooks).toEqual({ enabled: true, received: 2, rejected: 0 });
  });

  it("escalates a dangerous permission request and returns to working when it is answered", async () => {
    const sup = new Supervisor(sessions, new NoBrain(), { enabled: true, defaultPolicy: "auto", intervalMs: 100_000 });
    const s = sessions.create({ preset: "custom", command: idle, cwd: os.tmpdir(), policy: "auto" });
    sup.hookSignal(s.id, sig("PermissionRequest", { payload: { tool_name: "Bash", tool_input: { command: "rm -rf build" } } }, Date.now()));
    await new Promise((r) => setTimeout(r, 50));
    const got = sessions.get(s.id);
    expect(got?.state).toBe("waiting_input");
    expect(got?.stateReason).toContain("rm -rf build");
    expect(got?.suggestion?.kind).toBe("escalate");
    sessions.write(s.id, "1");
    expect(sessions.get(s.id)?.state).toBe("working");
  });

  it("falls back to the screen when hooks say working but a prompt has sat there silently", async () => {
    const sup = new Supervisor(sessions, new NoBrain(), { enabled: true, defaultPolicy: "manual", intervalMs: 100_000 });
    const cmd = isWin ? 'cmd.exe /q /v:on /c "echo Overwrite? (y/n)& set /p a= "' : "sh -c 'echo \"Overwrite? (y/n)\"; read a'";
    const s = sessions.create({ preset: "custom", command: cmd, cwd: os.tmpdir(), policy: "manual" });
    const until = Date.now() + 8000;
    while (!sessions.tail(s.id, 5).some((l) => l.includes("(y/n)"))) {
      if (Date.now() > until) throw new Error("timeout");
      await new Promise((r) => setTimeout(r, 50));
    }
    const t0 = Date.now();
    sup.hookSignal(s.id, sig("UserPromptSubmit", {}, t0), t0);
    await sup.tick(t0 + 20_000);
    expect(sessions.get(s.id)).toMatchObject({ state: "working", signal: "hook" });
    await sup.tick(t0 + 90_000);
    expect(sessions.get(s.id)).toMatchObject({ state: "waiting_input", signal: "output" });
  });
});

describe("POST /runner/hooks", () => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-fakeclaude-"));
  const cfg: RunnerConfig = {
    host: "127.0.0.1",
    port: 0,
    tunnelPort: 0,
    tunnelIdleMs: 0,
    tunnelMaxMs: 0,
    token: "hook-test-token",
    cwdRoot: path.resolve(os.tmpdir()),
    maxSessions: 4,
    historyBytes: 64 * 1024,
    compileTimeoutMs: 20_000,
    runTimeoutMaxMs: 30_000,
    outputCapBytes: 64 * 1024,
    allowedOrigins: [],
    webProxy: null,
    dashboardPath: "/control",
    hooks: true,
    supervisor: { enabled: true, defaultPolicy: "manual", intervalMs: 100_000, brain: "heuristic", brainModel: null, apiKey: null, cliTimeoutMs: 1000, notifyWebhook: null },
  };
  let runner: ReturnType<typeof createRunnerServer>;
  let port = 0;
  const oldPath = process.env.PATH;

  beforeAll(async () => {
    // A stand-in `claude` that just waits, so the session takes the hook path without the real CLI.
    if (isWin) fs.writeFileSync(path.join(binDir, "claude.cmd"), "@echo off\r\necho fake-claude %*\r\nset /p x=\r\n");
    else fs.writeFileSync(path.join(binDir, "claude"), '#!/bin/sh\necho "fake-claude $@"\nread x\n', { mode: 0o755 });
    process.env.PATH = `${binDir}${path.delimiter}${oldPath}`;
    runner = createRunnerServer(cfg);
    port = await runner.listen();
  });
  afterAll(async () => {
    process.env.PATH = oldPath;
    await runner.close();
  });

  const post = (headers: Record<string, string>, body: unknown, p = port) =>
    fetch(`http://127.0.0.1:${p}/runner/hooks`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
  const json = { "content-type": "application/json" };

  it("accepts a session's own hook, once, and refuses everything else", async () => {
    const s = runner.sessions.create({ preset: "claude", cwd: cfg.cwdRoot, allowOverlap: true });
    expect(s).toMatchObject({ agent: "claude", interactive: true, command: "claude" });
    const secret = runner.sessions.hookSecretOf(s.id)!;
    expect(secret.length).toBeGreaterThan(20);
    const settings = path.join(process.cwd(), ".data", "hooks", `${s.id}.json`);
    expect(JSON.parse(fs.readFileSync(settings, "utf8")).hooks.Stop).toBeDefined();
    // The session really received --settings, and the secret is masked wherever text is redacted.
    const until = Date.now() + 8000;
    while (!runner.sessions.tail(s.id, 5).some((l) => l.includes("--settings"))) {
      if (Date.now() > until) throw new Error("fake claude did not start");
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(redactSecrets(`x ${secret} y`)).toBe("x [REDACTED] y");

    const own = { ...json, "x-devhub-session": s.id, "x-devhub-hook-secret": secret };
    const call = { id: "call-1", ts: Date.now(), payload: { hook_event_name: "Stop", session_id: "claude-abc" } };
    expect((await post(own, call)).status).toBe(200);
    expect(runner.sessions.get(s.id)).toMatchObject({ state: "waiting_input", signal: "hook", claudeSessionId: "claude-abc" });

    const dup = await post(own, call);
    expect([dup.status, (await dup.json()).code]).toEqual([409, "hook_duplicate"]);
    const bad = await post({ ...own, "x-devhub-hook-secret": "x".repeat(secret.length) }, { ...call, id: "call-2" });
    expect([bad.status, (await bad.json()).code]).toEqual([403, "hook_bad_secret"]);
    const unknown = await post({ ...own, "x-devhub-session": "nope1234" }, { ...call, id: "call-3" });
    expect([unknown.status, (await unknown.json()).code]).toEqual([404, "hook_unknown_session"]);
    expect((await post({ ...own, "content-type": "text/plain" }, call)).status).toBe(400);
    expect((await post(own, { id: "call-4", ts: 1, payload: { hook_event_name: "Nope" } })).status).toBe(400);
    // The admin token is not a hook credential, and the tunnel listener does not serve the route.
    expect((await post({ ...json, authorization: `Bearer ${cfg.token}`, "x-devhub-session": s.id }, call)).status).toBe(403);
    const viaTunnel = await post({ ...own, authorization: `Bearer ${cfg.token}` }, { ...call, id: "call-5" }, runner.tunnelPort());
    expect(viaTunnel.status).toBe(404);
    expect(runner.supervisor.config().hooks).toMatchObject({ enabled: true, received: 1 });

    // After the session ends its secret stops working and the settings file is gone.
    runner.sessions.kill(s.id);
    const end = Date.now() + 8000;
    while (runner.sessions.get(s.id)?.endedAt === null) {
      if (Date.now() > end) throw new Error("session did not end");
      await new Promise((r) => setTimeout(r, 50));
    }
    expect((await post(own, { ...call, id: "call-6" })).status).toBe(404);
    expect(redactSecrets(secret)).toBe(secret);
  });

  it("leaves hooks off when the request says so", () => {
    const s = runner.sessions.create({ preset: "claude", cwd: cfg.cwdRoot, hooks: false, allowOverlap: true });
    expect(runner.sessions.hookSecretOf(s.id)).toBeNull();
    runner.sessions.kill(s.id);
  });
});
