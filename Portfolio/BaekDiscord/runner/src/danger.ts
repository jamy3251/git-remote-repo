/**
 * The one table of "never do this without a person" patterns. Used on terminal output (heuristics),
 * on what the control chat is about to type, and on the tool input of a hook permission request.
 */
export const DANGER_PATTERNS: Array<[RegExp, string]> = [
  [/\brm\s+-rf?\b|\bRemove-Item\b.*-Recurse|\bdel\s+\/[sq]\b|\brmdir\s+\/s\b/i, "재귀 삭제 명령"],
  [/\bgit\s+push\b.*(--force|-f\b)|\bgit\s+reset\s+--hard\b|\bgit\s+clean\s+-[a-z]*f/i, "되돌리기 어려운 git 명령"],
  [/\bDROP\s+(TABLE|DATABASE|SCHEMA)\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i, "파괴적 SQL"],
  [/\bformat\s+[a-z]:|\bdiskpart\b|\bmkfs\b|\bdd\s+if=/i, "디스크 포맷/덮어쓰기"],
  [/\bshutdown\b|\breboot\b|\bRestart-Computer\b/i, "시스템 재시작"],
  [/\bnpm\s+publish\b|\bcargo\s+publish\b|\bvercel\s+(--prod|deploy)\b|\bgh\s+release\s+create\b/i, "외부 배포/배포"],
  [/\.env\b.*(secret|key|token)|\bAPI[_ ]?KEY\b|\bpassword\b/i, "비밀/자격 증명 언급"],
  [/\bchmod\s+-R\s+777\b|\bicacls\b.*\/grant\b/i, "권한 전면 개방"],
];

export function detectDangerText(text: string): { danger: boolean; reason: string | null } {
  for (const [re, why] of DANGER_PATTERNS) if (re.test(text)) return { danger: true, reason: why };
  return { danger: false, reason: null };
}
