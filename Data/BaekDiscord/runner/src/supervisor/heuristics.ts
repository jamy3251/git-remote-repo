import type { AgentState, SessionMode, SessionStatus, Suggestion } from "../protocol.js";

export type PromptKind = "yes_no" | "enter" | "menu" | "question" | "shell_prompt";

export interface Judgment {
  state: AgentState;
  reason: string;
  prompt: { kind: PromptKind; options?: string[] } | null;
  /** The recent output mentions something destructive; never auto-approve. */
  danger: boolean;
  dangerReason: string | null;
}

export interface HeuristicInput {
  tail: string[];
  lastOutputAt: number | null;
  createdAt: number;
  now: number;
  status: SessionStatus;
  exitCode: number | null;
  mode: SessionMode;
  preset: string;
}

/** Output has gone quiet for this long with no prompt → idle. */
const IDLE_AFTER_MS = 45_000;
/** Output within this window → still working. */
const WORKING_WITHIN_MS = 8_000;

const DANGER_PATTERNS: Array<[RegExp, string]> = [
  [/\brm\s+-rf?\b|\bRemove-Item\b.*-Recurse|\bdel\s+\/[sq]\b|\brmdir\s+\/s\b/i, "재귀 삭제 명령"],
  [/\bgit\s+push\b.*(--force|-f\b)|\bgit\s+reset\s+--hard\b|\bgit\s+clean\s+-[a-z]*f/i, "되돌리기 어려운 git 명령"],
  [/\bDROP\s+(TABLE|DATABASE|SCHEMA)\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i, "파괴적 SQL"],
  [/\bformat\s+[a-z]:|\bdiskpart\b|\bmkfs\b|\bdd\s+if=/i, "디스크 포맷/덮어쓰기"],
  [/\bshutdown\b|\breboot\b|\bRestart-Computer\b/i, "시스템 재시작"],
  [/\bnpm\s+publish\b|\bcargo\s+publish\b|\bvercel\s+(--prod|deploy)\b|\bgh\s+release\s+create\b/i, "외부 배포/배포"],
  [/\.env\b.*(secret|key|token)|\bAPI[_ ]?KEY\b|\bpassword\b/i, "비밀/자격 증명 언급"],
  [/\bchmod\s+-R\s+777\b|\bicacls\b.*\/grant\b/i, "권한 전면 개방"],
];

const YES_NO = /\((?:y\/n|y\/N|Y\/n|yes\/no)\)\s*:?\s*$|\[(?:y\/n|y\/N|Y\/n)\]\s*:?\s*$|\?\s*\((?:y|yes)\/(?:n|no)\)\s*$/i;
const ENTER = /press\s+(?:enter|any key|return)|enter\s+to\s+(?:continue|confirm|select)|\(esc to cancel\)|continue\?\s*$/i;
const MENU_ITEM = /^\s*(?:[❯>›]\s*)?\d+[.)]\s+\S/;
const CLAUDE_PERMISSION = /do you want to (?:proceed|make this edit|run this command|allow|create|continue)|allow (?:this|the) (?:tool|command|edit)|yes,? (?:and )?don'?t ask again/i;
const QUESTION_TAIL = /\?\s*$|:\s*$|›\s*$|❯\s*$/;
const SHELL_PROMPT = /^(?:PS\s+)?[A-Za-z]:\\.*>\s*$|^[^\n]*\$\s*$|^[^\n]*#\s*$|^>\s*$/;
const ERROR_LINE = /\b(?:error|exception|traceback|fatal|panic|failed|FAILED|npm ERR!|EACCES|ENOENT|segmentation fault)\b/i;
const CLAUDE_IDLE_BOX = /^[╭│╰].*$/;

function detectDanger(tail: string[]): { danger: boolean; reason: string | null } {
  const text = tail.slice(-25).join("\n");
  for (const [re, why] of DANGER_PATTERNS) if (re.test(text)) return { danger: true, reason: why };
  return { danger: false, reason: null };
}

function detectPrompt(tail: string[]): Judgment["prompt"] {
  const lines = tail.filter((l) => !CLAUDE_IDLE_BOX.test(l) || /\d+[.)]\s/.test(l));
  const last = lines[lines.length - 1] ?? "";
  const recent = lines.slice(-12).join("\n");

  if (YES_NO.test(last) || YES_NO.test(recent.split("\n").slice(-2).join(" "))) return { kind: "yes_no" };
  if (ENTER.test(recent)) return { kind: "enter" };

  const menuLines = lines.slice(-10).filter((l) => MENU_ITEM.test(l));
  if (menuLines.length >= 2 && (CLAUDE_PERMISSION.test(recent) || /[❯>›]\s*\d+[.)]/.test(recent))) {
    const options = menuLines.map((l) => l.replace(/^\s*[❯>›]?\s*/, "").trim()).slice(0, 6);
    return { kind: "menu", options };
  }
  if (CLAUDE_PERMISSION.test(recent)) return { kind: "menu", options: ["1. Yes", "2. No"] };
  if (SHELL_PROMPT.test(last)) return { kind: "shell_prompt" };
  if (QUESTION_TAIL.test(last) && last.length < 160) return { kind: "question" };
  return null;
}

