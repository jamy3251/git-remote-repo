import type { NextRequest } from "next/server";

/** Public origin for links placed into Discord messages. */
export function publicBaseUrl(req?: NextRequest): string {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  if (req) return req.nextUrl.origin;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}
