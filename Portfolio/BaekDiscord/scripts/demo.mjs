#!/usr/bin/env node
// `npm run demo`: the dashboard with fake sessions. Needs nothing but `npm install`:
// no Claude Code, no API key, no token. Starts the Next.js app and a fake runner on loopback,
// then opens the browser. Ctrl+C stops both.
//   --check      start, confirm /control answers 200 through the fake runner, then exit (CI)
//   --no-open    do not open a browser (also when CI or DEMO_NO_OPEN=1)
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const check = args.has("--check");
const open = !check && !args.has("--no-open") && !process.env.CI && process.env.DEMO_NO_OPEN !== "1";
const isWindows = process.platform === "win32";

function fail(message, fix) {
  console.error(`[demo] ${message}`);
  if (fix) console.error(`[demo] 고치는 법: ${fix}`);
  process.exit(1);
}

const major = Number(process.versions.node.split(".")[0]);
if (major < 20) fail(`Node ${process.versions.node}에서는 실행되지 않습니다.`, "Node 22를 설치하세요(.nvmrc 참고).");

function resolveFrom(dir, id) {
  try {
    return createRequire(path.join(dir, "package.json")).resolve(id);
  } catch {
    return null;
  }
}
const nextBin = resolveFrom(path.join(root, "web"), "next/dist/bin/next");
const tsxCli = resolveFrom(path.join(root, "runner"), "tsx/cli");
if (!nextBin || !tsxCli) fail("의존성이 설치되어 있지 않습니다.", `${root} 에서 npm install 을 먼저 실행하세요.`);

function freePort(start) {
  return new Promise((resolve, reject) => {
    const tryPort = (p) => {
      if (p > start + 50) return reject(new Error(`포트 ${start}~${start + 50}가 모두 사용 중입니다.`));
      const s = net.createServer();
      s.once("error", () => tryPort(p + 1));
      s.once("listening", () => s.close(() => resolve(p)));
      s.listen(p, "127.0.0.1");
    };
    tryPort(start);
  });
}

const children = [];
let stopping = false;
function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    if (c.exitCode !== null || !c.pid) continue;
    if (isWindows) spawn("taskkill", ["/pid", String(c.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    else c.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 800).unref();
}
process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

function start(name, file, argv, cwd, env, onLine) {
  const child = spawn(process.execPath, [file, ...argv], { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  children.push(child);
  const tail = [];
  const read = (stream) => {
    let rest = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      const lines = (rest + chunk).split(/\r?\n/);
      rest = lines.pop() ?? "";
      for (const line of lines) {
        tail.push(line);
        if (tail.length > 20) tail.shift();
        onLine?.(line);
      }
    });
  };
  read(child.stdout);
  read(child.stderr);
  child.on("exit", (code) => {
    if (stopping) return;
    console.error(`[demo] ${name}가 멈췄습니다 (코드 ${code ?? "?"}). 마지막 출력:`);
    for (const l of tail) console.error(`  ${l}`);
    stopAll(1);
  });
  return child;
}

async function waitFor(url, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (stopping) return false;
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status < 500) return res.status;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

function openBrowser(url) {
  const [cmd, argv] = isWindows ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, argv, { stdio: "ignore", detached: true, windowsHide: true }).unref();
  } catch {
    /* printing the address is enough */
  }
}

const webPort = await freePort(Number(process.env.DEMO_WEB_PORT ?? 3100)).catch((e) => fail(e.message, "DEMO_WEB_PORT로 다른 시작 포트를 주세요."));
console.log("[demo] 웹 앱과 데모 러너를 띄웁니다. 첫 실행은 화면 컴파일에 30초쯤 걸립니다.");
start("웹 앱(next dev)", nextBin, ["dev", "-p", String(webPort), "-H", "127.0.0.1"], path.join(root, "web"), { NEXT_TELEMETRY_DISABLED: "1" });

let demoPort = null;
start("데모 러너", tsxCli, ["src/demo/index.ts"], path.join(root, "runner"), { DEMO_WEB: `http://127.0.0.1:${webPort}` }, (line) => {
  const m = line.match(/^DEMO_READY (\d+)/);
  if (m) demoPort = Number(m[1]);
  else if (line.startsWith("[demo]")) console.error(line);
});

const t0 = Date.now();
while (demoPort === null && Date.now() - t0 < 30_000 && !stopping) await new Promise((r) => setTimeout(r, 200));
if (demoPort === null) {
  console.error("[demo] 데모 러너가 30초 안에 뜨지 않았습니다.");
  stopAll(1);
} else {
  const status = await waitFor(`http://127.0.0.1:${demoPort}/control`, 180_000);
  const url = `http://127.0.0.1:${demoPort}/control#rt=demo`;
  if (check) {
    if (status === 200) console.log(`[demo] 확인 통과: /control 200 (포트 ${demoPort})`);
    else console.error(`[demo] 확인 실패: /control 응답 ${status || "없음"}`);
    stopAll(status === 200 ? 0 : 1);
  } else if (!status) {
    console.error("[demo] 웹 앱이 3분 안에 응답하지 않았습니다.");
    stopAll(1);
  } else {
    if (open) openBrowser(url);
    console.log("[demo] 끝내려면 Ctrl+C");
    console.log(url);
  }
}