export function judgeHeuristically(input: HeuristicInput): Judgment {
  const { danger, reason: dangerReason } = detectDanger(input.tail);

  if (input.status === "killed") return { state: "killed", reason: "사용자가 종료", prompt: null, danger, dangerReason };
  if (input.status === "error") return { state: "error", reason: "프로세스 시작 실패", prompt: null, danger, dangerReason };
  if (input.status === "exited") {
    const ok = input.exitCode === 0 || input.exitCode === null;
    return {
      state: ok ? "done" : "error",
      reason: ok ? "정상 종료" : `종료 코드 ${input.exitCode}`,
      prompt: null,
      danger,
      dangerReason,
    };
  }

  const sinceOutput = input.lastOutputAt ? input.now - input.lastOutputAt : input.now - input.createdAt;
  if (input.lastOutputAt === null && sinceOutput < WORKING_WITHIN_MS) {
    return { state: "starting", reason: "시작 중", prompt: null, danger, dangerReason };
  }

  const prompt = detectPrompt(input.tail);
  const recentlyActive = sinceOutput < WORKING_WITHIN_MS;

  if (prompt && prompt.kind !== "shell_prompt" && !recentlyActive) {
    const label =
      prompt.kind === "yes_no" ? "예/아니오 질문" : prompt.kind === "enter" ? "Enter 대기" : prompt.kind === "menu" ? "선택지 대기" : "질문 대기";
    return { state: "waiting_input", reason: label, prompt, danger, dangerReason };
  }
  if (prompt && prompt.kind !== "shell_prompt" && recentlyActive) {
    // A prompt appeared but output is still flowing: wait one more tick before calling it.
    return { state: "working", reason: "출력 중 (프롬프트 감지됨)", prompt, danger, dangerReason };
  }

  if (recentlyActive) return { state: "working", reason: "출력 중", prompt: null, danger, dangerReason };

  const lastFew = input.tail.slice(-5).join("\n");
  if (ERROR_LINE.test(lastFew) && sinceOutput > WORKING_WITHIN_MS) {
    return { state: "error", reason: "최근 출력에 오류", prompt: null, danger, dangerReason };
  }
  if (prompt?.kind === "shell_prompt") return { state: "idle", reason: "셸 프롬프트에서 대기", prompt, danger, dangerReason };
  if (sinceOutput > IDLE_AFTER_MS) return { state: "idle", reason: `${Math.round(sinceOutput / 1000)}초간 출력 없음`, prompt: null, danger, dangerReason };
  return { state: "working", reason: "잠시 출력 없음", prompt: null, danger, dangerReason };
}

/**
 * A safe, rule-based proposal when no LLM brain is available. Only trivially safe inputs are
 * proposed as `respond`; anything ambiguous or dangerous is escalated to a human.
 */
export function heuristicSuggestion(j: Judgment): Omit<Suggestion, "id" | "createdAt"> | null {
  if (j.state !== "waiting_input" || !j.prompt) return null;
  if (j.danger) {
    return {
      kind: "escalate",
      label: "사람 확인 필요",
      rationale: `위험 신호: ${j.dangerReason}. 자동 응답하지 않습니다.`,
      confidence: 0.9,
      source: "heuristic",
    };
  }
  switch (j.prompt.kind) {
    case "enter":
      return { kind: "respond", input: "\r", label: "Enter 보내기", rationale: "계속 진행을 묻는 프롬프트입니다.", confidence: 0.8, source: "heuristic" };
    case "yes_no":
      return { kind: "escalate", label: "예/아니오 결정 필요", rationale: "맥락 없이 예/아니오를 고를 수 없습니다.", confidence: 0.6, source: "heuristic" };
    case "menu":
      return {
        kind: "escalate",
        label: "선택지 결정 필요",
        rationale: `선택지: ${(j.prompt.options ?? []).join(" / ")}`,
        confidence: 0.6,
        source: "heuristic",
      };
    default:
      return { kind: "escalate", label: "답변 필요", rationale: "에이전트가 질문하고 있습니다.", confidence: 0.5, source: "heuristic" };
  }
}

/** Inputs the supervisor may send on its own under the `auto` policy. Everything else needs a human. */
export function isSafeAutoInput(input: string): boolean {
  const t = input.trim().toLowerCase();
  return t === "" || t === "y" || t === "yes" || t === "1" || t === "2" || t === "n" || t === "no" || /^[1-9]$/.test(t);
}
