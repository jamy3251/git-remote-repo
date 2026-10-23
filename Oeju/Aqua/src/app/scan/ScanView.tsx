"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { VerifyResponse } from "@/app/api/verify/route";
import { GROUP_NAMES, SPECIES_BY_ID, ZONES, type ZoneId } from "@/data/species";
import { applyVerdict, initialChoice, pick, planBatch, type BatchItem } from "@/lib/batch";
import type { DetectMode, DetectResponse, Label, ModelRun } from "@/lib/detection/types";
import { isZoneId } from "@/lib/detection/zone";
import { startDetectLoop } from "@/lib/detectLoop";
import { createLog, logFrame, type FieldLog } from "@/lib/fieldLog";
import {
  avgConfidence,
  captureBar,
  initialTracker,
  lockProgress,
  MIN_AVG_CONF,
  readyTracks,
  stepTracks,
  type Track,
  type Tracker,
} from "@/lib/lockOn";
import { addReport } from "@/lib/reports";
import { enqueueUpload, setFieldKey } from "@/lib/uploadQueue";
import { saveCapture, useCollection } from "@/lib/useCollection";
import { useToday } from "@/lib/useToday";
import { isOnSiteToday, useVisits } from "@/lib/visits";
import { CaptureSheet, type CaughtItem, type Sheet } from "./CaptureSheet";
import { FieldPanel } from "./FieldPanel";
import { coverTransform, cropForTraining, cropForVerify, cropThumbnail, grabFrame } from "./frame";

type CameraState = "starting" | "live" | "denied" | "none";

/** 요청을 이 간격 이상 두고, 동시에 최대 MAX_IN_FLIGHT 개까지 보낸다 (서버 왕복이 1초 가까이 걸려서) */
const MIN_GAP_MS = 300;
const MAX_IN_FLIGHT = 2;
/** 2차 판정을 이만큼까지만 기다린다. 늦으면 1차 답으로 진행 */
const VERIFY_WAIT_MS = 3000;
const NO_CAMERA_SIZE = { w: 640, h: 480 };
export const ON_SITE_BONUS = 1.5;

/**
 * 탐사 화면. 화면 속 생물마다 따로 조준하고, 셔터 한 번에 조준이 끝난 것을 모두 잡는다.
 * fieldKey 가 있으면 운영자용 "분석 모드": 모든 탐지에 원래 클래스·모델을 표시하고,
 * 모델별 원본 결과와 기록 도구를 띄운다.
 */
