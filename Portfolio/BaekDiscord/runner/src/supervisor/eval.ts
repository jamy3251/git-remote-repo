/**
 * `npm run eval:supervisor`: score the supervisor against what people actually did.
 *
 *   npm run eval:supervisor -w runner                        # .data/decisions.jsonl
 *   npm run eval:supervisor -w runner -- --file <path> --json
 *   npm run eval:supervisor -w runner -- --engine claude-cli --limit 20
 *
 * Always: aggregate the records as written, and re-run today's heuristic on the stored inputs.
 * With `--engine api|claude-cli --limit N`: also put the stored (masked) inputs of the last N
 * decisions a person answered through that model engine again and compare its answer with the
 * person's. This calls a model and costs tokens, so `--limit` is required (1 to 500).
 * Exit codes: 0 = done (also when samples are too few; the output says so), 1 = no log, unreadable,
 * or the engine is not available, 2 = bad arguments.
 */
import fs from "node:fs";
import path from "node:path";
import { readJsonl } from "../store/files.js";
import { MIN_SAMPLES, computeMetrics, join, rate, replayHeuristic, sameAnswer, type LogRecord } from "./decisions.js";
import { createBrain, type Brain } from "./brain.js";
import type { Judgment, PromptKind } from "./heuristics.js";
import type { RateStat } from "../protocol.js";

export const ENGINE_LIMIT_MAX = 500;

export interface EngineReplay {
  engine: string;
  model: string | null;
  /** Decisions sent to the model. */
  asked: number;
  /** Left out: flagged dangerous when recorded, so the engine is never asked about them. */
  skippedDanger: number;
  respond: number;
  escalate: number;
  wait: number;
  errors: number;
  /** Of the answers the model proposed, how many match what the person did. */
  agreement: RateStat & { undetermined: number };
  tokens: { input: number; output: number };
}

export interface EvalResult {
  file: string;
  skippedLines: number;
  metrics: ReturnType<typeof computeMetrics>;
  replay: ReturnType<typeof replayHeuristic>;
  baseline: { name: string; autoSends: number; wrongAutoSends: number };
  engineReplay?: EngineReplay;
  status: "ok" | "insufficient_samples";
}

function load(file: string): { records: LogRecord[]; skipped: number } {
  return readJsonl<LogRecord>(file);
}

export function evaluate(file: string): EvalResult {
  const { records, skipped } = load(file);
  const metrics = computeMetrics(records);
  const replay = replayHeuristic(records);
  return {
    file,
    skippedLines: skipped,
    metrics,
    replay,
    // "Always ask a person": never sends on its own, so it never sends a wrong answer either.
    baseline: { name: "항상 사람에게 올림", autoSends: 0, wrongAutoSends: 0 },
    status: metrics.approval.enough && metrics.autoAgreement.enough ? "ok" : "insufficient_samples",
  };
}

/** Re-run a model engine on the newest `limit` decisions a person answered. */
export async function replayEngine(records: LogRecord[], brain: Brain, limit: number, tokens = { input: 0, output: 0 }): Promise<EngineReplay> {
  const answered = join(records).filter((r) => r.o && r.o.kind !== "reverted" && !r.d.autoSent);
  const rows = answered.slice(-limit);
  const out = { asked: 0, skippedDanger: 0, respond: 0, escalate: 0, wait: 0, errors: 0 };
  let hit = 0;
  let judged = 0;
  let undetermined = 0;
  for (const r of rows) {
    const j = r.d.judgment;
    if (j.danger) {
      out.skippedDanger += 1;
      continue;
    }
    const heuristic: Judgment = { state: j.state, reason: j.reason, prompt: j.promptKind ? { kind: j.promptKind as PromptKind } : null, danger: false, dangerReason: null };
    out.asked += 1;
    let decision;
    try {
      // The record keeps no session name or folder; the tail and goal are what the judgment reads.
      decision = await brain.judge({ sessionName: r.d.sessionId, preset: r.d.preset, cwd: "(기록에 없음)", goal: r.d.goal, tail: r.d.input.tail, heuristic });
    } catch {
      decision = null;
    }
    if (!decision) {
      out.errors += 1;
      continue;
    }
    if (decision.action === "wait") out.wait += 1;
    else if (decision.action === "escalate" || decision.input === undefined) out.escalate += 1;
    else {
      out.respond += 1;
      const same = sameAnswer(decision.input, r.o!);
      if (same === null) undetermined += 1;
      else {
        judged += 1;
        if (same) hit += 1;
      }
    }
  }
  return { engine: brain.kind, model: brain.model, ...out, agreement: { ...rate(hit, judged), undetermined }, tokens };
}

const pct = (r: RateStat): string => (r.enough && r.rate !== null ? `${(r.rate * 100).toFixed(1)}% (${r.hit}/${r.total})` : `표본 부족 (${r.hit}/${r.total}, ${MIN_SAMPLES}건 필요)`);
const mins = (ms: number | null): string => (ms === null ? "-" : `${(ms / 60_000).toFixed(1)}분`);

