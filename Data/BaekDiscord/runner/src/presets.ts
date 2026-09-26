import { spawnSync } from "node:child_process";
import type { PresetInfo, SessionMode } from "./protocol.js";
import { isWindows } from "./config.js";

export interface Preset {
  id: string;
  label: string;
  description: string;
  mode: SessionMode;
  /** Shell command line. Empty string = custom (client supplies). */
  command: string;
  /** Binary probed for availability. */
  binary: string | null;
  acceptsPrompt: boolean;
}

export const PRESETS: Preset[] = [
  {
    id: "claude",
    label: "Claude Code (대화형)",
    description: "인터랙티브 Claude Code 세션. 터미널 타일에서 직접 입력합니다.",
    mode: "pty",
    command: "claude",
    binary: "claude",
    acceptsPrompt: false,
  },
  {
    id: "claude-print",
    label: "Claude Code (프롬프트 1회)",
    description: "claude -p 로 프롬프트를 한 번 실행하고 종료합니다. 여러 폴더에 같은 지시를 뿌릴 때 사용.",
    mode: "pipe",
    command: "claude -p --output-format text",
    binary: "claude",
    acceptsPrompt: true,
  },
  {
    id: "codex",
    label: "Codex CLI (대화형)",
    description: "인터랙티브 OpenAI Codex 세션.",
    mode: "pty",
    command: "codex",
    binary: "codex",
    acceptsPrompt: false,
  },
  {
    id: "codex-exec",
    label: "Codex CLI (프롬프트 1회)",
    description: "codex exec 로 프롬프트를 한 번 실행하고 종료합니다.",
    mode: "pipe",
    command: "codex exec -",
    binary: "codex",
    acceptsPrompt: true,
  },
  {
    id: "shell",
    label: isWindows ? "PowerShell" : "Shell",
    description: "일반 셸 세션.",
    mode: "pty",
    command: isWindows ? "powershell.exe -NoLogo" : process.env.SHELL ?? "/bin/bash",
    binary: null,
    acceptsPrompt: false,
  },
  {
    id: "custom",
    label: "사용자 지정 명령",
    description: "임의 명령을 PTY로 실행합니다 (예: npm run dev).",
    mode: "pty",
    command: "",
    binary: null,
    acceptsPrompt: false,
  },
];

const availabilityCache = new Map<string, boolean>();

export function binaryAvailable(bin: string): boolean {
  const cached = availabilityCache.get(bin);
  if (cached !== undefined) return cached;
  const probe = isWindows ? spawnSync("where", [bin], { windowsHide: true }) : spawnSync("which", [bin]);
  const ok = probe.status === 0;
  availabilityCache.set(bin, ok);
  return ok;
}

export function presetInfos(): PresetInfo[] {
  return PRESETS.map((p) => ({
    id: p.id,
    label: p.label,
    description: p.description,
    mode: p.mode,
    acceptsPrompt: p.acceptsPrompt,
    available: p.binary ? binaryAvailable(p.binary) : true,
  }));
}

export function findPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}
