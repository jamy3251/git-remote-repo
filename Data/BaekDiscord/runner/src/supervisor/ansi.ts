/** Strip ANSI escape sequences, OSC titles, and control characters so output can be judged as text. */
export function stripAnsi(input: string): string {
  return (
    input
      // OSC: ESC ] ... BEL or ESC \
      .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "")
      // CSI: ESC [ params letter
      .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
      // Other two-byte escapes
      .replace(/\u001b[@-Z\\-_]/g, "")
      // Carriage return handling: CRLF is a plain newline; a bare CR rewrites the line, keep the last rewrite
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => {
        const parts = line.split("\r");
        for (let i = parts.length - 1; i >= 0; i--) if (parts[i].length > 0) return parts[i];
        return "";
      })
      .join("\n")
      // Remaining control chars except newline/tab
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
  );
}

/** Last `n` non-empty lines of ANSI-stripped text, trimmed on the right. */
export function tailLines(raw: string, n: number): string[] {
  const lines = stripAnsi(raw)
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim().length > 0);
  return lines.slice(-n);
}
