import type { Metadata } from "next";
import { ClientOnly } from "@/components/client-only";
import { ConsoleView } from "./console-view";

export const metadata: Metadata = { title: "CLI 콘솔 · DevHub" };

export default function ConsolePage() {
  return (
    <ClientOnly fallback={<div className="p-10 text-center text-sm text-muted">콘솔을 불러오는 중…</div>}>
      <ConsoleView />
    </ClientOnly>
  );
}
