"use client";

import type { FolderOverlap } from "@/lib/runner/protocol";
import type { RunnerApi } from "@/lib/runner/use-runner";
import { shortPath } from "./labels";

const RELATION: Record<FolderOverlap["relation"], string> = {
  same: "같은 폴더",
  parent: "상위 폴더",
  child: "하위 폴더",
  root: "작업 폴더 전체",
};

/**
 * Shown when the runner held back a new session because another one already writes in the same
 * folder, or in a folder above or below it. Three ways out: use the running one, start anyway, cancel.
 */
export function OverlapDialog({ runner, onOpenSession }: { runner: RunnerApi; onOpenSession?: (id: string) => void }) {
  const held = runner.overlap;
  if (!held) return null;

  function open(id: string) {
    runner.resolveOverlap(false);
    onOpenSession?.(id);
    // The card may be mounted by onOpenSession (phone tab switch), so look for it after this render.
    setTimeout(() => document.getElementById(`session-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="overlap-title">
      <div className="card w-full max-w-md space-y-3 p-4">
        <div>
          <h2 id="overlap-title" className="font-medium">
            이 폴더에서 이미 실행 중인 세션이 있습니다
          </h2>
          <p className="mt-1 text-xs text-muted">두 에이전트가 같은 파일을 고치면 서로의 변경을 덮어쓸 수 있습니다.</p>
        </div>
        <ul className="divide-y divide-border rounded border border-border text-sm">
          {held.overlaps.map((o) => (
            <li key={o.id} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate">{o.name}</div>
                <div className="truncate font-mono text-xs text-muted" title={o.cwd}>
                  {RELATION[o.relation]} · {shortPath(o.cwd)}
                </div>
              </div>
              <button className="btn min-h-10 shrink-0 text-xs" onClick={() => open(o.id)}>
                기존 세션 열기
              </button>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <button className="btn min-h-10" onClick={() => runner.resolveOverlap(false)}>
            취소
          </button>
          <button className="btn btn-primary min-h-10" onClick={() => runner.resolveOverlap(true)}>
            그래도 시작
          </button>
        </div>
      </div>
    </div>
  );
}
