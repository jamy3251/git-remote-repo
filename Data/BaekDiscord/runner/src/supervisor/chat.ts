import fs from "node:fs";
import path from "node:path";
import type { ChatAction, ChatTurn, CreateSessionRequest, Policy } from "../protocol.js";
import type { SessionManager } from "../sessions.js";
import type { Supervisor } from "./supervisor.js";
import type { Brain, BrainMessage } from "./brain.js";
import { presetInfos } from "../presets.js";
import { compactTail, describeInput } from "./supervisor.js";
import { redactSecrets } from "../security.js";

export interface ChatOptions {
  cwdRoot: string;
  maxSteps?: number;
  /** Keep the conversation this many turns long when talking to the brain (token control). */
  historyTurns?: number;
}

const DANGEROUS_INPUT = /\brm\s+-rf?\b|Remove-Item.*-Recurse|\bgit\s+push\b.*(--force|-f\b)|\bgit\s+reset\s+--hard\b|\bDROP\s+(TABLE|DATABASE)\b|\bformat\s+[a-z]:|\bshutdown\b|\bnpm\s+publish\b|\bvercel\s+--prod\b/i;

const SYSTEM = `당신은 개발자의 PC에서 돌아가는 CLI 에이전트 세션(Claude Code, Codex, 셸)을 지휘하는 관제 AI입니다. 사용자는 보통 휴대폰에서 짧게 지시합니다.

도구를 쓰려면 아래 JSON 한 개만 출력하세요(설명 없이). 도구 결과를 받은 뒤 다음 행동을 정하거나 최종 답을 합니다.
{"tool":"<이름>","args":{...}}
최종 답은 {"final":"<한국어 답변>"} 로 출력하세요. 답변은 짧고 구체적으로. 세션은 반드시 id로 지칭하세요.

도구:
- list_sessions {} — 모든 세션의 id, 이름, 프리셋, 폴더, 상태, 마지막 줄, 제안.
- read_output {"id":"...","lines":40} — 세션 최근 출력(최대 120줄).
- send_input {"id":"...","text":"...","enter":true} — 세션에 키 입력. enter가 true면 끝에 Enter. Ctrl+C는 text "\\u0003".
- create_session {"preset":"claude-print|claude|codex-exec|codex|shell|custom","cwd":"...","prompt":"...","name":"...","goal":"...","policy":"manual|assist|auto","command":"..."} — 새 세션. 폴더는 루트 안의 절대경로. 일회성 작업은 claude-print(프롬프트 필수)를 쓰세요.
- kill_session {"id":"..."} — 세션 종료.
- set_goal {"id":"...","goal":"..."} / set_policy {"id":"...","policy":"..."} — 슈퍼바이저 목표/정책.
- approve_suggestion {"id":"..."} / dismiss_suggestion {"id":"..."} — 대기 중인 제안 처리.
- list_dirs {"path":"..."} — 폴더 목록(루트 안만). 프로젝트 폴더를 찾을 때.
- list_presets {} — 사용 가능한 프리셋.

원칙: 파괴적 명령(삭제, force push, 배포, 비밀값)은 사용자가 "확인"이라고 명시하지 않는 한 실행하지 말고 물어보세요. 모르는 폴더는 list_dirs로 확인한 뒤 쓰세요. 한 번에 한 도구.`;

export class ControlChat {
  private turns: ChatTurn[] = [];
  private nextId = 1;
  busy = false;

  constructor(
    private brain: Brain,
    private sessions: SessionManager,
    private supervisor: Supervisor,
    private opts: ChatOptions,
  ) {}

  history(): ChatTurn[] {
    return [...this.turns];
  }

  reset(): void {
    this.turns = [];
  }

