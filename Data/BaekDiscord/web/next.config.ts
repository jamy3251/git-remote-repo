import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    // The dashboard talks to the local runner (http/ws on 127.0.0.1:7331) or to its own origin when proxied/tunneled.
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://avatars.githubusercontent.com",
      "font-src 'self' data:",
      "connect-src 'self' http://127.0.0.1:7331 ws://127.0.0.1:7331 http://localhost:7331 ws://localhost:7331 https: wss:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self' https://github.com",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  // The runner proxies the dashboard through tunnel hosts; allow their dev-asset requests.
  allowedDevOrigins: ["127.0.0.1", "*.ngrok-free.app", "*.ngrok-free.dev", "*.ngrok.app", "*.ngrok.io", "*.trycloudflare.com"],
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