export function formatText(r: EvalResult): string {
  const m = r.metrics;
  const e = r.engineReplay;
  return [
    `판단 기록: ${r.file}`,
    `  판단 ${m.decisions}건, 사람이 답한 것 ${m.answered}건, 자율 전송 ${m.autoSent}건${r.skippedLines ? `, 깨진 줄 ${r.skippedLines}개 건너뜀` : ""}`,
    "",
    `(1) 제안을 그대로 승인한 비율: ${pct(m.approval)}`,
    `(2) 엔진이 보내도 된다고 한 건의 사람 응답 일치율: ${pct(m.autoAgreement)}, 판정 불가 ${m.autoAgreement.undetermined}건`,
    `    기준선(${r.baseline.name}): 자율 전송 ${r.baseline.autoSends}건, 잘못 보낸 것 ${r.baseline.wrongAutoSends}건`,
    "",
    `방치 시간 중앙값: ${mins(m.waitMedianMs)} (표본 ${m.waitSamples})`,
    `오늘 개입: ${m.interventionsToday}회`,
    `사고: 자율 응답을 사람이 되돌림 ${m.incidents.autoReverted}건, 5분 넘게 놓친 대기 ${m.incidents.missedWaits}건`,
    "",
    `휴리스틱 재실행: ${r.replay.replayed}건, 기록 당시와 다른 제안 ${r.replay.changed}건, 사람 응답 일치 ${pct(r.replay.agreement)}`,
    ...(e
      ? [
          "",
          `모델 재실행(${e.engine}${e.model ? ` / ${e.model}` : ""}): 물어본 것 ${e.asked}건, 위험 표시라 제외 ${e.skippedDanger}건`,
          `  응답 제안 ${e.respond}건, 사람에게 올림 ${e.escalate}건, 기다림 ${e.wait}건, 오류 ${e.errors}건`,
          `  제안한 응답의 사람 응답 일치: ${pct(e.agreement)}, 판정 불가 ${e.agreement.undetermined}건`,
          `  토큰: 입력 ${e.tokens.input.toLocaleString()}, 출력 ${e.tokens.output.toLocaleString()}`,
        ]
      : []),
    r.status === "insufficient_samples" ? "\n상태: 표본 부족. 비율은 50건이 쌓인 뒤 봅니다." : "\n상태: ok",
  ].join("\n");
}

const USAGE = "사용법: eval:supervisor [--file <decisions.jsonl>] [--json] [--engine api|claude-cli --limit <1-500>]";

/** `brain` is for tests; the CLI builds the engine from `--engine` and the environment. */
export async function main(argv: string[], deps: { brain?: Brain } = {}): Promise<number> {
  let file = path.join(process.cwd(), ".data", "decisions.jsonl");
  let json = false;
  let engine: string | null = null;
  let limit: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") json = true;
    else if (a === "--file" && argv[i + 1]) file = path.resolve(argv[++i]);
    else if (a === "--engine" && argv[i + 1]) engine = argv[++i];
    else if (a === "--limit" && argv[i + 1]) limit = Number(argv[++i]);
    else {
      console.error(`알 수 없는 인자이거나 값이 빠졌습니다: ${a}\n${USAGE}`);
      return 2;
    }
  }
  if (engine !== null && engine !== "api" && engine !== "claude-cli") {
    console.error(`--engine은 api 또는 claude-cli입니다 (받은 값: ${engine}).\n${USAGE}`);
    return 2;
  }
  if ((engine === null) !== (limit === null)) {
    console.error(`--engine과 --limit은 같이 씁니다. 모델을 부르면 비용이 들기 때문에 건수 상한이 필요합니다.\n${USAGE}`);
    return 2;
  }
  if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > ENGINE_LIMIT_MAX)) {
    console.error(`--limit은 1에서 ${ENGINE_LIMIT_MAX} 사이 정수입니다.\n${USAGE}`);
    return 2;
  }
  if (!fs.existsSync(file)) {
    console.error(`판단 기록이 없습니다: ${file}\n러너를 슈퍼바이저를 켠 채 돌리면 쌓입니다. 다른 파일은 --file로 지정하세요.`);
    return 1;
  }
  let result: EvalResult;
  try {
    result = evaluate(file);
  } catch (e) {
    console.error(`판단 기록을 읽지 못했습니다: ${file} (${(e as Error).message})`);
    return 1;
  }
  if (result.metrics.decisions === 0 && result.skippedLines > 0) {
    console.error(`판단 기록의 모든 줄이 깨져 있습니다: ${file} (${result.skippedLines}줄)`);
    return 1;
  }
  if (engine && limit) {
    const tokens = { input: 0, output: 0 };
    const brain =
      deps.brain ??
      createBrain({
        preference: engine,
        model: process.env.SUPERVISOR_MODEL?.trim() || null,
        apiKey: process.env.ANTHROPIC_API_KEY?.trim() || null,
        cliTimeoutMs: Number(process.env.SUPERVISOR_CLI_TIMEOUT_MS ?? 120_000),
        onUsage: (i, o) => {
          tokens.input += i;
          tokens.output += o;
        },
      });
    if (brain.kind === "heuristic") {
      console.error(engine === "api" ? "api 엔진을 쓸 수 없습니다: ANTHROPIC_API_KEY를 설정하세요." : "claude-cli 엔진을 쓸 수 없습니다: claude가 PATH에 없습니다.");
      return 1;
    }
    result.engineReplay = await replayEngine(load(file).records, brain, limit, tokens);
  }
  console.log(json ? JSON.stringify(result, null, 2) : formatText(result));
  return 0;
}
