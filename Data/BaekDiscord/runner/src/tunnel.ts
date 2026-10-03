import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import type { TunnelStatus } from "./protocol.js";
import { binaryAvailable } from "./presets.js";
import { isWindows } from "./config.js";

type Provider = "ngrok" | "cloudflared";

export interface TunnelOptions {
  port: number;
  /** Token embedded in the QR link so a phone can authenticate by scanning. */
  token: string;
  /** Dashboard path opened by the QR code, e.g. /control */
  dashboardPath: string;
}

const URL_RE = /https:\/\/[a-z0-9.-]+\.(?:ngrok(?:-free)?\.(?:app|dev)|ngrok\.io|trycloudflare\.com)\b/i;

/**
 * Starts an outbound tunnel (ngrok or cloudflared) to the runner so a phone or another machine
 * can reach the dashboard. Emits "change" with the new status.
 */
export class TunnelManager extends EventEmitter {
  private proc: ChildProcess | null = null;
  private current: TunnelStatus = {
    provider: null,
    available: { ngrok: binaryAvailable("ngrok"), cloudflared: binaryAvailable("cloudflared") },
    state: "stopped",
    url: null,
    qrSvg: null,
    error: null,
    startedAt: null,
  };

  constructor(private opts: TunnelOptions) {
    super();
  }

  status(): TunnelStatus {
    return { ...this.current, available: { ...this.current.available } };
  }

  private set(patch: Partial<TunnelStatus>): void {
    this.current = { ...this.current, ...patch };
    this.emit("change", this.status());
  }

  async start(provider?: Provider): Promise<TunnelStatus> {
    if (this.proc) return this.status();
    const chosen: Provider | null = provider ?? (this.current.available.ngrok ? "ngrok" : this.current.available.cloudflared ? "cloudflared" : null);
    if (!chosen) {
      this.set({ state: "error", error: "ngrok 또는 cloudflared가 설치되어 있지 않습니다. (winget install Ngrok.Ngrok / Cloudflare.cloudflared)" });
      return this.status();
    }
    if (!this.current.available[chosen]) {
      this.set({ state: "error", error: `${chosen}이(가) 설치되어 있지 않습니다.` });
      return this.status();
    }
    const target = `http://127.0.0.1:${this.opts.port}`;
    const args =
      chosen === "ngrok"
        ? ["http", target, "--log", "stdout", "--log-format", "json"]
        : ["tunnel", "--url", target, "--no-autoupdate"];
    const file = isWindows ? "cmd.exe" : chosen;
    const fileArgs = isWindows ? ["/d", "/s", "/c", `${chosen} ${args.join(" ")}`] : args;

    this.set({ provider: chosen, state: "starting", url: null, qrSvg: null, error: null, startedAt: Date.now() });
    const proc = spawn(file, fileArgs, { windowsHide: true, windowsVerbatimArguments: isWindows, stdio: ["ignore", "pipe", "pipe"] });
    this.proc = proc;
    let buffer = "";
    const onData = (d: string) => {
      buffer += d;
      if (buffer.length > 20_000) buffer = buffer.slice(-10_000);
      if (this.current.url) return;
      const m = buffer.match(URL_RE);
      if (m) void this.announce(m[0]);
    };
    proc.stdout?.setEncoding("utf8");
    proc.stderr?.setEncoding("utf8");
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    proc.on("error", (e) => {
      this.proc = null;
      this.set({ state: "error", error: e.message });
    });
    proc.on("close", (code) => {
      this.proc = null;
      if (this.current.state !== "stopped") {
        const tail = buffer.split(/\r?\n/).filter(Boolean).slice(-3).join(" | ");
        this.set({
          state: code === 0 || this.current.state === "running" ? "stopped" : "error",
          url: null,
          qrSvg: null,
          error: code === 0 ? null : `${chosen} 종료 (code ${code}) ${tail}`.slice(0, 300),
        });
      }
    });

    // ngrok's JSON log sometimes arrives only after the local API is up; poll it as a fallback.
    if (chosen === "ngrok") {
      const deadline = Date.now() + 20_000;
      const poll = async () => {
        while (!this.current.url && this.proc === proc && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 1500));
          try {
            const res = await fetch("http://127.0.0.1:4040/api/tunnels");
            const j = (await res.json()) as { tunnels?: Array<{ public_url?: string }> };
            const url = j.tunnels?.map((t) => t.public_url).find((u) => u?.startsWith("https://"));
            if (url) await this.announce(url);
          } catch {
            /* not up yet */
          }
        }
        if (!this.current.url && this.proc === proc) {
          this.set({ state: "error", error: "터널 URL을 20초 안에 받지 못했습니다. ngrok 로그인(ngrok config add-authtoken) 여부를 확인하세요." });
          this.stop();
        }
      };
      void poll();
    } else {
      setTimeout(() => {
        if (!this.current.url && this.proc === proc) {
          this.set({ state: "error", error: "터널 URL을 30초 안에 받지 못했습니다." });
          this.stop();
        }
      }, 30_000);
    }
    return this.status();
  }

  private async announce(url: string): Promise<void> {
    if (this.current.url) return;
    const link = `${url}${this.opts.dashboardPath}#rt=${encodeURIComponent(this.opts.token)}`;
    let qrSvg: string | null = null;
    try {
      const { default: QRCode } = await import("qrcode");
      qrSvg = await QRCode.toString(link, { type: "svg", margin: 1, width: 220 });
    } catch (e) {
      qrSvg = null;
      this.emit("warn", `QR 생성 실패: ${(e as Error).message}`);
    }
    this.set({ state: "running", url, qrSvg, error: null });
    this.emit("url", url);
  }

  stop(): TunnelStatus {
    const proc = this.proc;
    this.proc = null;
    if (proc?.pid) {
      if (isWindows) spawn("taskkill", ["/pid", String(proc.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
      else proc.kill("SIGTERM");
    }
    this.set({ state: "stopped", url: null, qrSvg: null, error: null, startedAt: null });
    return this.status();
  }
}
