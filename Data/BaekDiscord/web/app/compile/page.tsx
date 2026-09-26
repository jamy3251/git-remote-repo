import type { Metadata } from "next";
import { ClientOnly } from "@/components/client-only";
import { CompileView } from "./compile-view";

export const metadata: Metadata = { title: "컴파일러 · DevHub" };

export default function CompilePage() {
  return (
    <ClientOnly fallback={<div className="p-10 text-center text-sm text-muted">컴파일러를 불러오는 중…</div>}>
      <CompileView />
    </ClientOnly>
  );
}
