#!/usr/bin/env node
// Starts the runner and the web app together. `a & b` in npm scripts runs them one after the other
// on Windows (cmd.exe), so the web app never came up there. No dependencies: plain child processes.
import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";
const npm = isWindows ? "npm.cmd" : "npm";
const tasks = [
  { name: "runner", args: ["run", "dev", "-w", "runner"] },
  { name: "web", args: ["run", "dev", "-w", "web"] },
];

const children = [];
let stopping = false;

function prefix(name, stream, out) {
  let rest = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    const lines = (rest + chunk).split(/\r?\n/);
    rest = lines.pop() ?? "";
    for (const line of lines) out.write(`[${name}] ${line}\n`);
  });
  stream.on("end", () => {
    if (rest) out.write(`[${name}] ${rest}\n`);
  });
}

function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    if (c.exitCode !== null || !c.pid) continue;
    if (isWindows) spawn("taskkill", ["/pid", String(c.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    else {
      try {
        process.kill(-c.pid, "SIGTERM");
      } catch {
        c.kill("SIGTERM");
      }
    }
  }
  setTimeout(() => process.exit(code), 500).unref();
}

for (const t of tasks) {
  // shell is needed on Windows to run npm.cmd (Node refuses .cmd without it since the 2024 fix).
  const child = spawn(npm, t.args, { stdio: ["ignore", "pipe", "pipe"], shell: isWindows, detached: !isWindows });
  children.push(child);
  prefix(t.name, child.stdout, process.stdout);
  prefix(t.name, child.stderr, process.stderr);
  child.on("error", (e) => {
    process.stderr.write(`[${t.name}] 시작 실패: ${e.message}\n`);
    stopAll(1);
  });
  child.on("exit", (code) => {
    if (stopping) return;
    process.stderr.write(`[${t.name}] 종료됨 (코드 ${code ?? "?"}). 나머지도 멈춥니다.\n`);
    stopAll(code ?? 1);
  });
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));
