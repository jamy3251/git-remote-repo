import path from "node:path";
import type { Brain } from "./supervisor/brain.js";
import type { RefinedPrompt, WorkLogEntry } from "./protocol.js";

/**
 * The "prompt model" side of the split: a quick completion (API, or `claude -p` without a key)
 * turns a rough phone instruction into an executable task, and turns a finished session's output
 * into a short result. The actual work stays with the CLI agents (Claude Code, Codex).
 */

export interface RefineContext {
  cwd: string;
  /** Project markers of the folder (git, claude, node, ...). */
  markers: string[];
  branch: string | null;
}

const REFINE_SYSTEM = `당신은 개발자가 휴대폰으로 짧게 쓴 지시를, PC의 코딩 에이전트(Claude Code)가 혼자 끝까지 수행할 수 있는 작업 지시서로 다듬는 역할입니다.

원칙:
- 사용자의 의도를 바꾸거나 범위를 넓히지 마세요. 모호한 부분은 가장 보수적인 해석을 고르고 notes에 적으세요.
- prompt는 한국어로, 아래 순서의 짧은 섹션으로 쓰세요:
  목표: 한두 문장
  할 일: 번호 목록 (먼저 관련 파일을 읽고 현재 동작을 확인하는 단계 포함)
  지키기: 커밋·푸시·삭제·배포·의존성 추가는 하지 않는다(사용자가 명시하면 예외), 기존 코드 스타일을 따른다
  완료 기준: 확인 가능한 조건(테스트 통과, 빌드 성공, 특정 동작)
  보고: 마지막에 바꾼 파일과 결과, 남은 문제를 짧게 요약
- goal은 슈퍼바이저가 판단에 쓸 완료 기준 한 줄입니다.
- preset: 한 번 실행하고 끝나는 작업이면 "claude-print", 대화하며 진행해야 하면 "claude".
- 반드시 JSON 하나만 출력하세요:
{"title":"20자 이내 작업 이름","prompt":"...","goal":"...","preset":"claude-print","notes":["..."]}`;

const SUMMARY_SYSTEM = `당신은 CLI 코딩 에이전트 세션의 마지막 출력과 git 변경 내역을 보고, 무엇을 했고 결과가 어떤지 휴대폰 알림처럼 짧게 요약합니다.
한국어 2~3문장. 성공/실패 여부, 바뀐 것, 사람이 확인할 것을 순서대로. 추측은 "~로 보임"으로 표시. 마크다운 금지.`;

function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Deterministic fallback so the feature works without any model. */
export function templateRefine(text: string, ctx: RefineContext): RefinedPrompt {
  const raw = text.trim().replace(/\s+/g, " ");
  const folder = path.basename(ctx.cwd) || ctx.cwd;
  const checks = ctx.markers.includes("node")
    ? "관련 테스트·타입 검사·린트가 통과한다"
    : ctx.markers.includes("python")
      ? "관련 테스트(pytest 등)가 통과하거나 스크립트가 오류 없이 실행된다"
      : "변경한 부분이 오류 없이 동작함을 직접 확인한다";
  const prompt = [
    `목표: ${raw}`,
    "",
    "할 일:",
    `1. ${folder} 폴더에서 관련 파일을 먼저 읽고 현재 동작을 확인한다.`,
    "2. 필요한 최소한의 변경으로 목표를 달성한다.",
    "3. 변경 후 직접 실행하거나 테스트로 확인한다.",
    "",
    "지키기: 커밋·푸시·삭제·배포·새 의존성 추가는 하지 않는다. 기존 코드 스타일을 따른다.",
    `완료 기준: ${checks}.`,
    "보고: 마지막에 바꾼 파일, 확인 결과, 남은 문제를 짧게 요약한다.",
  ].join("\n");
  return {
    title: raw.slice(0, 20),
    prompt,
    goal: `${raw.slice(0, 120)} — ${checks}`,
    preset: "claude-print",
    notes: [],
    source: "template",
  };
}

export async function refinePrompt(brain: Brain, text: string, ctx: RefineContext): Promise<RefinedPrompt> {
  const fallback = templateRefine(text, ctx);
  if (brain.kind === "heuristic") return fallback;
  const user = [
    `작업 폴더: ${ctx.cwd}`,
    `프로젝트 표시: ${ctx.markers.join(", ") || "없음"}`,
    ctx.branch ? `git 브랜치: ${ctx.branch}` : "",
    "",
    "사용자 지시:",
    text.trim().slice(0, 4000),
  ]
    .filter((l) => l !== null)
    .join("\n");
  const out = await brain.complete(REFINE_SYSTEM, [{ role: "user", content: user }]);
  const j = out ? extractJson(out) : null;
  const prompt = j ? str(j.prompt, 6000) : "";
  if (!j || !prompt) return fallback;
  return {
    title: str(j.title, 40) || fallback.title,
    prompt,
    goal: str(j.goal, 300) || fallback.goal,
    preset: j.preset === "claude" ? "claude" : "claude-print",
    notes: Array.isArray(j.notes) ? j.notes.map((n) => str(n, 200)).filter(Boolean).slice(0, 5) : [],
    source: "brain",
  };
}

const NOISE = /^(\[runner\]|PS [A-Z]:\\|[>$#]\s*$|[─━═\-\s]+$)/;

/** Summary without a model: exit status, git delta, and the last meaningful line. */
export function heuristicSummary(e: Pick<WorkLogEntry, "status" | "exitCode" | "tail" | "git">): string {
  const outcome =
    e.status === "killed" ? "중간에 종료됨" : e.status === "error" ? "실행 오류" : e.exitCode === 0 ? "정상 종료" : e.exitCode === null ? "종료" : `실패 (code ${e.exitCode})`;
  const delta = e.git && (e.git.insertions || e.git.deletions) ? ` · 변경 +${e.git.insertions} -${e.git.deletions}` : "";
  const last = [...e.tail].reverse().find((l) => l.trim().length > 3 && !NOISE.test(l.trim()));
  return `${outcome}${delta}${last ? ` · ${last.trim().slice(0, 160)}` : ""}`;
}

export async function summarizeWork(brain: Brain, e: WorkLogEntry): Promise<string | null> {
  if (brain.kind === "heuristic") return null;
  const user = [
    `세션: ${e.name} (${e.preset}) · 폴더 ${e.cwd}`,
    e.goal ? `목표: ${e.goal}` : "",
    e.prompt ? `지시: ${e.prompt.slice(0, 1500)}` : "",
    `종료: ${e.status}${e.exitCode !== null ? ` code ${e.exitCode}` : ""}`,
    e.git ? `git: ${e.git.branch} +${e.git.insertions} -${e.git.deletions} 파일 ${e.git.files.slice(0, 10).join(", ")}` : "",
    "",
    "마지막 출력:",
    e.tail.slice(-60).join("\n"),
  ]
    .filter(Boolean)
    .join("\n");
  const out = await brain.complete(SUMMARY_SYSTEM, [{ role: "user", content: user }]);
  return out ? out.trim().slice(0, 600) : null;
}
