import type { Metadata } from "next";
import { ClientOnly } from "@/components/client-only";
import { ControlView } from "./control-view";

export const metadata: Metadata = { title: "관제 · DevHub" };

export default function ControlPage() {
  return (
    <ClientOnly fallback={<div className="p-10 text-center text-sm text-muted">관제 화면을 불러오는 중…</div>}>
      <ControlView />
    </ClientOnly>
  );
}
