"use client";

import { useMemo, useState } from "react";
import type { Policy } from "@/lib/runner/protocol";
import type { RunnerApi } from "@/lib/runner/use-runner";
import { policyLabel, policyOptions } from "./labels";

interface Props {
  runner: RunnerApi;
}

export function NewTaskForm({ runner }: Props) {
  const { presets, sessions, info, status } = runner;
  const [open, setOpen] = useState(true);
  const [presetId, setPresetId] = useState("claude-print");
  const [cwd, setCwd] = useState("");
  const [prompt, setPrompt] = useState("");
  const [goal, setGoal] = useState("");
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [policy, setPolicy] = useState<Policy>("assist");

  const preset = useMemo(() => presets.find((p) => p.id === presetId) ?? presets[0], [presets, presetId]);
  const folders = useMemo(() => {
    const set = new Set<string>();
    if (info?.cwdRoot) set.add(info.cwdRoot);
    for (const s of sessions) set.add(s.cwd);
    return [...set];
  }, [sessions, info]);

  const canStart = status === "open" && !!preset?.available && (!preset.acceptsPrompt || prompt.trim().length > 0) && (preset.id !== "custom" || command.trim().length > 0);

  function start() {
    if (!preset) return;
    runner.create({
      preset: preset.id,
      cwd: cwd.trim() || undefined,
      prompt: preset.acceptsPrompt ? prompt : undefined,
      goal: (goal.trim() || prompt.trim()).slice(0, 500) || undefined,
      name: name.trim() || undefined,
      command: preset.id === "custom" ? command.trim() : undefined,
      policy,
      tags: ["control"],
    });
    setPrompt("");
    setGoal("");
    setName("");
  }

  return (
    <section className="card">
      <button className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm" onClick={() => setOpen((v) => !v)}>
        <span className="font-medium">새 작업</span>
        <span className="text-xs text-muted">프롬프트 한 줄로 에이전트 띄우기</span>
        <span className="ml-auto text-xs text-muted">{open ? "접기" : "펼치기"}</span>
      </button>
      {open && (
        <div className="grid gap-2 border-t border-border px-3 py-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label>
              <span className="label">프리셋</span>
              <select className="input min-h-11" value={preset?.id ?? presetId} onChange={(e) => setPresetId(e.target.value)}>
                {presets.map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.available}>
                    {p.label}
                    {p.available ? "" : " (미설치)"}
                  </option>
                ))}
                {presets.length === 0 && <option value="claude-print">러너 연결 대기…</option>}
              </select>
            </label>
            <label>
              <span className="label">폴더</span>
              <input
                className="input min-h-11 font-mono"
                list="control-folders"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder={info?.cwdRoot ?? "러너 루트"}
              />
              <datalist id="control-folders">
                {folders.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </label>
          </div>
          {preset?.acceptsPrompt && (
            <label>
              <span className="label">프롬프트</span>
              <textarea
                className="input min-h-[88px]"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="예: 테스트를 돌리고 실패 원인을 고쳐줘. 커밋은 하지 마."
              />
            </label>
          )}
          {preset?.id === "custom" && (
            <label>
              <span className="label">명령</span>
              <input className="input min-h-11 font-mono" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npm test" />
            </label>
          )}
          <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr]">
            <label>
              <span className="label">목표 (비우면 프롬프트와 같음)</span>
              <input className="input min-h-11" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="슈퍼바이저가 판단할 때 쓰는 기준" />
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
              <span className="label">이름 (선택)</span>
              <input className="input min-h-11" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: runclue-fix" />
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn btn-primary min-h-11 px-5" disabled={!canStart} onClick={start}>
              시작
            </button>
            {preset && <span className="text-xs text-muted">{preset.description}</span>}
          </div>
        </div>
      )}
    </section>
  );
}
