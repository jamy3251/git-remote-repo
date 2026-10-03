#!/usr/bin/env node
/**
 * devhubctl — command-line client for the DevHub runner (so Claude Code / scripts can drive sessions).
 *
 *   devhubctl health
 *   devhubctl sessions [--json]
 *   devhubctl create --preset claude-print --cwd D:\Projects\X --prompt "..." [--name n] [--goal g] [--policy assist|auto|manual]
 *   devhubctl send <id> "text" [--no-enter]
 *   devhubctl output <id> [--lines 60]
 *   devhubctl kill <id>
 *   devhubctl workspace <id>
 *   devhubctl events [--limit 50]
 *   devhubctl chat "지시" [--confirm]
 *   devhubctl tunnel status|start|stop
 *
 * Connection: DEVHUB_RUNNER_URL (default http://127.0.0.1:7331) and DEVHUB_RUNNER_TOKEN
 * (default: contents of runner/.runner-token next to this script, or RUNNER_TOKEN).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const baseUrl = (process.env.DEVHUB_RUNNER_URL ?? "http://127.0.0.1:7331").replace(/\/$/, "");

function token() {
  if (process.env.DEVHUB_RUNNER_TOKEN) return process.env.DEVHUB_RUNNER_TOKEN;
  if (process.env.RUNNER_TOKEN) return process.env.RUNNER_TOKEN;
  try {
    return fs.readFileSync(path.join(here, "..", ".runner-token"), "utf8").trim();
  } catch {
    return "";
  }
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else flags[key] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

async function api(method, route, body) {
  const res = await fetch(`${baseUrl}/runner${route}`, {
    method,
    headers: { authorization: `Bearer ${token()}`, "content-type": "application/json", "ngrok-skip-browser-warning": "1" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `${res.status} ${res.statusText}`);
  return json;
}

const stateIcon = { starting: "…", working: "▶", waiting_input: "?", idle: "·", error: "✗", done: "✓", killed: "■" };

function printSessions(list) {
  if (!list.length) return console.log("(세션 없음)");
  for (const s of list) {
    const sug = s.suggestion ? `  ⇢ ${s.suggestion.kind}: ${s.suggestion.label}` : "";
    console.log(`${stateIcon[s.state] ?? " "} ${s.id}  ${s.name.padEnd(22)} ${s.preset.padEnd(12)} ${s.state.padEnd(13)} ${s.policy.padEnd(6)} ${s.cwd}`);
    if (s.goal) console.log(`    목표: ${s.goal}`);
    if (s.lastLine) console.log(`    └ ${s.lastLine}`);
    if (sug) console.log(sug);
  }
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [cmd, a1, a2] = positional;
  const asJson = (v) => console.log(JSON.stringify(v, null, 2));
  switch (cmd) {
    case "health": {
      const res = await fetch(`${baseUrl}/runner/health`);
      return asJson(await res.json());
    }
    case "sessions": {
      const { sessions } = await api("GET", "/sessions");
      return flags.json ? asJson(sessions) : printSessions(sessions);
    }
    case "create": {
      if (!flags.preset) throw new Error("--preset 필요 (claude-print, claude, codex-exec, codex, shell, custom)");
      const { session } = await api("POST", "/sessions", {
        preset: flags.preset,
        cwd: flags.cwd,
        prompt: flags.prompt,
        name: flags.name,
        goal: flags.goal ?? flags.prompt,
        policy: flags.policy,
        command: flags.command,
        tags: ["devhubctl"],
      });
      return flags.json ? asJson(session) : console.log(`created ${session.id} ${session.name} @ ${session.cwd}`);
    }
    case "send": {
      if (!a1 || a2 === undefined) throw new Error("usage: send <id> <text> [--no-enter]");
      const data = flags["no-enter"] ? a2 : `${a2}\r`;
      await api("POST", `/sessions/${a1}/input`, { data });
      return console.log("sent");
    }
    case "output": {
      if (!a1) throw new Error("usage: output <id> [--lines n]");
      const { lines } = await api("GET", `/sessions/${a1}/output?lines=${Number(flags.lines) || 60}`);
      return console.log(lines.join("\n"));
    }
    case "kill": {
      if (!a1) throw new Error("usage: kill <id>");
      await api("POST", `/sessions/${a1}/kill`);
      return console.log("killed");
    }
    case "workspace": {
      if (!a1) throw new Error("usage: workspace <id>");
      const { info } = await api("GET", `/sessions/${a1}/workspace`);
      if (flags.json) return asJson(info);
      const g = info.git;
      if (!g) return console.log(`${info.cwd}: git 저장소 아님`);
      console.log(`${info.cwd} [${g.branch}] +${g.insertions} -${g.deletions} (ahead ${g.ahead}, behind ${g.behind})`);
      for (const f of g.changed.slice(0, 30)) console.log(`  ${f.status.padEnd(2)} ${f.path}  +${f.insertions} -${f.deletions}`);
      for (const c of g.recentCommits) console.log(`  ${c.sha} ${c.subject} (${c.when})`);
      return;
    }
    case "events": {
      const { events } = await api("GET", `/events?limit=${Number(flags.limit) || 50}`);
      if (flags.json) return asJson(events);
      for (const e of events) console.log(`${new Date(e.ts).toLocaleTimeString()} ${e.level.padEnd(6)} ${e.actor.padEnd(10)} ${e.sessionId ?? "-"}  ${e.message}`);
      return;
    }
    case "chat": {
      if (!a1) throw new Error('usage: chat "지시" [--confirm]');
      const { turn } = await api("POST", "/chat", { text: a1, confirm: Boolean(flags.confirm) });
      for (const act of turn.actions ?? []) console.log(`  [${act.tool}] ${act.result.split("\n")[0].slice(0, 120)}`);
      return console.log(turn.text);
    }
    case "tunnel": {
      if (a1 === "status" || !a1) return asJson((await api("GET", "/tunnel")).status);
      // start/stop are WebSocket-only in the runner; use the dashboard for those.
      throw new Error("tunnel start/stop 은 대시보드(/control)에서 하세요. 러너 시작 시 RUNNER_TUNNEL=1 로 자동 시작도 가능합니다.");
    }
    default:
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0].replace(/^\/\*\*?\s?/, ""));
      process.exitCode = cmd ? 1 : 0;
  }
}

main().catch((e) => {
  console.error(`devhubctl: ${e.message}`);
  process.exitCode = 1;
});
