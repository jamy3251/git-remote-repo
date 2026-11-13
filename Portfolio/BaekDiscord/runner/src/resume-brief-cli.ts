/**
 * SessionStart hook entry: reads the hook payload (JSON on stdin: session_id, cwd, source) and
 * prints the resume brief, which Claude Code adds to the new session's context.
 * Run by hand with `--cwd <folder>`. Never fails the session: any error prints nothing.
 */
import { buildBrief } from "./resumebrief.js";

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const argCwd = process.argv.indexOf("--cwd") > 0 ? process.argv[process.argv.indexOf("--cwd") + 1] : undefined;
  let payload: { session_id?: string; cwd?: string; source?: string } = {};
  try {
    payload = JSON.parse((await readStdin()) || "{}") as typeof payload;
  } catch {
    payload = {};
  }
  // Compaction keeps the conversation; a brief of the same session would only repeat it.
  if (payload.source === "compact") return;
  const cwd = argCwd ?? payload.cwd ?? process.cwd();
  process.stdout.write(`${await buildBrief({ cwd, sessionId: payload.session_id ?? null })}\n`);
}

main().catch(() => undefined);
