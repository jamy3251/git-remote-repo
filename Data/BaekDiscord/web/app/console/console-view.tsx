"use client";

import { useMemo, useState } from "react";
import { RunnerSettingsBar } from "@/components/runner-settings-bar";
import { TerminalTile } from "@/components/terminal-tile";
import { useRunner } from "@/lib/runner/use-runner";
import type { CreateSessionRequest } from "@/lib/runner/protocol";

type Columns = 1 | 2 | 3;

export function ConsoleView() {
  const runner = useRunner();
  const { presets, sessions, info, status } = runner;

  const [presetId, setPresetId] = useState("shell");
  const [cwd, setCwd] = useState("");
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [prompt, setPrompt] = useState("");
  const [batchCwds, setBatchCwds] = useState("");
  const [batchMode, setBatchMode] = useState(false);
  const [columns, setColumns] = useState<Columns>(2);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState<string | null>(null);
  const [broadcast, setBroadcast] = useState("");
  const [withEnter, setWithEnter] = useState(true);
  const [showEnded, setShowEnded] = useState(true);

  const preset = useMemo(() => presets.find((p) => p.id === presetId) ?? presets[0], [presets, presetId]);
  const effectiveCwd = cwd.trim() || info?.cwdRoot || "";

  const visible = useMemo(() => (showEnded ? sessions : sessions.filter((s) => s.status === "running")), [sessions, showEnded]);
  const running = sessions.filter((s) => s.status === "running");
  const selectedRunning = [...selected].filter((id) => running.some((s) => s.id === id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function createSessions() {
    if (!preset) return;
    const base: CreateSessionRequest = {
      preset: preset.id,
      cwd: effectiveCwd || undefined,
      name: name.trim() || undefined,
      command: preset.id === "custom" ? command.trim() : undefined,
      prompt: preset.acceptsPrompt ? prompt : undefined,
    };
    if (batchMode) {
      const dirs = batchCwds
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      dirs.forEach((dir, i) => {
        const label = dir.split(/[\\/]/).filter(Boolean).pop() ?? `#${i + 1}`;
        runner.create({ ...base, cwd: dir, name: name.trim() ? `${name.trim()}-${label}` : `${preset.id}-${label}`, tags: ["batch"] });
      });
    } else {
      runner.create(base);
    }
  }

  function sendBroadcast(data: string) {
    if (!selectedRunning.length) return;
    runner.input(selectedRunning, data);
  }

  const gridCols = columns === 1 ? "grid-cols-1" : columns === 2 ? "grid-cols-1 xl:grid-cols-2" : "grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3";

  return (
    <div>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">CLI 다중 제어 콘솔</h1>
          <p className="text-sm text-muted">
            Claude Code · Codex · 셸 세션을 여러 개 띄우고 한 화면에서 보고, 선택한 세션에 같은 입력을 보냅니다.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          실행 중 {running.length} / 전체 {sessions.length}
        </div>
      </div>

      <RunnerSettingsBar
        settings={runner.settings}
        status={status}
        onSave={runner.updateSettings}
        onConnect={runner.connect}
        error={runner.lastError}
      />

      <div className="mb-4 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section className="card p-3">
          <h2 className="mb-2 text-sm font-medium">새 세션</h2>
          <div className="grid gap-2 md:grid-cols-2">
            <label>
              <span className="label">프리셋</span>
              <select className="input" value={preset?.id ?? presetId} onChange={(e) => setPresetId(e.target.value)}>
                {presets.map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.available}>
                    {p.label}
                    {p.available ? "" : " (미설치)"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">이름 (선택)</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: runclue-fix" />
            </label>
            {!batchMode && (
              <label className="md:col-span-2">
                <span className="label">작업 폴더 (러너 루트 안)</span>
                <input className="input font-mono" value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder={info?.cwdRoot ?? "D:\\Projects"} />
              </label>
            )}
            {preset?.id === "custom" && (
              <label className="md:col-span-2">
                <span className="label">명령</span>
                <input className="input font-mono" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npm run dev" />
              </label>
            )}
            {preset?.acceptsPrompt && (
              <label className="md:col-span-2">
                <span className="label">프롬프트 (stdin으로 전달, 1회 실행 후 종료)</span>
                <textarea className="input min-h-[72px] font-mono" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="예: 테스트를 실행하고 실패 원인을 요약해줘" />
              </label>
            )}
            <label className="flex items-center gap-2 text-sm md:col-span-2">
              <input type="checkbox" checked={batchMode} onChange={(e) => setBatchMode(e.target.checked)} className="accent-accent" />
              여러 폴더에 동시에 띄우기 (일괄 실행)
            </label>
            {batchMode && (
              <label className="md:col-span-2">
                <span className="label">폴더 목록 (한 줄에 하나)</span>
                <textarea
                  className="input min-h-[80px] font-mono"
                  value={batchCwds}
                  onChange={(e) => setBatchCwds(e.target.value)}
                  placeholder={`${info?.cwdRoot ?? "D:\\Projects"}\\App\\RunClue\n${info?.cwdRoot ?? "D:\\Projects"}\\Data\\BaekDiscord`}
                />
              </label>
            )}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button className="btn btn-primary" disabled={status !== "open" || !preset?.available} onClick={createSessions}>
              {batchMode ? "일괄 시작" : "세션 시작"}
            </button>
            {preset && <span className="text-xs text-muted">{preset.description}</span>}
          </div>
        </section>

        <section className="card p-3">
          <h2 className="mb-2 text-sm font-medium">브로드캐스트 — 선택 {selectedRunning.length}개</h2>
          <div className="mb-2 flex flex-wrap gap-2 text-xs">
            <button className="btn" onClick={() => setSelected(new Set(running.map((s) => s.id)))}>
              실행 중 전체 선택
            </button>
            <button className="btn" onClick={() => setSelected(new Set())}>
              선택 해제
            </button>
            <button className="btn btn-danger" disabled={!selectedRunning.length} onClick={() => runner.kill(selectedRunning)}>
              선택 종료
            </button>
            <button
              className="btn"
              disabled={!sessions.some((s) => s.status !== "running")}
              onClick={() => runner.remove(sessions.filter((s) => s.status !== "running").map((s) => s.id))}
            >
              종료된 세션 정리
            </button>
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              sendBroadcast(withEnter ? `${broadcast}\r` : broadcast);
              setBroadcast("");
            }}
          >
            <input
              className="input font-mono"
              value={broadcast}
              onChange={(e) => setBroadcast(e.target.value)}
              placeholder="선택한 모든 세션에 보낼 입력"
              disabled={!selectedRunning.length}
            />
            <button className="btn btn-primary whitespace-nowrap" type="submit" disabled={!selectedRunning.length}>
              전송
            </button>
          </form>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={withEnter} onChange={(e) => setWithEnter(e.target.checked)} className="accent-accent" /> Enter 포함
            </label>
            <button className="btn px-2 py-0.5 text-[11px]" disabled={!selectedRunning.length} onClick={() => sendBroadcast("\u0003")}>
              Ctrl+C
            </button>
            <button className="btn px-2 py-0.5 text-[11px]" disabled={!selectedRunning.length} onClick={() => sendBroadcast("\u001b")}>
              Esc
            </button>
            <button className="btn px-2 py-0.5 text-[11px]" disabled={!selectedRunning.length} onClick={() => sendBroadcast("y\r")}>
              y ⏎
            </button>
            <span className="ml-auto flex items-center gap-1">
              열
              {([1, 2, 3] as Columns[]).map((c) => (
                <button key={c} className={`btn px-2 py-0.5 text-[11px] ${columns === c ? "border-accent text-foreground" : ""}`} onClick={() => setColumns(c)}>
                  {c}
                </button>
              ))}
            </span>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={showEnded} onChange={(e) => setShowEnded(e.target.checked)} className="accent-accent" /> 종료된 세션 표시
            </label>
          </div>
        </section>
      </div>

      {visible.length === 0 ? (
        <div className="card p-10 text-center text-sm text-muted">
          {status === "open" ? "세션이 없습니다. 위에서 프리셋을 골라 시작하세요." : "러너에 연결되면 세션을 만들 수 있습니다."}
        </div>
      ) : (
        <div className={`grid gap-3 ${gridCols}`}>
          {visible.map((s) => (
            <TerminalTile
              key={s.id}
              session={s}
              runner={runner}
              selected={selected.has(s.id)}
              onToggleSelect={() => toggle(s.id)}
              focused={focused === s.id}
              onFocus={() => setFocused(s.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
