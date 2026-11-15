import type { DecisionMetrics, RateStat } from "./protocol";

/** "80% (40/50)" once there are enough samples, otherwise "표본 부족 3/50" so a tiny sample never reads as a rate. */
export function rateText(r: RateStat, min = 50): string {
  if (r.enough && r.rate !== null) return `${Math.round(r.rate * 100)}% (${r.hit}/${r.total})`;
  return `표본 부족 ${r.total}/${min}`;
}

export function minutesText(ms: number | null): string {
  if (ms === null) return "-";
  if (ms < 60_000) return `${Math.round(ms / 1000)}초`;
  return `${(ms / 60_000).toFixed(1)}분`;
}

export interface MetricItem {
  label: string;
  value: string;
  /** Plain-language meaning, shown as a tooltip. */
  hint: string;
  warn?: boolean;
}

export function metricItems(m: DecisionMetrics): MetricItem[] {
  const incidents = m.incidents.autoReverted + m.incidents.missedWaits;
  return [
    { label: "제안 승인", value: rateText(m.approval), hint: "관제 AI가 제안한 응답을 사람이 고치지 않고 승인한 비율" },
    {
      label: "자율 일치",
      value: rateText(m.autoAgreement) + (m.autoAgreement.undetermined ? ` · 판정 불가 ${m.autoAgreement.undetermined}` : ""),
      hint: "관제 AI가 스스로 보내도 된다고 한 건에서 사람이 실제로 같은 답을 한 비율. 자율 모드를 믿을 근거",
    },
    { label: "방치 시간", value: `${minutesText(m.waitMedianMs)} (${m.waitSamples}건 중앙값)`, hint: "세션이 입력 대기로 바뀐 뒤 사람이 답할 때까지 걸린 시간" },
    { label: "오늘 개입", value: `${m.interventionsToday}회`, hint: "오늘 사람이 승인, 무시, 직접 입력한 횟수" },
    {
      label: "사고",
      value: `${incidents}건`,
      hint: `자율 응답을 사람이 5분 안에 되돌린 것 ${m.incidents.autoReverted}건, 5분 넘게 놓친 입력 대기 ${m.incidents.missedWaits}건`,
      warn: incidents > 0,
    },
  ];
}