  async send(text: string, confirm = false): Promise<ChatTurn> {
    const userTurn: ChatTurn = { id: this.nextId++, role: "user", text: text.slice(0, 4000), ts: Date.now() };
    this.turns.push(userTurn);
    if (this.brain.kind === "heuristic") {
      return this.push("판단 엔진이 없습니다. ANTHROPIC_API_KEY를 설정하거나 Claude Code CLI(claude)를 설치하면 관제 AI를 쓸 수 있습니다.", []);
    }
    this.busy = true;
    const actions: ChatAction[] = [];
    try {
      const messages = this.brainMessages();
      const maxSteps = this.opts.maxSteps ?? 6;
      for (let step = 0; step < maxSteps; step++) {
        this.supervisor.usage.brainCalls += 1;
        const raw = await this.brain.complete(SYSTEM, messages);
        if (!raw) return this.push("관제 AI가 응답을 거부했습니다.", actions);
        const parsed = parseStep(raw);
        if (parsed.kind === "final") return this.push(parsed.text, actions);
        if (parsed.kind === "text") return this.push(parsed.text, actions);
        const result = await this.runTool(parsed.tool, parsed.args, confirm || /확인/.test(text));
        actions.push({ tool: parsed.tool, args: parsed.args, result: result.slice(0, 1500) });
        messages.push({ role: "assistant", content: JSON.stringify({ tool: parsed.tool, args: parsed.args }) });
        messages.push({ role: "user", content: `[도구 결과 ${parsed.tool}]\n${result.slice(0, 1500)}` });
      }
      return this.push("도구 호출 한도에 도달했습니다. 지시를 더 작게 나눠 주세요.", actions);
    } catch (e) {
      return this.push(`관제 AI 오류: ${(e as Error).message.slice(0, 200)}`, actions);
    } finally {
      this.busy = false;
    }
  }

  private push(text: string, actions: ChatAction[]): ChatTurn {
    const turn: ChatTurn = { id: this.nextId++, role: "assistant", text: redactSecrets(text).slice(0, 6000), actions, ts: Date.now() };
    this.turns.push(turn);
    if (this.turns.length > 200) this.turns.splice(0, this.turns.length - 200);
    return turn;
  }

  /** Recent turns only; tool traces from earlier turns are summarized to one line each (token control). */
  private brainMessages(): BrainMessage[] {
    const keep = this.opts.historyTurns ?? 12;
    const recent = this.turns.slice(-keep);
    const msgs: BrainMessage[] = [];
    for (const t of recent) {
      if (t.role === "user") msgs.push({ role: "user", content: t.text });
      else {
        const trace = t.actions?.length ? `(사용한 도구: ${t.actions.map((a) => a.tool).join(", ")})\n` : "";
        msgs.push({ role: "assistant", content: JSON.stringify({ final: `${trace}${t.text}` }) });
      }
    }
    if (msgs.length === 0 || msgs[0].role !== "user") msgs.unshift({ role: "user", content: "(대화 시작)" });
    return msgs;
  }

