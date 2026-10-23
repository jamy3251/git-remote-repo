"use client";

import { useState, type ReactNode } from "react";
import { GROUP_NAMES, SPECIES_BY_ID, type GroupId } from "@/data/species";
import type { DetectResponse, ModelRun } from "@/lib/detection/types";
import { topLabels, type FieldLog } from "@/lib/fieldLog";
import { useUploadQueue } from "@/lib/uploadQueue";

/** 분석 모드(운영자): 모델별 원본 결과, 포획 기준 조절, 기록, 학습용 촬영, 안내·QR */
export function FieldPanel({
  raw,
  runs,
  minConf,
  onMinConf,
  onShoot,
  canShoot,
  log,
  onToggleLog,
  info,
}: {
  raw: DetectResponse["raw"];
  runs: ModelRun[];
  minConf: number;
  onMinConf: (v: number) => void;
  onShoot: () => boolean;
  canShoot: boolean;
  log: FieldLog | null;
  onToggleLog: () => void;
  info?: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const [showInfo, setShowInfo] = useState(false);
  const queue = useUploadQueue();
  const [shots, setShots] = useState(0);

  // 안내 시트는 패널 밖에 둔다: backdrop-blur 가 fixed 요소를 패널 안에 가둬 버리기 때문
  return (
    <>
      <div className="absolute bottom-16 left-3 right-3 z-10 max-w-sm rounded-2xl border border-white/10 bg-black/70 text-xs backdrop-blur">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between px-3 py-2"
          aria-expanded={open}
        >
          <span className="font-bold text-warn">분석 모드</span>
          <span className="num text-white/60">
            업로드 {queue.sent}
            {queue.pending > 0 && ` · 대기 ${queue.pending}`}
            {queue.failed > 0 && ` · 실패 ${queue.failed}`}
            <span className="ml-2">{open ? "접기" : "펼치기"}</span>
          </span>
        </button>
        {open && (
          <div className="space-y-3 border-t border-white/10 px-3 pb-3 pt-2.5">
            <ul className="space-y-1.5">
              {runs.length === 0 && (
                <li className="text-white/50">모델 응답 대기 중</li>
              )}
              {runs.map((r) => {
                const dets =
                  raw?.find((m) => m.model === r.model)?.detections ?? [];
                return (
                  <li key={r.model}>
                    <div className="hud flex justify-between">
                      <span className="truncate text-white/85">{r.model}</span>
                      <span className={r.ok ? "text-white/50" : "text-danger"}>
                        {r.ok ? `${r.ms}ms` : "실패"}
                      </span>
                    </div>
                    <p className="hud mt-0.5 truncate text-white/60">
                      {dets.length
                        ? dets
                            .slice(0, 3)
                            .map(
                              (d) =>
                                `${d.rawClass} ${Math.round(d.confidence * 100)}%${d.label.kind === "unknown" ? "(제외)" : ""}`,
                            )
                            .join(" · ")
                        : "탐지 없음"}
                    </p>
                  </li>
                );
              })}
            </ul>
            <label className="block">
              <span className="flex justify-between text-white/70">
                포획 기준 확신도
                <span className="hud text-white">
                  {Math.round(minConf * 100)}%
                </span>
              </span>
              <input
                type="range"
                min={0.3}
                max={0.95}
                step={0.05}
                value={minConf}
                onChange={(e) => onMinConf(Number(e.target.value))}
                className="mt-1 w-full accent-[var(--warn)]"
              />
            </label>
            <div>
              <button
                type="button"
                onClick={onToggleLog}
                className={`w-full rounded-xl py-2 font-bold ${log ? "bg-danger text-white" : "border border-white/20 text-white/85"}`}
              >
                {log ? `기록 끝내고 내려받기 · ${log.frames}프레임` : "기록 시작 (어떤 답이 몰리는지 집계)"}
              </button>
              {log && log.frames > 0 && (
                <ul className="hud mt-1.5 space-y-0.5 text-white/70">
                  {topLabels(log).map((l) => (
                    <li key={l.key} className="flex justify-between gap-2">
                      <span className="truncate">{labelName(l.key)}</span>
                      <span className="shrink-0">
                        {Math.round(l.share * 100)}% · 평균 {Math.round(l.avgConf * 100)}%
                      </span>
                    </li>
                  ))}
                  <li className="text-white/45">
                    빈 프레임 {Math.round((log.empty / log.frames) * 100)}% · 왕복 {Math.round(log.rttSum / log.frames)}ms
                  </li>
                </ul>
              )}
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <button
                type="button"
                disabled={!canShoot}
                onClick={() => {
                  if (onShoot()) setShots((n) => n + 1);
                }}
                className="w-full rounded-xl bg-warn py-2.5 font-bold text-black disabled:opacity-40"
              >
                학습용 촬영 (화면 전체){shots > 0 && ` · ${shots}장`}
              </button>
              {info && (
                <button
                  type="button"
                  onClick={() => setShowInfo(true)}
                  className="rounded-xl border border-white/20 px-3 font-medium text-white/85"
                >
                  안내·QR
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      {showInfo && info && (
        <div
          className="fixed inset-0 z-30 flex items-end justify-center bg-black/60"
          onClick={() => setShowInfo(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="card-in max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-[28px] border-t border-line bg-surface px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 text-text"
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />
            {info}
            <button
              type="button"
              onClick={() => setShowInfo(false)}
              className="mt-5 w-full rounded-2xl bg-accent py-3.5 font-bold text-accent-ink"
            >
              분석으로 돌아가기
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function labelName(key: string): string {
  const [kind, id] = [key.slice(0, 1), key.slice(2)];
  if (kind === "s") return SPECIES_BY_ID[id]?.name ?? id;
  if (kind === "g") return GROUP_NAMES[id as GroupId] ?? id;
  return `${id} (제외)`;
}