export function ScanView({ fieldKey = null, info }: { fieldKey?: string | null; info?: ReactNode }) {
  const field = fieldKey !== null;
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const trackerRef = useRef<Tracker>(initialTracker);
  const pausedRef = useRef(false);
  const submittedRef = useRef<Sheet | null>(null);
  const verifyAbortRef = useRef<AbortController | null>(null);
  const logRef = useRef<FieldLog | null>(null);

  // 지금 있는 구역. URL에 두어 도감의 "찾으러 가기"가 구역을 미리 골라 줄 수 있게 한다
  const router = useRouter();
  const zoneParam = useSearchParams().get("zone");
  const zone: ZoneId | null = isZoneId(zoneParam) ? zoneParam : null;
  const zoneRef = useRef(zone);

  const [camera, setCamera] = useState<CameraState>("starting");
  const [mode, setMode] = useState<DetectMode | null>(null);
  const [tracker, setTracker] = useState<Tracker>(initialTracker);
  const [raw, setRaw] = useState<DetectResponse["raw"]>(undefined);
  const [latency, setLatency] = useState<number | null>(null);
  const [netError, setNetError] = useState(false);
  const [runs, setRuns] = useState<ModelRun[]>([]);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [media, setMedia] = useState(NO_CAMERA_SIZE);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [flashKey, setFlashKey] = useState(0);
  const [minConf, setMinConf] = useState(MIN_AVG_CONF);
  const [log, setLog] = useState<FieldLog | null>(null);
  const minConfRef = useRef(minConf);
  const collection = useCollection();
  const onSite = isOnSiteToday(useVisits(), useToday());

  useEffect(() => {
    setFieldKey(fieldKey);
  }, [fieldKey]);

  useEffect(() => {
    minConfRef.current = minConf;
  }, [minConf]);

  // 구역이 바뀌면 조준을 처음부터
  useEffect(() => {
    zoneRef.current = zone;
    trackerRef.current = initialTracker;
  }, [zone]);

  const selectZone = useCallback(
    (next: ZoneId | null) => {
      const base = field ? "/field" : "/scan";
      router.replace(next ? `${base}?zone=${next}` : base, { scroll: false });
    },
    [router, field],
  );

  // 인식 모드 확인
  useEffect(() => {
    fetch("/api/detect")
      .then((r) => r.json())
      .then((s: { mode: DetectMode }) => setMode(s.mode))
      .catch(() => setMode("demo"));
  }, []);

  // 카메라 시작 (후면 우선)
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamera("none");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) return;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        setMedia({ w: video.videoWidth || 1280, h: video.videoHeight || 720 });
        setCamera("live");
      } catch (err) {
        if (cancelled) return;
        const name = (err as DOMException)?.name;
        setCamera(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "none");
      }
    }
    start();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // 화면 크기 추적
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setStage({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 인식 루프: 서버 왕복을 기다리는 동안 다음 프레임도 보낸다(최대 MAX_IN_FLIGHT).
  // 늦게 도착한 옛 응답은 버린다.
  useEffect(() => {
    if (mode === null) return;
    // 실제 모델은 카메라 없이는 돌릴 수 없다. 데모는 권한 대기 중에도 돈다
    if (mode === "roboflow" && camera !== "live") return;

    let alive = true;
    let seq = 0;
    let applied = 0;

    const send = async (): Promise<boolean> => {
      const frame =
        camera === "live" && videoRef.current && canvasRef.current
          ? grabFrame(videoRef.current, canvasRef.current)
          : { image: "", width: NO_CAMERA_SIZE.w, height: NO_CAMERA_SIZE.h };
      if (!frame) return false;
      const my = ++seq;
      const began = performance.now();
      try {
        const res = await fetch("/api/detect", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(fieldKey ? { "x-field-key": fieldKey } : {}) },
          body: JSON.stringify({ ...frame, zone: zoneRef.current }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as DetectResponse;
        if (!alive || my < applied || pausedRef.current) return true;
        applied = my;
        const rtt = Math.round(performance.now() - began);
        const prevReady = readyTracks(trackerRef.current, minConfRef.current).length;
        const next = stepTracks(trackerRef.current, data.detections);
        if (readyTracks(next, minConfRef.current).length > prevReady) navigator.vibrate?.(30);
        trackerRef.current = next;
        setTracker(next);
        setRaw(data.raw);
        setRuns(data.runs ?? []);
        setLatency(rtt);
        setNetError(false);
        if (logRef.current) {
          logRef.current = logFrame(logRef.current, data, rtt);
          setLog(logRef.current);
        }
        return true;
      } catch {
        if (alive) setNetError(true);
        return false;
      }
    };

    const stop = startDetectLoop({
      send,
      canSend: () => !pausedRef.current && document.visibilityState === "visible",
      gapMs: MIN_GAP_MS,
      maxInFlight: MAX_IN_FLIGHT,
    });
    return () => {
      alive = false;
      stop();
    };
  }, [mode, camera, fieldKey]);

  const capture = useCallback(() => {
    const ready = readyTracks(trackerRef.current, minConf);
    if (!ready.length) return;
    const video = camera === "live" ? videoRef.current : null;
    // 같은 종이 두 마리면 한 번만
    const seen = new Set<string>();
    const items: BatchItem[] = [];
    for (const t of ready) {
      if (t.label.kind === "unknown" || seen.has(t.key)) continue;
      seen.add(t.key);
      const predicted = t.label.kind === "species" ? [t.label.speciesId] : t.label.candidates;
      items.push({
        id: t.id,
        label: t.label,
        predicted,
        photo: video ? cropThumbnail(video, t.box) : null,
        trainingImage: video ? cropForTraining(video, t.box) : null,
        verifyImage: video ? cropForVerify(video, t.box) : null,
        confidence: avgConfidence(t),
        rawClass: t.rawClass,
        model: t.model,
        verdict: "pending",
        choice: initialChoice(predicted),
        touched: false,
      });
    }
    if (!items.length) return;
    navigator.vibrate?.([20, 40, 60]);
    setFlashKey((k) => k + 1);
    pausedRef.current = true;
    trackerRef.current = initialTracker;
    setTracker(initialTracker);

    const toVerify = items.filter((i) => i.verifyImage);
    const verifying = mode === "roboflow" && toVerify.length > 0;
    setSheet({
      kind: "review",
      items: verifying ? items : items.map((i) => ({ ...i, verdict: { kind: "unsure" } })),
      verifying,
    });
    if (!verifying) return;

    // 2차 판정: 포획 순간 잘라낸 사진만 다시 본다. 늦으면 기다리지 않는다
    const abort = new AbortController();
    verifyAbortRef.current?.abort();
    verifyAbortRef.current = abort;
    const giveUp = setTimeout(() => {
      setSheet((s) => (s?.kind === "review" ? { ...s, verifying: false } : s));
    }, VERIFY_WAIT_MS);
    fetch("/api/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(fieldKey ? { "x-field-key": fieldKey } : {}) },
      body: JSON.stringify({
        zone: zoneRef.current,
        crops: toVerify.map((i) => ({ image: i.verifyImage, predicted: i.predicted })),
      }),
      signal: abort.signal,
    })
      .then((r) => (r.ok ? (r.json() as Promise<VerifyResponse>) : null))
      .catch(() => null)
      .then((res) => {
        clearTimeout(giveUp);
        if (abort.signal.aborted) return;
        const byId = new Map(toVerify.map((item, i) => [item.id, res?.verdicts[i]]));
        setSheet((s) => {
          if (s?.kind !== "review") return s;
          return {
            ...s,
            verifying: false,
            items: s.items.map((item) =>
              item.verdict === "pending" ? applyVerdict(item, byId.get(item.id) ?? { kind: "unsure" }) : item,
            ),
          };
        });
      });
  }, [camera, minConf, mode, fieldKey]);

  const onPick = useCallback((itemId: number, choice: string | null) => {
    setSheet((s) =>
      s?.kind === "review" ? { ...s, items: s.items.map((i) => (i.id === itemId ? pick(i, choice) : i)) } : s,
    );
  }, []);

  const closeSheet = useCallback(() => {
    verifyAbortRef.current?.abort();
    setSheet(null);
    pausedRef.current = false;
  }, []);

  const submit = useCallback(() => {
    const s = sheet;
    // 연타로 같은 포획이 두 번 저장되지 않게
    if (s?.kind !== "review" || submittedRef.current === s) return;
    submittedRef.current = s;
    verifyAbortRef.current?.abort();
    const plan = planBatch(s.items);
    const bonus = (onSite ? ON_SITE_BONUS : 1) * plan.combo;
    const caught: CaughtItem[] = plan.saves.map(({ item, speciesId, verifiedBy }) => ({
      speciesId,
      photo: item.photo,
      result: saveCapture({ speciesId, confidence: item.confidence, photo: item.photo, verifiedBy, at: Date.now(), bonus }),
    }));
    for (const r of plan.reports) {
      addReport({
        at: Date.now(),
        predicted: predictedName(r),
        rawClass: r.rawClass,
        model: r.model,
        confidence: r.confidence,
        zone: zoneRef.current,
        photo: r.photo,
      });
    }
    if (!caught.length && !plan.reports.length) {
      closeSheet();
      return;
    }
    setSheet({ kind: "result", caught, reports: plan.reports, onSite, combo: plan.combo });
  }, [sheet, onSite, closeSheet]);

  /** 오답 사진을 학습용으로 보낸다 (사용자가 보내기를 고른 경우만) */
  const sendReports = useCallback((items: BatchItem[]) => {
    for (const p of items) {
      if (!p.trainingImage) continue;
      enqueueUpload({
        kind: "misid",
        image: p.trainingImage,
        zone: zoneRef.current,
        predicted: predictedName(p),
        rawClass: p.rawClass,
        model: p.model,
        confidence: p.confidence,
        actual: p.choice ?? "none",
        clip: p.verdict === "pending" ? "pending" : p.verdict.kind,
      });
    }
  }, []);

  /** 현장 모드: 지금 화면 전체를 학습용으로 */
  const shootTraining = useCallback(() => {
    const video = videoRef.current;
    if (!video || !canvasRef.current || camera !== "live") return false;
    const frame = grabFrame(video, canvasRef.current, 1280, 0.88);
    if (!frame) return false;
    setFlashKey((k) => k + 1);
    enqueueUpload({ kind: "field", image: frame.image, zone: zoneRef.current });
    return true;
  }, [camera]);

  /** 분석 모드 기록 시작/끝. 끝낼 때 JSON 으로 내려받는다 */
  const toggleLog = useCallback(() => {
    if (!logRef.current) {
      logRef.current = createLog(Date.now());
      setLog(logRef.current);
      return;
    }
    const done = { ...logRef.current, endedAt: Date.now(), zone: zoneRef.current, minConf: minConfRef.current };
    logRef.current = null;
    setLog(null);
    const url = URL.createObjectURL(new Blob([JSON.stringify(done, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `aqua-log-${new Date(done.startedAt).toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  const toScreen = stage.w ? coverTransform(stage, media) : null;
  const ready = readyTracks(tracker, minConf);
  const readyIds = new Set(ready.map((t) => t.id));
  const known = tracker.tracks.filter((t) => t.label.kind !== "unknown");
  const primary = known[0] ?? tracker.tracks[0] ?? null;
  const progress = ready.length ? 1 : known.reduce((m, t) => Math.max(m, lockProgress(t)), 0);
  const guide = guideText(primary, ready, camera, mode, latency !== null, zone, minConf);
  const caughtIds = Object.keys(collection.caught);
  const lastCaught = caughtIds
    .map((id) => ({ id, e: collection.caught[id] }))
    .sort((a, b) => b.e.lastAt - a.e.lastAt)[0];

  return (
    <main className="fixed inset-0 flex flex-col bg-black text-text">
      <div ref={stageRef} className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          className={`absolute inset-0 h-full w-full object-cover ${camera === "live" ? "" : "hidden"}`}
        />
        {camera !== "live" && <NoCameraBackdrop />}
        <canvas ref={canvasRef} className="hidden" />

        {/* 비네팅: 가장자리를 눌러 조준 영역에 시선이 모이게 */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.45)_100%)]" />

        {toScreen &&
          tracker.tracks.map((t) => {
            const rect = toScreen(t.box);
            if (t.label.kind === "unknown") {
              return (
                <div
                  key={t.id}
                  className={`pointer-events-none absolute rounded-lg border ${field ? "border-white/45" : "border-white/20"}`}
                  style={rect}
                >
                  {field && (
                    <span className="hud absolute -top-6 left-0 whitespace-nowrap rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] text-white/85">
                      {t.rawClass} {Math.round(avgConfidence(t) * 100)}% 제외
                      {t.model && <span className="text-white/45"> · {shortModel(t.model)}</span>}
                    </span>
                  )}
                </div>
              );
            }
            return (
              <Reticle
                key={t.id}
                rect={rect}
                label={t.label}
                progress={lockProgress(t)}
                ready={readyIds.has(t.id)}
                confidence={avgConfidence(t)}
                compact={t !== primary}
                detail={
                  field
                    ? `${t.rawClass}${t.model ? ` · ${shortModel(t.model)}` : ""}${t.agreed ? " · 두 모델 일치" : ""} · 기준 ${Math.round(captureBar(t, minConf) * 100)}%`
                    : undefined
                }
              />
            );
          })}

        {/* 상단 */}
        <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/75 via-black/35 to-transparent pb-10 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="flex items-center justify-between gap-2 px-4">
            <Link
              href="/"
              aria-label="나가기"
              className="grid h-9 w-9 place-items-center rounded-full bg-white/10 backdrop-blur"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
                <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
            <StatusPill mode={mode} latency={latency} runs={runs} field={field} onSite={onSite} />
            <span className="h-9 w-9" />
          </div>
          <nav className="mt-3 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]" aria-label="지금 있는 구역">
            {[{ id: null, name: "구역 모름" }, ...ZONES].map((z) => (
              <button
                key={z.id ?? "all"}
                type="button"
                onClick={() => selectZone(z.id)}
                aria-pressed={zone === z.id}
                className={`flex min-h-9 shrink-0 items-center rounded-full px-3.5 text-[13px] transition-colors ${
                  zone === z.id ? "bg-white font-bold text-bg" : "bg-white/10 text-white/80 backdrop-blur"
                }`}
              >
                {z.name}
              </button>
            ))}
          </nav>
          {!zone && (
            <p className="mx-4 mt-2 w-fit rounded-full bg-black/55 px-3 py-1 text-xs text-white/80 backdrop-blur">
              지금 있는 구역을 고르면 헷갈리는 일이 크게 줄어요
            </p>
          )}
        </div>

        {netError && (
          <p className="absolute inset-x-4 top-36 rounded-xl bg-danger/90 px-3 py-2 text-center text-sm text-white">
            인식 서버 연결이 불안정해요. 잠시 후 다시 시도합니다.
          </p>
        )}

        {field && (
          <FieldPanel
            raw={raw}
            runs={runs}
            minConf={minConf}
            onMinConf={setMinConf}
            onShoot={shootTraining}
            canShoot={camera === "live"}
            log={log}
            onToggleLog={toggleLog}
            info={info}
          />
        )}

        <p
          className={`pointer-events-none absolute inset-x-6 bottom-4 mx-auto w-fit max-w-full rounded-full px-4 py-2 text-center text-sm backdrop-blur ${
            ready.length ? "bg-accent font-bold text-accent-ink" : "bg-black/55 text-white/85"
          }`}
        >
          {guide}
        </p>

        {flashKey > 0 && <div key={flashKey} className="flash pointer-events-none absolute inset-0 bg-white" />}
      </div>

      {/* 하단: 카메라 앱처럼 왼쪽 도감, 가운데 포획 */}
      <div className="grid grid-cols-3 items-center bg-bg px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
        <Link
          href="/dex"
          className="relative h-12 w-12 justify-self-start overflow-hidden rounded-xl border border-line bg-surface-2"
          aria-label={`도감 ${caughtIds.length}종`}
        >
          {lastCaught?.e.photo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={lastCaught.e.photo} alt="" className="absolute inset-0 h-full w-full object-cover" />
          )}
          <span className="num absolute inset-x-0 bottom-0 bg-black/60 text-center text-[10px] leading-4">
            {caughtIds.length}종
          </span>
        </Link>
        <button
          type="button"
          onClick={capture}
          disabled={!ready.length}
          aria-label={ready.length > 1 ? `${ready.length}마리 포획` : "포획"}
          className="relative grid h-20 w-20 place-items-center justify-self-center rounded-full transition-transform active:scale-90 disabled:active:scale-100"
        >
          <svg viewBox="0 0 80 80" className="absolute inset-0 -rotate-90">
            <circle cx="40" cy="40" r="37" fill="none" stroke="var(--line)" strokeWidth="3" />
            <circle
              cx="40"
              cy="40"
              r="37"
              fill="none"
              stroke={ready.length ? "var(--accent)" : "rgba(255,255,255,0.55)"}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 37}
              strokeDashoffset={2 * Math.PI * 37 * (1 - progress)}
              className="transition-[stroke-dashoffset] duration-200"
            />
          </svg>
          <span
            className={`grid h-[60px] w-[60px] place-items-center rounded-full transition-colors ${ready.length ? "bg-accent" : "bg-white/15"}`}
          >
            {ready.length > 1 && <span className="num text-xl font-black text-accent-ink">{ready.length}</span>}
          </span>
        </button>
        <span className="justify-self-end text-right text-[11px] leading-tight text-muted">
          {onSite ? (
            <>
              현장 탐사 중
              <br />
              <span className="hud text-accent">XP x{ON_SITE_BONUS}</span>
            </>
          ) : null}
        </span>
      </div>

      {sheet && (
        <CaptureSheet sheet={sheet} onPick={onPick} onSubmit={submit} onSendReports={sendReports} onClose={closeSheet} />
      )}
    </main>
  );
}

function predictedName(item: BatchItem): string {
  return item.label.kind === "species" ? item.label.speciesId : `group:${item.label.group}`;
}

function StatusPill({
  mode,
  latency,
  runs,
  field,
  onSite,
}: {
  mode: DetectMode | null;
  latency: number | null;
  runs: ModelRun[];
  field: boolean;
  onSite: boolean;
}) {
  const degraded = runs.some((r) => !r.ok);
  const dot = mode === "demo" || degraded ? "bg-warn" : latency === null ? "bg-white/40" : "bg-accent";
  const label =
    mode === "demo"
      ? "데모 모드"
      : degraded
        ? `모델 ${runs.filter((r) => r.ok).length}/${runs.length}`
        : latency === null
          ? "연결 중"
          : "실시간 인식";
  return (
    <div className="num flex items-center gap-2 rounded-full bg-black/45 px-3 py-1.5 text-xs backdrop-blur">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      <span className={mode === "demo" ? "text-warn" : "text-white/90"}>{label}</span>
      {latency !== null && <span className="text-white/45">{latency}ms</span>}
      {field && <span className="rounded bg-warn px-1.5 text-[10px] font-bold text-black">분석</span>}
      {!field && onSite && <span className="text-accent">현장</span>}
    </div>
  );
}

function Reticle({
  rect,
  label,
  progress,
  ready,
  confidence,
  compact,
  detail,
}: {
  rect: { left: number; top: number; width: number; height: number };
  label: Label;
  progress: number;
  ready: boolean;
  confidence: number;
  /** 가운데 대상이 아닌 다른 생물: 이름표를 작게 */
  compact?: boolean;
  /** 분석 모드: 모델 원래 클래스명·모델·포획 기준 */
  detail?: string;
}) {
  const color = ready ? "var(--accent)" : "var(--warn)";
  const name =
    label.kind === "species"
      ? SPECIES_BY_ID[label.speciesId].name
      : label.kind === "group"
        ? GROUP_NAMES[label.group]
        : "모르는 생물";
  const c = Math.max(compact ? 10 : 14, Math.min(26, Math.min(rect.width, rect.height) * 0.18));
  return (
    <div
      className="pointer-events-none absolute transition-all duration-200 ease-out"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    >
      {[
        "left-0 top-0 border-l-[3px] border-t-[3px] rounded-tl-lg",
        "right-0 top-0 border-r-[3px] border-t-[3px] rounded-tr-lg",
        "left-0 bottom-0 border-l-[3px] border-b-[3px] rounded-bl-lg",
        "right-0 bottom-0 border-r-[3px] border-b-[3px] rounded-br-lg",
      ].map((cls) => (
        <span key={cls} className={`absolute ${cls}`} style={{ width: c, height: c, borderColor: color }} />
      ))}
      <div
        className={`absolute left-0 flex items-baseline gap-2 whitespace-nowrap rounded-lg border bg-black/60 backdrop-blur ${
          compact ? "-top-7 px-2 py-0.5" : "-top-9 px-2.5 py-1"
        }`}
        style={{ borderColor: color }}
      >
        <span className={`font-bold text-white ${compact ? "text-xs" : "text-sm"}`}>{name}</span>
        <span className="hud text-[11px]" style={{ color }}>
          {Math.round(confidence * 100)}%
        </span>
        {detail && <span className="hud text-[10px] text-white/55">{detail}</span>}
      </div>
      <div className="absolute -bottom-2.5 left-0 h-1 w-full overflow-hidden rounded-full bg-black/50">
        <div className="h-full transition-[width] duration-200" style={{ width: `${progress * 100}%`, background: color }} />
      </div>
    </div>
  );
}

function shortModel(model: string): string {
  return model.split("/")[0].replace(/-[a-z0-9]{5}$/, "");
}

function NoCameraBackdrop() {
  return (
    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_20%,#0f3a4a_0%,#06161e_55%,#020809_100%)]">
      <div className="absolute inset-0 opacity-30 [background:repeating-linear-gradient(100deg,transparent_0_40px,rgba(120,220,230,0.06)_40px_44px)]" />
    </div>
  );
}

function guideText(
  primary: Track | null,
  ready: Track[],
  camera: CameraState,
  mode: DetectMode | null,
  warm: boolean,
  zone: ZoneId | null,
  minConf: number,
): string {
  if (camera === "denied") return "카메라 권한이 필요해요. 설정에서 허용해 주세요";
  if (camera === "none" && mode === "roboflow") return "카메라를 찾을 수 없어요";
  if (camera !== "live" && mode === "demo" && !primary) return "카메라 없이 데모 화면으로 체험 중이에요";
  if (camera === "starting" && mode !== "demo") return "카메라 권한을 허용해 주세요";
  if (mode === "roboflow" && !warm) return "인식 모델을 깨우는 중... 처음 한 번만 몇 초 걸려요";
  if (ready.length > 1) return `${ready.length}마리 동시 포획 가능! 버튼을 누르세요`;
  if (ready.length === 1) {
    const t = ready[0];
    return t.label.kind === "group" ? `${GROUP_NAMES[t.label.group]} 포획 가능 · 종은 포획 후 골라요` : "포획 가능! 버튼을 누르세요";
  }
  if (!primary) return "유리에 가까이 대고 물고기를 화면에 담으세요";
  if (primary.label.kind === "unknown") return zone ? "이 구역에 사는 생물이 아닌 것 같아요" : "도감에 없는 생물이에요";
  if (lockProgress(primary) >= 1 && avgConfidence(primary) < captureBar(primary, minConf)) return "확신이 부족해요. 조금 더 가까이";
  return "조준 유지 중... 흔들지 마세요";
}
