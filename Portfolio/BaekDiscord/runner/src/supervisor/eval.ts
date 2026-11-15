/**
 * `npm run eval:supervisor`: score the supervisor against what people actually did.
 *
 *   npm run eval:supervisor -w runner                        # .data/decisions.jsonl
 *   npm run eval:supervisor -w runner -- --file <path> --json
 *
 * Two modes in one run: aggregate the records as written, and re-run today's heuristic on the
 * stored inputs. Model re-runs (`--engine`, `--limit`) are not built yet.
 * Exit codes: 0 = done (also when samples are too few; the output says so), 1 = no log or unreadable,
 * 2 = bad arguments.
 */
import fs from "node:fs";
import path from "node:path";
import { readJsonl } from "../store/files.js";
import { MIN_SAMPLES, computeMetrics, replayHeuristic, type LogRecord } from "./decisions.js";
import type { RateStat } from "../protocol.js";

export interface EvalResult {
  file: string;
  skippedLines: number;
  metrics: ReturnType<typeof computeMetrics>;
  replay: ReturnType<typeof replayHeuristic>;
  baseline: { name: string; autoSends: number; wrongAutoSends: number };
  status: "ok" | "insufficient_samples";
}

export function evaluate(file: string): EvalResult {
  const { records, skipped } = readJsonl<LogRecord>(file);
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

const pct = (r: RateStat): string => (r.enough && r.rate !== null ? `${(r.rate * 100).toFixed(1)}% (${r.hit}/${r.total})` : `표본 부족 (${r.hit}/${r.total}, ${MIN_SAMPLES}건 필요)`);
const mins = (ms: number | null): string => (ms === null ? "-" : `${(ms / 60_000).toFixed(1)}분`);

export function formatText(r: EvalResult): string {
  const m = r.metrics;
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
    r.status === "insufficient_samples" ? "\n상태: 표본 부족. 비율은 50건이 쌓인 뒤 봅니다." : "\n상태: ok",
  ].join("\n");
}

export function main(argv: string[]): number {
  let file = path.join(process.cwd(), ".data", "decisions.jsonl");
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") json = true;
    else if (a === "--file" && argv[i + 1]) file = path.resolve(argv[++i]);
    else if (a === "--engine" || a === "--limit") {
      console.error("모델 엔진 재실행(--engine, --limit)은 아직 없습니다. 지금은 기록 집계와 휴리스틱 재실행만 합니다.");
      return 2;
    } else {
      console.error(`알 수 없는 인자: ${a}\n사용법: eval:supervisor [--file <decisions.jsonl>] [--json]`);
      return 2;
    }
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
  console.log(json ? JSON.stringify(result, null, 2) : formatText(result));
  return 0;
}

