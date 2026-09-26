"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RunnerSettingsBar } from "@/components/runner-settings-bar";
import type { CompileResponse, LanguageInfo, StepResult } from "@/lib/runner/protocol";
import { loadRunnerSettings, runnerFetch, saveRunnerSettings, type RunnerSettings } from "@/lib/runner/settings";

type Verdict = "AC" | "WA" | "CE" | "RE" | "TLE" | "OLE" | null;

interface RunResult extends CompileResponse {
  verdict: boolean | null;
}

const verdictLabel: Record<Exclude<Verdict, null>, { text: string; cls: string }> = {
  AC: { text: "맞았습니다!!", cls: "text-ok" },
  WA: { text: "틀렸습니다", cls: "text-danger" },
  CE: { text: "컴파일 에러", cls: "text-warn" },
  RE: { text: "런타임 에러", cls: "text-danger" },
  TLE: { text: "시간 초과", cls: "text-warn" },
  OLE: { text: "출력 초과", cls: "text-warn" },
};

function classify(r: RunResult, hasExpected: boolean): Verdict {
  if (r.compile && !r.compile.ok) return "CE";
  if (!r.run) return null;
  if (r.run.timedOut) return "TLE";
  if (r.run.truncated) return "OLE";
  if (!r.run.ok) return "RE";
  if (!hasExpected) return null;
  return r.verdict ? "AC" : "WA";
}

const codeKey = (lang: string) => `devhub.compile.code.${lang}`;

function readSavedCode(lang: string): string | null {
  try {
    return window.localStorage.getItem(codeKey(lang));
  } catch {
    return null;
  }
}

function saveCode(lang: string, code: string): void {
  try {
    window.localStorage.setItem(codeKey(lang), code);
  } catch {
    /* ignore */
  }
}