  private safeDir(p: unknown): string {
    const target = path.resolve(typeof p === "string" && p.trim() ? p : this.opts.cwdRoot);
    const rel = path.relative(this.opts.cwdRoot, target);
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`루트(${this.opts.cwdRoot}) 밖의 경로는 쓸 수 없습니다`);
    return target;
  }

  private async runTool(tool: string, args: Record<string, unknown>, confirmed: boolean): Promise<string> {
    const id = typeof args.id === "string" ? args.id : "";
    switch (tool) {
      case "list_sessions":
        return JSON.stringify(
          this.sessions.list().map((s) => ({
            id: s.id,
            name: s.name,
            preset: s.preset,
            cwd: s.cwd,
            status: s.status,
            state: s.state,
            reason: s.stateReason,
            goal: s.goal,
            policy: s.policy,
            lastLine: s.lastLine,
            suggestion: s.suggestion ? { id: s.suggestion.id, kind: s.suggestion.kind, label: s.suggestion.label } : null,
          })),
        );
      case "list_presets":
        return JSON.stringify(presetInfos().map((p) => ({ id: p.id, label: p.label, available: p.available, acceptsPrompt: p.acceptsPrompt })));
      case "read_output": {
        if (!this.sessions.get(id)) return `세션 ${id} 없음`;
        const n = Math.max(5, Math.min(120, Number(args.lines) || 40));
        return compactTail(this.sessions.tail(id, n), 6000).join("\n") || "(출력 없음)";
      }
      case "send_input": {
        const s = this.sessions.get(id);
        if (!s) return `세션 ${id} 없음`;
        if (s.status !== "running") return `세션 ${id}은(는) 실행 중이 아닙니다 (${s.status})`;
        const text = typeof args.text === "string" ? args.text : "";
        if (DANGEROUS_INPUT.test(text) && !confirmed) return "거부: 파괴적 명령으로 보입니다. 사용자가 '확인'이라고 말해야 실행합니다.";
        const data = args.enter === false ? text : `${text}\r`;
        this.sessions.write(id, data);
        this.supervisor.log("action", id, "chat", `관제 AI 입력: ${describeInput(data)}`);
        return `전송됨: ${describeInput(data)}`;
      }
      case "create_session": {
        const preset = typeof args.preset === "string" ? args.preset : "claude-print";
        const cwd = this.safeDir(args.cwd);
        if (!fs.existsSync(cwd)) return `폴더 없음: ${cwd}`;
        const req: CreateSessionRequest = {
          preset,
          cwd,
          prompt: typeof args.prompt === "string" ? args.prompt : undefined,
          name: typeof args.name === "string" ? args.name : undefined,
          goal: typeof args.goal === "string" ? args.goal : typeof args.prompt === "string" ? args.prompt.slice(0, 200) : undefined,
          policy: isPolicy(args.policy) ? args.policy : undefined,
          command: typeof args.command === "string" ? args.command : undefined,
          tags: ["chat"],
        };
        if (req.command && DANGEROUS_INPUT.test(req.command) && !confirmed) return "거부: 파괴적 명령으로 보입니다. 사용자가 '확인'이라고 말해야 실행합니다.";
        const s = this.sessions.create(req);
        this.supervisor.log("action", s.id, "chat", `관제 AI가 세션 생성: ${s.name} (${s.preset}) @ ${s.cwd}`);
        return `생성됨: id=${s.id} name=${s.name}`;
      }
      case "kill_session": {
        if (!this.sessions.get(id)) return `세션 ${id} 없음`;
        this.sessions.kill(id);
        this.supervisor.log("action", id, "chat", "관제 AI가 세션 종료");
        return `종료 요청: ${id}`;
      }
      case "set_goal":
        return this.supervisor.setGoal(id, typeof args.goal === "string" ? args.goal : null, "chat") ? "목표 설정됨" : `세션 ${id} 없음`;
      case "set_policy":
        if (!isPolicy(args.policy)) return "policy는 manual|assist|auto";
        return this.supervisor.setPolicy(id, args.policy, "chat") ? `정책 → ${args.policy}` : `세션 ${id} 없음`;
      case "approve_suggestion":
      case "dismiss_suggestion": {
        const s = this.sessions.get(id);
        if (!s?.suggestion) return `세션 ${id}에 대기 중인 제안 없음`;
        if (tool === "approve_suggestion" && s.suggestion.input && DANGEROUS_INPUT.test(s.suggestion.input) && !confirmed) return "거부: 파괴적 입력. 사용자 '확인' 필요.";
        this.supervisor.decide(id, s.suggestion.id, tool === "approve_suggestion" ? "approve" : "dismiss", "chat");
        return tool === "approve_suggestion" ? "제안 승인됨" : "제안 무시됨";
      }
      case "list_dirs": {
        const dir = this.safeDir(args.path);
        const entries = fs
          .readdirSync(dir, { withFileTypes: true })
          .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
          .map((e) => e.name)
          .slice(0, 80);
        return `${dir}\n${entries.join("\n")}`;
      }
      default:
        return `알 수 없는 도구: ${tool}`;
    }
  }
}

function isPolicy(v: unknown): v is Policy {
  return v === "manual" || v === "assist" || v === "auto";
}

type Step = { kind: "final"; text: string } | { kind: "tool"; tool: string; args: Record<string, unknown> } | { kind: "text"; text: string };

export function parseStep(raw: string): Step {
  const trimmed = raw.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const obj = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
      if (typeof obj.final === "string") return { kind: "final", text: obj.final };
      if (typeof obj.tool === "string") return { kind: "tool", tool: obj.tool, args: (obj.args as Record<string, unknown>) ?? {} };
    } catch {
      /* fall through: treat as prose */
    }
  }
  return { kind: "text", text: trimmed };
}
