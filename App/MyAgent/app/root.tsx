import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "manifest", href: "/manifest.json" },
  { rel: "icon", href: "/favicon.ico" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        <meta name="theme-color" content="#e2b714" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let code = "ERR";
  let message = "Something went wrong.";

  if (isRouteErrorResponse(error)) {
    code = String(error.status);
    message =
      error.status === 404
        ? "This courtroom does not exist."
        : error.statusText || message;
  }

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "#1a1a2e",
        color: "#eee",
        fontFamily: "'DungGeunMo', monospace",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          fontSize: 64,
          color: "#e94560",
          textShadow: "3px 3px 0 rgba(0,0,0,0.8)",
          marginBottom: 8,
        }}
      >
        !! OBJECTION !!
      </div>
      <div
        style={{
          background: "#16213e",
          border: "3px solid #e2b714",
          padding: "24px 40px",
          maxWidth: 400,
          boxShadow: "4px 4px 0 rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ fontSize: 48, color: "#e2b714", marginBottom: 12 }}>
          {code}
        </div>
        <div style={{ fontSize: 16, color: "#a0a0b0", marginBottom: 20 }}>
          {message}
        </div>
        <a
          href="/"
          style={{
            display: "inline-block",
            background: "#0f3460",
            border: "2px solid #e2b714",
            color: "#e2b714",
            padding: "8px 24px",
            fontFamily: "'DungGeunMo', monospace",
            fontSize: 14,
            textDecoration: "none",
            cursor: "pointer",
          }}
        >
          Return to AI Cafe
        </a>
      </div>
      <div
        style={{
          marginTop: 32,
          width: 32,
          height: 40,
          position: "relative",
        }}
      >
        {/* Sad pixel character */}
        <div style={{ width: 20, height: 20, background: "#FFD5B0", border: "2px solid #e94560", position: "absolute", top: 0, left: 6 }} />
        <div style={{ position: "absolute", top: 10, left: 10, width: 3, height: 2, background: "#333", boxShadow: "8px 0 0 #333" }} />
        <div style={{ width: 22, height: 8, background: "#e94560", position: "absolute", top: -2, left: 5 }} />
        <div style={{ width: 18, height: 14, background: "#e94560", position: "absolute", top: 20, left: 7, opacity: 0.9 }} />
        <div style={{ position: "absolute", top: 34, left: 9, width: 5, height: 6, background: "#555" }} />
        <div style={{ position: "absolute", top: 34, left: 18, width: 5, height: 6, background: "#555" }} />
      </div>
    </div>
  );
}
