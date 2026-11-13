import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { CrossReview, ReviewFinding, ReviewMode, ReviewerId, WorkLogEntry } from "./protocol.js";
import { stripAnsi } from "./supervisor/ansi.js";

const run = promisify(execFile);

/**
 * Cross-verification: work done by one AI is reviewed by a different one (Claude Code ↔ Codex),
 * read-only, against the original instruction and the session's own diff. Same idea as gstack's
 * `/codex review`: an outside voice with a pass/fail gate, not a rubber stamp.
 */

export const REVIEW_MARKER = "REVIEW_RESULT";
const MAX_DIFF = 60_000;
const MAX_UNTRACKED_FILE = 20_000;

/** The reviewer is the other AI than the one that did the work. */
export function pickReviewer(authorPreset: string, requested: ReviewerId | "auto" | undefined, available: Record<ReviewerId, boolean>): ReviewerId | null {
  if (requested && requested !== "auto") return available[requested] ? requested : null;
  const other: ReviewerId = authorPreset.startsWith("codex") ? "claude" : "codex";
  if (available[other]) return other;
  const fallback: ReviewerId = other === "codex" ? "claude" : "codex";
  return available[fallback] ? fallback : null;
}

/** The session's own changes: tracked diff of its files plus new (untracked) files, capped. */
export async function collectDiff(repoRoot: string, files: string[]): Promise<string> {
  if (!files.length) return "";
  let out = "";
  try {
    const { stdout } = await run("git", ["diff", "--no-color", "--no-ext-diff", "HEAD", "--", ...files], { cwd: repoRoot, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: "utf8", timeout: 10_000 });
    out = stdout;
  } catch {
    out = "";
  }
  for (const f of files) {
    if (out.length >= MAX_DIFF) break;
    if (out.includes(`b/${f}\n`) || out.includes(`b/${f}\r\n`)) continue;
    const full = path.join(repoRoot, f);
    try {
      const st = fs.statSync(full);
      if (!st.isFile() || st.size > MAX_UNTRACKED_FILE) continue;
      const body = fs.readFileSync(full, "utf8");
      out += `\ndiff --git a/${f} b/${f}\nnew file\n+++ b/${f}\n${body
        .split("\n")
        .map((l) => `+${l}`)
        .join("\n")}\n`;
    } catch {
      /* deleted or unreadable */
    }
  }
  return out.length > MAX_DIFF ? `${out.slice(0, MAX_DIFF)}\n… (diff가 길어 ${out.length - MAX_DIFF}자 생략. 필요하면 파일을 직접 읽으세요)` : out;
}

export function buildReviewPrompt(entry: WorkLogEntry, diff: string, mode: ReviewMode, reviewer: ReviewerId): string {
  const author = entry.preset.startsWith("codex") ? "Codex" : entry.preset.startsWith("claude") ? "Claude Code" : `${entry.preset} 세션`;
  const role =
    mode === "challenge"
      ? "적대적 검증자입니다. 이 변경을 깨뜨릴 입력·경계 조건·동시성·보안 구멍을 적극적으로 찾으세요. 그럴듯한 추측은 지적이 아닙니다. 재현 가능한 시나리오만 쓰세요."
      : "독립 코드 리뷰어입니다. 지시대로 됐는지, 버그·회귀·빠진 경우·보안 문제가 없는지 판정하세요. 취향 문제는 지적하지 마세요.";
  return [
    `당신은 ${author}가 한 작업을 검토하는 ${reviewer === "codex" ? "Codex" : "Claude"}입니다. ${role}`,
    "파일을 수정하지 마세요. 읽기와 읽기 전용 명령(git diff, 테스트 실행 등)만 쓰세요.",
    "",
    `작업 폴더: ${entry.cwd}`,
    entry.prompt ? `원래 지시:\n${entry.prompt.slice(0, 3000)}` : entry.goal ? `목표: ${entry.goal}` : "원래 지시: (기록 없음, diff와 출력으로 의도를 추정)",
    `작업 결과: ${entry.status}${entry.exitCode !== null ? ` code ${entry.exitCode}` : ""} · ${entry.summary}`,
    "",
    "작업 세션의 마지막 출력:",
    entry.tail.slice(-30).join("\n"),
    "",
    diff ? `이 세션이 만든 변경(diff):\n${diff}` : "변경 diff 없음. 출력과 폴더 상태로 판단하세요.",
    "",
    "판정 기준: pass = 지시를 충족하고 고쳐야 할 문제가 없음. fail = P1(틀린 동작·데이터 손실·보안) 또는 고쳐야 할 P2가 있음. uncertain = 판단에 필요한 정보가 부족함.",
    `마지막에 반드시 ${REVIEW_MARKER} 라고만 쓴 줄을 하나 출력하고, 그 다음 줄에 아래 모양의 JSON 하나만 출력하세요(값은 한국어).`,
    "모양: { verdict: pass 또는 fail 또는 uncertain, summary: 한두 문장, findings: [ { severity: P1·P2·P3 중 하나, file: 경로, line: 숫자, issue: 무엇이 문제인지, fix: 어떻게 고칠지 } ] }",
    "키와 문자열은 큰따옴표로 감싼 올바른 JSON이어야 합니다. 지적이 없으면 findings는 빈 배열.",
  ].join("\n");
}

