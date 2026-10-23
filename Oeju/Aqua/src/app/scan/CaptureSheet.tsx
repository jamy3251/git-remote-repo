"use client";

import Link from "next/link";
import { useState } from "react";
import { FishGlyph } from "@/components/FishGlyph";
import { RarityTag } from "@/components/RarityTag";
import { GROUP_NAMES, SPECIES_BY_ID, ZONE_BY_ID } from "@/data/species";
import type { BatchItem } from "@/lib/batch";
import type { CaptureResult } from "@/lib/collection";

export interface CaughtItem {
  speciesId: string;
  photo: string | null;
  result: CaptureResult;
}

export type Sheet =
  | { kind: "review"; items: BatchItem[]; verifying: boolean }
  | { kind: "result"; caught: CaughtItem[]; reports: BatchItem[]; onSite: boolean; combo: number };

export function CaptureSheet({
  sheet,
  onPick,
  onSubmit,
  onSendReports,
  onClose,
}: {
  sheet: Sheet;
  onPick: (itemId: number, choice: string | null) => void;
  onSubmit: () => void;
  onSendReports: (items: BatchItem[]) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/55 backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-modal="true"
        className="card-in max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-[28px] border-t border-line bg-surface px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />
        {sheet.kind === "review" ? (
          <Review sheet={sheet} onPick={onPick} onSubmit={onSubmit} />
        ) : (
          <Result sheet={sheet} onSendReports={onSendReports} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

function Thumb({ photo, speciesId, size }: { photo: string | null; speciesId: string | null; size: string }) {
  const s = speciesId ? SPECIES_BY_ID[speciesId] : null;
  return (
    <div className={`relative grid shrink-0 place-items-center overflow-hidden rounded-2xl bg-surface-2 ${size}`}>
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <FishGlyph group={s?.group} color={s?.color ?? "#2a4b5b"} className="h-2/3 w-2/3" />
      )}
    </div>
  );
}

/** 이 항목에서 고를 수 있는 종: 1차 답 + 2차 판정이 제안한 종 */
export function optionsOf(item: BatchItem): string[] {
  const out = [...item.predicted];
  if (item.verdict !== "pending" && item.verdict.kind === "other" && !out.includes(item.verdict.speciesId)) {
    out.push(item.verdict.speciesId);
  }
  return out;
}

function statusText(item: BatchItem): string {
  const v = item.verdict;
  if (v === "pending") return "카메라가 한 번 더 보는 중";
  if (v.kind === "match") {
    return item.label.kind === "group" && item.predicted.length > 1
      ? `${GROUP_NAMES[item.label.group]} 같아요 · 어떤 녀석인지 골라 주세요`
      : "다시 봐도 맞는 것 같아요";
  }
  if (v.kind === "other") return `다시 보니 ${SPECIES_BY_ID[v.speciesId].name} 같아요`;
  if (v.kind === "none") return "도감에 없는 생물 같아요";
  return item.label.kind === "group" ? "어떤 녀석인지 골라 주세요" : "";
}

function Review({
  sheet,
  onPick,
  onSubmit,
}: {
  sheet: Extract<Sheet, { kind: "review" }>;
  onPick: (itemId: number, choice: string | null) => void;
  onSubmit: () => void;
}) {
  const { items, verifying } = sheet;
  const picked = items.filter((i) => i.choice).length;
  const single = items.length === 1;
  return (
    <>
      <p className="text-sm text-muted">{single ? "카메라가 이렇게 봤어요" : `카메라가 ${items.length}마리를 봤어요`}</p>
      <ul className="mt-3 flex flex-col gap-2.5">
        {items.map((item) => {
          const v = item.verdict;
          const warn = v !== "pending" && (v.kind === "other" || v.kind === "none");
          // 무리 단위에서 아직 안 고른 것은 "아니에요"가 아니라 "고르는 중"
          const declined = item.choice === null && (item.touched || item.predicted.length === 1 || (v !== "pending" && v.kind === "none"));
          return (
            <li key={item.id} className="rounded-2xl border border-line bg-surface-2/60 p-3">
              <div className="flex items-center gap-3">
                <Thumb photo={item.photo} speciesId={item.choice ?? item.predicted[0]} size={single ? "h-20 w-20" : "h-14 w-14"} />
                <div className="min-w-0 flex-1">
                  <p className={`font-black leading-tight ${single ? "text-2xl" : "text-lg"} ${declined ? "text-muted line-through" : ""}`}>
                    {item.choice
                      ? SPECIES_BY_ID[item.choice].name
                      : item.label.kind === "group"
                        ? GROUP_NAMES[item.label.group]
                        : SPECIES_BY_ID[item.predicted[0]].name}
                  </p>
                  <p className={`mt-1 text-xs ${warn ? "text-warn" : "text-muted"}`}>
                    {v === "pending" && <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-muted align-middle" />}
                    {statusText(item)}
                  </p>
                </div>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label="어떤 생물인가요">
                {optionsOf(item).map((id) => (
                  <Chip key={id} active={item.choice === id} onClick={() => onPick(item.id, id)}>
                    {SPECIES_BY_ID[id].name}
                  </Chip>
                ))}
                <Chip active={declined} onClick={() => onPick(item.id, null)}>
                  아니에요
                </Chip>
              </div>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={onSubmit}
        disabled={verifying}
        className="mt-4 w-full rounded-2xl bg-accent py-3.5 font-bold text-accent-ink active:brightness-95 disabled:opacity-60"
      >
        {verifying ? "확인 중..." : picked === 0 ? "포획하지 않고 계속" : single ? "포획" : `${picked}마리 포획`}
      </button>
    </>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`min-h-9 rounded-full px-3.5 text-[13px] transition-colors ${
        active ? "bg-text font-bold text-bg" : "border border-line text-text/85 active:bg-surface"
      }`}
    >
      {children}
    </button>
  );
}

function Result({
  sheet,
  onSendReports,
  onClose,
}: {
  sheet: Extract<Sheet, { kind: "result" }>;
  onSendReports: (items: BatchItem[]) => void;
  onClose: () => void;
}) {
  const { caught, reports, onSite, combo } = sheet;
  const sendable = reports.filter((r) => r.trainingImage);
  const [sent, setSent] = useState<"no" | "yes" | null>(sendable.length ? null : "no");
  const first = caught[0]?.result;
  const last = caught[caught.length - 1]?.result;
  const leveledUp = first && last && last.levelAfter > first.levelBefore;
  const totalXp = caught.reduce((sum, c) => sum + c.result.xpGained, 0);

  return (
    <>
      {caught.length === 1 && <CaughtCard item={caught[0]} onSite={onSite} />}
      {caught.length > 1 && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-accent">동시 포획 {caught.length}마리</p>
            <p className="num text-sm font-bold text-accent">
              +{totalXp} XP
              <span className="ml-1 text-[11px] text-muted">
                콤보 x{combo.toFixed(1)}
                {onSite && " · 현장 보너스"}
              </span>
            </p>
          </div>
          <ul className="mt-3 flex flex-col gap-2">
            {caught.map((c) => {
              const s = SPECIES_BY_ID[c.speciesId];
              return (
                <li key={c.speciesId} className="flex items-center gap-3 rounded-2xl border p-2.5" style={{ borderColor: `var(--r-${s.rarity})` }}>
                  <Thumb photo={c.photo} speciesId={s.id} size="h-12 w-12" />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">{s.name}</p>
                    <p className={`text-xs ${c.result.isNew ? "text-accent" : "text-muted"}`}>
                      {c.result.isNew ? "새로운 생물 등록" : `${c.result.collection.caught[s.id].count}번째 포획`}
                    </p>
                  </div>
                  <RarityTag rarity={s.rarity} />
                </li>
              );
            })}
          </ul>
        </>
      )}
      {leveledUp && (
        <p className="mt-3 rounded-2xl bg-accent/15 px-3 py-2.5 text-center font-bold text-accent">탐사 등급 상승 · Lv.{last.levelAfter}</p>
      )}

      {reports.length > 0 && (
        <div className={caught.length ? "mt-4 rounded-2xl border border-line p-3.5" : ""}>
          <h2 className={caught.length ? "font-bold" : "text-xl font-black"}>
            {sent === "yes" ? "보내 주셔서 고마워요" : "알려주셔서 고마워요"}
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            {sent === "yes"
              ? "카메라가 더 정확해지도록 학습에 쓰여요. 신호가 약하면 연결될 때 자동으로 보내요."
              : sent === "no"
                ? "화면 위에서 지금 있는 구역을 고르면 헷갈리는 일이 줄어들어요."
                : `틀린 사진 ${sendable.length}장을 보내 주시면 카메라 학습에 써요. 물고기 주변만 잘라서 보내며, 학습용 데이터셋은 외부에 공개될 수 있어요.`}
          </p>
          {sent === null && (
            <div className="mt-3 grid grid-cols-[1fr_1.6fr] gap-2">
              <button type="button" onClick={() => setSent("no")} className="rounded-2xl border border-line py-3 font-medium">
                보내지 않기
              </button>
              <button
                type="button"
                onClick={() => {
                  onSendReports(sendable);
                  setSent("yes");
                }}
                className="rounded-2xl bg-accent py-3 font-bold text-accent-ink"
              >
                사진 보내기
              </button>
            </div>
          )}
        </div>
      )}

      <div className={`mt-4 grid gap-2 ${caught.length ? "grid-cols-2" : "grid-cols-1"}`}>
        {caught.length > 0 && (
          <Link href={caught.length === 1 ? `/dex/${caught[0].speciesId}` : "/dex"} className="rounded-2xl border border-line py-3.5 text-center font-medium">
            도감 보기
          </Link>
        )}
        <button type="button" onClick={onClose} className="rounded-2xl bg-accent py-3.5 font-bold text-accent-ink">
          {caught.length ? "계속 탐사" : "다시 탐사"}
        </button>
      </div>
    </>
  );
}

function CaughtCard({ item, onSite }: { item: CaughtItem; onSite: boolean }) {
  const s = SPECIES_BY_ID[item.speciesId];
  const { result } = item;
  return (
    <>
      <div className="flex items-center justify-between">
        <p className={`hud text-xs ${result.isNew ? "text-accent" : "text-muted"}`}>
          {result.isNew ? "새로운 생물 등록" : `${result.collection.caught[s.id].count}번째 포획`}
        </p>
        <p className="num text-sm font-bold text-accent">
          +{result.xpGained} XP{onSite && <span className="ml-1 text-[11px] text-muted">현장 보너스</span>}
        </p>
      </div>

      <div className="mt-3 overflow-hidden rounded-3xl border" style={{ borderColor: `var(--r-${s.rarity})` }}>
        <div className="relative flex aspect-[16/10] items-center justify-center bg-surface-2">
          {item.photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.photo} alt={s.name} className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <FishGlyph group={s.group} color={s.color} className="h-24 w-24" />
          )}
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent" />
          <div className="absolute left-3 top-3 rounded-full bg-black/55 backdrop-blur">
            <RarityTag rarity={s.rarity} />
          </div>
          <div className="absolute bottom-3 left-4">
            <h2 className="text-2xl font-black text-white">{s.name}</h2>
            <p className="text-xs text-white/70">
              {ZONE_BY_ID[s.zone].name} · {s.size}
            </p>
          </div>
        </div>
        <p className="p-4 text-[15px] leading-relaxed">{s.facts[0]}</p>
      </div>
    </>
  );
}
