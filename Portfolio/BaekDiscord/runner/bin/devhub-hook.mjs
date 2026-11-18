#!/usr/bin/env node
/**
 * Claude Code hook → DevHub runner. Registered per session by the runner (`claude --settings`), for
 * the events in runner/src/hooks.ts. Reads the hook payload on stdin and posts it to the runner.
 *
 * It only reports. It prints nothing and always exits 0, so Claude Code behaves exactly as it would
 * without the hook, also when the runner is down or slow. Failures go to runner/.data/hook-errors.log
 * (one line, no secret, no payload).
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const startedAt = Date.now();
const SEND_TIMEOUT_MS = 3000;
const STDIN_TIMEOUT_MS = 2000;
const MAX_BODY = 200_000;

function logError(message) {
  try {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".data");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "hook-errors.log");
    // Keep the log from growing without bound: start over past 1MB.
    try {
      if (fs.statSync(file).size > 1_000_000) fs.truncateSync(file, 0);
    } catch {
      /* no file yet */
    }
    fs.appendFileSync(file, `${new Date().toISOString()} ${process.env.DEVHUB_SESSION ?? "-"} ${String(message).slice(0, 300)}\n`);
  } catch {
    /* nowhere to report: stay silent */
  }
}

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    const timer = setTimeout(() => resolve(data), STDIN_TIMEOUT_MS);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => {
      data += c;
    });
    process.stdin.on("end", () => {
      clearTimeout(timer);
      resolve(data);
    });
    process.stdin.on("error", () => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

async function main() {
  const url = process.env.DEVHUB_HOOK_URL;
  const session = process.env.DEVHUB_SESSION;
  const secret = process.env.DEVHUB_HOOK_SECRET;
  // Not a runner session (the settings file was reused elsewhere): nothing to do.
  if (!url || !session || !secret) return;

  let payload;
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    return logError("payload is not JSON");
  }
  // The runner needs the tool input (to show it and judge danger), not the tool's output.
  delete payload.tool_response;
  delete payload.last_assistant_message;
  let body = JSON.stringify({ id: randomUUID(), ts: startedAt, payload });
  if (body.length > MAX_BODY) {
    body = JSON.stringify({ id: randomUUID(), ts: startedAt, payload: { ...payload, tool_input: { _truncated: true } } });
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-devhub-session": session, "x-devhub-hook-secret": secret },
      body,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!res.ok) {
      const info = await res.json().catch(() => ({}));
      logError(`${payload.hook_event_name ?? "?"}: runner answered ${res.status} ${info.code ?? ""}`);
    }
  } catch (e) {
    logError(`${payload.hook_event_name ?? "?"}: ${e?.name === "TimeoutError" ? "runner did not answer in time" : `runner unreachable (${e?.cause?.code ?? e?.message ?? e})`}`);
  }
}

main()
  .catch((e) => logError(e?.message ?? e))
  // Exit at once: an idle keep-alive socket would otherwise hold the process for a few seconds.
  .finally(() => process.exit(0));