function lastJsonAfter(text: string, marker: string): Record<string, unknown> | null {
  const at = text.lastIndexOf(marker);
  if (at < 0) return null;
  const tail = text.slice(at + marker.length, at + marker.length + 40_000);
  // Try each "{" from the left so the first complete object after the marker wins.
  for (let i = tail.indexOf("{"); i >= 0; i = tail.indexOf("{", i + 1)) {
    for (let j = tail.lastIndexOf("}"); j > i; j = tail.lastIndexOf("}", j - 1)) {
      try {
        const v = JSON.parse(tail.slice(i, j + 1)) as Record<string, unknown>;
        if (v && typeof v === "object" && "verdict" in v) return v;
      } catch {
        /* keep shrinking */
      }
    }
  }
  return null;
}

const SEVERITIES = new Set(["P1", "P2", "P3"]);

/** Parse the reviewer's final JSON out of its raw terminal output. */
export function parseReview(raw: string): Pick<CrossReview, "verdict" | "summary" | "findings"> | null {
  const text = stripAnsi(raw).replace(/\r/g, "");
  const j = lastJsonAfter(text, REVIEW_MARKER);
  if (!j) return null;
  const verdict = j.verdict === "pass" || j.verdict === "fail" ? j.verdict : "uncertain";
  const findings: ReviewFinding[] = Array.isArray(j.findings)
    ? j.findings
        .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
        .map((f) => ({
          severity: (SEVERITIES.has(String(f.severity)) ? String(f.severity) : "P3") as ReviewFinding["severity"],
          file: typeof f.file === "string" ? f.file.slice(0, 300) : "",
          line: typeof f.line === "number" && f.line > 0 ? Math.floor(f.line) : null,
          issue: typeof f.issue === "string" ? f.issue.slice(0, 600) : "",
          fix: typeof f.fix === "string" ? f.fix.slice(0, 600) : "",
        }))
        .filter((f) => f.issue)
        .slice(0, 20)
    : [];
  findings.sort((a, b) => a.severity.localeCompare(b.severity));
  return { verdict, summary: typeof j.summary === "string" ? j.summary.slice(0, 600) : "", findings };
}

/** Instruction for the original AI to fix what the reviewer found. */
export function fixPrompt(entry: WorkLogEntry, review: CrossReview): string {
  const items = review.findings
    .filter((f) => f.severity !== "P3")
    .map((f) => `- [${f.severity}] ${f.file}${f.line ? `:${f.line}` : ""} — ${f.issue}${f.fix ? ` → ${f.fix}` : ""}`);
  return [
    `목표: 교차검증(${review.reviewer === "codex" ? "Codex" : "Claude"})이 지적한 문제를 고친다.`,
    "",
    "지적 사항:",
    ...(items.length ? items : review.findings.map((f) => `- [${f.severity}] ${f.issue}`)),
    "",
    "할 일:",
    "1. 각 지적이 실제로 맞는지 코드를 읽어 먼저 확인한다. 틀린 지적이면 고치지 말고 근거를 보고에 적는다.",
    "2. 맞는 지적만 최소 변경으로 고친다.",
    "3. 관련 테스트나 실행으로 확인한다.",
    "",
    "지키기: 커밋·푸시·삭제·배포·새 의존성 추가는 하지 않는다.",
    "보고: 지적마다 고침/고치지 않음(이유)과 확인 결과를 짧게 쓴다.",
    entry.prompt ? `\n참고, 원래 지시:\n${entry.prompt.slice(0, 1500)}` : "",
  ].join("\n");
}
