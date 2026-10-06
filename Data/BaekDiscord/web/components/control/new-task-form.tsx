"use client";

import { useMemo, useState } from "react";
import type { Policy, RefinedPrompt } from "@/lib/runner/protocol";
import type { RunnerApi } from "@/lib/runner/use-runner";
import { policyLabel, policyOptions } from "./labels";
import { FolderPicker, rememberFolder } from "./folder-picker";

/** Pre-fill from elsewhere (work log "이 지시로 다시"); `nonce` makes a repeat of the same draft apply again. */
export interface TaskDraft {
  cwd: string;
  prompt: string;
  goal?: string;
  /** Preset of the session this draft came from; one-shot variants are preferred. */
  preset?: string;
  nonce: number;
}

interface Props {
  runner: RunnerApi;
  draft?: TaskDraft | null;
  /** Called after a session was requested (mobile: jump to the sessions tab). */
  onStarted?: () => void;
  collapsible?: boolean;
}

export function NewTaskForm({ runner, draft, onStarted, collapsible = true }: Props) {
  const { presets, status } = runner;
  const [open, setOpen] = useState(true);
  const [presetId, setPresetId] = useState("claude-print");
  const [cwd, setCwd] = useState("");
  const [prompt, setPrompt] = useState("");
  const [goal, setGoal] = useState("");
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [policy, setPolicy] = useState<Policy>("assist");
  const [more, setMore] = useState(false);
  const [refined, setRefined] = useState<RefinedPrompt | null>(null);
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  const [verify, setVerify] = useState(false);

  // Apply a draft handed over from the work log.
  const [appliedNonce, setAppliedNonce] = useState<number | null>(null);
  if (draft && draft.nonce !== appliedNonce) {
    setAppliedNonce(draft.nonce);
    setCwd(draft.cwd);
    setPrompt(draft.prompt);
    setGoal(draft.goal ?? "");
    setPresetId(draft.preset?.startsWith("codex") ? "codex-exec" : "claude-print");
    setRefined(null);
    setOpen(true);
  }

  const choices = useMemo(() => presets.filter((p) => !p.internal), [presets]);
  const preset = useMemo(() => choices.find((p) => p.id === presetId) ?? choices[0], [choices, presetId]);
  const canVerify = !!preset && /^(claude|codex)/.test(preset.id);
  const canStart = status === "open" && !!preset?.available && (!preset.acceptsPrompt || prompt.trim().length > 0) && (preset.id !== "custom" || command.trim().length > 0);
  const canRefine = status === "open" && prompt.trim().length > 0 && !refining && !!preset?.acceptsPrompt;

  async function refine() {
    setRefining(true);
    setRefineError(null);
    try {
      setRefined(await runner.refine(prompt, cwd.trim() || undefined));
    } catch (e) {
      setRefineError((e as Error).message);
    } finally {
      setRefining(false);
    }
  }

  function acceptRefined() {
    if (!refined) return;
    setPrompt(refined.prompt);
    setGoal(refined.goal);
    if (!name.trim()) setName(refined.title);
    setRefined(null);
  }

  function start() {
    if (!preset) return;
    if (cwd.trim()) rememberFolder(cwd.trim());
    runner.create({
      preset: preset.id,
      cwd: cwd.trim() || undefined,
      prompt: preset.acceptsPrompt ? prompt : undefined,
      goal: (goal.trim() || prompt.trim()).slice(0, 500) || undefined,
      name: name.trim() || undefined,
      command: preset.id === "custom" ? command.trim() : undefined,
      policy,
      tags: ["control"],
      crossReview: verify && canVerify ? "auto" : undefined,
    });
    setPrompt("");
    setGoal("");
    setName("");
    setRefined(null);
    onStarted?.();
  }

  return (
    <section className="card">
      {collapsible ? (
        <button className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm" onClick={() => setOpen((v) => !v)}>
          <span className="font-medium">새 작업</span>
          <span className="text-xs text-muted">폴더를 고르고 지시를 쓰면 에이전트가 시작합니다</span>
          <span className="ml-auto text-xs text-muted">{open ? "접기" : "펼치기"}</span>
        </button>
      ) : null}
      {open && (
        <div className={`grid gap-3 px-3 py-3 ${collapsible ? "border-t border-border" : ""}`}>
          <FolderPicker runner={runner} value={cwd} onChange={setCwd} />

          <label>
            <span className="label">에이전트</span>
            <select
              className="input min-h-11"
              value={preset?.id ?? presetId}
              onChange={(e) => {
                setPresetId(e.target.value);
                setRefined(null);
                setRefineError(null);
              }}
            >
              {choices.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.available}>
                  {p.label}
                  {p.available ? "" : " (미설치)"}
                </option>
              ))}
              {presets.length === 0 && <option value="claude-print">러너 연결 대기…</option>}
            </select>
            {preset && <span className="mt-1 block text-xs text-muted">{preset.description}</span>}
          </label>

          {preset?.acceptsPrompt && (
            <div>
              <span className="label">지시</span>
              <textarea
                className="input min-h-[96px] text-[15px] leading-relaxed"
                value={prompt}
                onChange={(e) => {
                  setPrompt(e.target.value);
                  if (refined) setRefined(null);
                }}
                placeholder="예: 로그인 후 새로고침하면 로그아웃되는 버그 고쳐줘"
              />
              <div className="mt-1.5 flex items-center gap-2">
                <span className="min-w-0 flex-1 text-xs text-muted">
                  {refining ? "프롬프트 모델이 목표·할 일·완료 기준을 정리하는 중입니다 (20초 안팎)" : "짧게 써도 됩니다. 다듬기를 누르면 에이전트용 지시서로 바꿔 줍니다."}
                </span>
                <button type="button" className="btn min-h-9 shrink-0 px-3 text-xs" onClick={refine} disabled={!canRefine}>
                  {refining ? "다듬는 중…" : "지시서로 다듬기"}
                </button>
              </div>
              {refineError && <p className="mt-1 text-xs text-danger">{refineError}</p>}
            </div>
          )}

          {refined && (
            <div className="rounded-md border border-accent/40 bg-accent/5">
              <div className="flex items-center gap-2 border-b border-accent/20 px-3 py-2 text-xs">
                <span className="font-medium text-foreground">다듬은 지시서</span>
                <span className="text-muted">{refined.source === "brain" ? "프롬프트 모델" : "기본 틀 (모델 없음)"}</span>
                {refined.preset === "claude" && <span className="ml-auto text-warn">대화형으로 진행하는 편이 낫습니다</span>}
              </div>
              <div className="space-y-2 px-3 py-2">
                <div className="text-sm font-medium">{refined.title}</div>
                <textarea className="input min-h-[180px] font-mono text-[12px] leading-relaxed" value={refined.prompt} onChange={(e) => setRefined({ ...refined, prompt: e.target.value })} />
                <div className="text-xs">
                  <span className="text-muted">완료 기준 </span>
                  {refined.goal}
                </div>
                {refined.notes.length > 0 && (
                  <ul className="list-disc space-y-0.5 pl-4 text-xs text-warn">
                    {refined.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                )}
                <div className="flex gap-2 pt-1">
                  <button type="button" className="btn btn-primary min-h-10" onClick={acceptRefined}>
                    이대로 쓰기
                  </button>
                  <button type="button" className="btn min-h-10" onClick={() => setRefined(null)}>
                    원래 지시 유지
                  </button>
                </div>
              </div>
            </div>
          )}

          {preset?.id === "custom" && (
            <label>
              <span className="label">명령</span>
              <input className="input min-h-11 font-mono" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npm test" />
            </label>
          )}

          <div>
            <button type="button" className="text-xs text-muted underline-offset-2 hover:text-foreground hover:underline" onClick={() => setMore((v) => !v)}>
              {more ? "세부 설정 닫기" : `세부 설정 · 정책 ${policyLabel[policy]}${goal ? " · 목표 있음" : ""}`}
            </button>
            {more && (
              <div className="mt-2 grid gap-2 sm:grid-cols-[2fr_1fr_1fr]">
                <label>
                  <span className="label">목표 (비우면 지시와 같음)</span>
                  <input className="input min-h-11" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="슈퍼바이저가 판단할 때 쓰는 완료 기준" />
                </label>
                <label>
                  <span className="label">정책</span>
                  <select className="input min-h-11" value={policy} onChange={(e) => setPolicy(e.target.value as Policy)}>
                    {policyOptions.map((p) => (
                      <option key={p} value={p}>
                        {policyLabel[p]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="label">이름</span>
                  <input className="input min-h-11" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: runclue-fix" />
                </label>
              </div>
            )}
          </div>

          {canVerify && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-accent" checked={verify} onChange={(e) => setVerify(e.target.checked)} />
              <span>
                끝나면 다른 AI로 교차검증
                <span className="block text-xs text-muted">{preset?.id.startsWith("codex") ? "Claude" : "Codex"}가 읽기 전용으로 결과를 검토하고 통과/수정 필요를 알려줍니다. 토큰이 추가로 듭니다.</span>
              </span>
            </label>
          )}

          <button className="btn btn-primary min-h-12 w-full justify-center text-base sm:w-auto sm:justify-self-start sm:px-8" disabled={!canStart} onClick={start}>
            시작
          </button>
        </div>
      )}
    </section>
  );
}