export function CompileView() {
  const [settings, setSettings] = useState<RunnerSettings>(() => loadRunnerSettings());
  const [languages, setLanguages] = useState<LanguageInfo[]>([]);
  const [langId, setLangId] = useState("cpp");
  /** Edits made this session, per language; falls back to saved code, then the template. */
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [stdin, setStdin] = useState("");
  const [expected, setExpected] = useState("");
  const [timeoutMs, setTimeoutMs] = useState(5000);
  const [connError, setConnError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const lang = useMemo(() => languages.find((l) => l.id === langId), [languages, langId]);

  const loadLanguages = useCallback(async () => {
    const s = loadRunnerSettings();
    setSettings(s);
    setConnError(null);
    if (!s.token) {
      setConnected(false);
      setConnError("러너 토큰을 설정하세요.");
      return;
    }
    try {
      const r = await runnerFetch<{ languages: LanguageInfo[] }>(s, "/languages");
      setLanguages(r.languages);
      setConnected(true);
    } catch (e) {
      setConnected(false);
      setConnError(`러너 연결 실패: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => {
    // Fetching the runner's language list on mount is the external sync this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadLanguages();
  }, [loadLanguages]);

  const code = edits[langId] ?? readSavedCode(langId) ?? lang?.template ?? "";
  const setCode = (next: string) => {
    setEdits((prev) => ({ ...prev, [langId]: next }));
    saveCode(langId, next);
  };

  async function run() {
    if (!lang) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const r = await runnerFetch<RunResult>(settings, "/compile", {
        method: "POST",
        body: JSON.stringify({ language: lang.id, code, stdin, expected: expected.trim() ? expected : undefined, timeoutMs }),
      });
      setResult(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  function onEditorKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Tab") {
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = `${code.slice(0, start)}    ${code.slice(end)}`;
      setCode(next);
      requestAnimationFrame(() => el.setSelectionRange(start + 4, start + 4));
    } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (!running) run();
    }
  }

  const verdict = result ? classify(result, expected.trim().length > 0) : null;

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-semibold">컴파일러</h1>
        <p className="text-sm text-muted">로컬 러너의 툴체인으로 컴파일·실행합니다. 입력과 예상 출력을 주면 백준식으로 채점합니다. (Ctrl+Enter 실행)</p>
      </div>

      <RunnerSettingsBar
        settings={settings}
        status="http"
        statusText={connected ? "연결됨" : "미연결"}
        onSave={(s) => {
          saveRunnerSettings(s);
          setSettings(s);
        }}
        onConnect={loadLanguages}
        error={connError}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="card flex flex-col p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <select className="input w-auto" value={langId} onChange={(e) => setLangId(e.target.value)}>
              {languages.map((l) => (
                <option key={l.id} value={l.id} disabled={!l.available}>
                  {l.label}
                  {l.available ? "" : " (미설치)"}
                </option>
              ))}
              {languages.length === 0 && <option value="cpp">러너 연결 대기…</option>}
            </select>
            {lang?.version && <span className="badge font-mono">{lang.version}</span>}
            <span className="ml-auto flex items-center gap-2 text-xs text-muted">
              제한
              <input
                type="number"
                className="input w-24"
                min={100}
                max={30000}
                step={100}
                value={timeoutMs}
                onChange={(e) => setTimeoutMs(Number(e.target.value) || 5000)}
              />
              ms
            </span>
            <button className="btn" disabled={!lang} onClick={() => lang && setCode(lang.template)}>
              템플릿
            </button>
            <button className="btn btn-primary" disabled={!lang || !connected || running} onClick={run}>
              {running ? "실행 중…" : "컴파일 & 실행"}
            </button>
          </div>
          <textarea
            ref={editorRef}
            className="input min-h-[440px] flex-1 resize-y font-mono text-[13px] leading-5"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={onEditorKey}
          />
          <div className="mt-1 text-xs text-muted">{lang ? `${lang.fileName} 로 저장되어 실행됩니다.` : ""}</div>
        </section>

        <section className="flex flex-col gap-3">
          <div className="card p-3">
            <span className="label">입력 (stdin)</span>
            <textarea className="input min-h-[96px] font-mono" value={stdin} onChange={(e) => setStdin(e.target.value)} placeholder={"1 2"} />
          </div>
          <div className="card p-3">
            <span className="label">예상 출력 (선택, 채점용)</span>
            <textarea className="input min-h-[72px] font-mono" value={expected} onChange={(e) => setExpected(e.target.value)} placeholder={"3"} />
          </div>
          <div className="card flex-1 p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="label mb-0">결과</span>
              {verdict && <span className={`text-sm font-semibold ${verdictLabel[verdict].cls}`}>{verdictLabel[verdict].text}</span>}
              {result?.run && (
                <span className="ml-auto text-xs text-muted">
                  {result.compile ? `컴파일 ${result.compile.ms}ms · ` : ""}실행 {result.run.ms}ms · exit {result.run.exitCode ?? "-"}
                </span>
              )}
            </div>
            {error && <pre className="whitespace-pre-wrap rounded bg-background p-2 font-mono text-xs text-danger">{error}</pre>}
            {result?.compile && !result.compile.ok && <Step title="컴파일 오류" step={result.compile} tone="warn" />}
            {result?.compile && result.compile.ok && result.compile.stderr && <Step title="컴파일 경고" step={result.compile} tone="muted" />}
            {result?.run && <Step title="stdout" step={result.run} tone="ok" />}
            {result?.run && result.run.stderr && <Step title="stderr" step={result.run} tone="danger" stderr />}
            {!result && !error && <p className="text-xs text-muted">아직 실행하지 않았습니다.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}

function Step({ title, step, tone, stderr }: { title: string; step: StepResult; tone: "ok" | "warn" | "danger" | "muted"; stderr?: boolean }) {
  const text = stderr ? step.stderr : title === "stdout" ? step.stdout : step.stderr;
  const toneCls = { ok: "text-foreground", warn: "text-warn", danger: "text-danger", muted: "text-muted" }[tone];
  return (
    <div className="mb-2">
      <div className="mb-1 text-xs text-muted">
        {title}
        {step.truncated ? " (잘림)" : ""}
        {step.timedOut ? " (시간 초과로 종료)" : ""}
      </div>
      <pre className={`max-h-72 overflow-auto whitespace-pre-wrap rounded bg-background p-2 font-mono text-xs ${toneCls}`}>{text || "(비어 있음)"}</pre>
    </div>
  );
}
