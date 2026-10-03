import http from "node:http";
import type { Duplex } from "node:stream";

/**
 * Minimal reverse proxy so the whole dashboard (Next.js) can be reached through the runner's
 * single port — and therefore through a single tunnel URL. The Host header is rewritten to the
 * target so Next's dev server treats the request as local.
 */
export function proxyHttp(req: http.IncomingMessage, res: http.ServerResponse, target: URL): void {
  const headers: http.OutgoingHttpHeaders = { ...req.headers, host: target.host };
  const forwardedHost = req.headers.host;
  if (forwardedHost) headers["x-forwarded-host"] = forwardedHost;
  headers["x-forwarded-proto"] = req.headers["x-forwarded-proto"] ?? "http";

  const upstream = http.request(
    { hostname: target.hostname, port: target.port, method: req.method, path: req.url, headers },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", (e) => {
    if (res.headersSent) return res.destroy();
    res.writeHead(502, { "content-type": "text/html; charset=utf-8" });
    res.end(
      `<!doctype html><meta charset="utf-8"><title>DevHub runner</title><body style="font-family:system-ui;background:#0b0d10;color:#e6e8eb;padding:2rem">` +
        `<h2>웹 대시보드에 연결할 수 없습니다</h2><p>${target.origin} 이(가) 응답하지 않습니다 (${e.message}).</p>` +
        `<p>저장소 루트에서 <code>npm run dev:web</code> 또는 <code>npm run start -w web</code> 을 실행하세요. 러너 API 자체는 정상입니다: <a href="/runner/health" style="color:#7c9cff">/runner/health</a></p></body>`,
    );
  });
  req.pipe(upstream);
}

export function proxyUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer, target: URL): void {
  const headers: http.OutgoingHttpHeaders = { ...req.headers, host: target.host };
  const upstream = http.request({ hostname: target.hostname, port: target.port, method: req.method, path: req.url, headers });
  upstream.on("upgrade", (up, upSocket, upHead) => {
    const lines = [`HTTP/1.1 ${up.statusCode} ${up.statusMessage}`];
    for (const [k, v] of Object.entries(up.headers)) {
      if (Array.isArray(v)) for (const item of v) lines.push(`${k}: ${item}`);
      else if (v !== undefined) lines.push(`${k}: ${v}`);
    }
    socket.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (upHead.length) socket.write(upHead);
    upSocket.pipe(socket);
    socket.pipe(upSocket);
    upSocket.on("error", () => socket.destroy());
    socket.on("error", () => upSocket.destroy());
  });
  upstream.on("response", (up) => {
    // Upstream refused the upgrade: relay its status and close.
    socket.write(`HTTP/1.1 ${up.statusCode} ${up.statusMessage}\r\nconnection: close\r\n\r\n`);
    socket.destroy();
  });
  upstream.on("error", () => socket.destroy());
  if (head.length) upstream.write(head);
  upstream.end();
}
