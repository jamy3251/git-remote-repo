import type { Metadata } from "next";
import { ClientOnly } from "@/components/client-only";
import { ProductsPage } from "./products-page";

export const metadata: Metadata = { title: "프로덕트 · DevHub" };

export default function Page() {
  return (
    <ClientOnly fallback={<div className="p-10 text-center text-sm text-muted">프로덕트를 불러오는 중…</div>}>
      <ProductsPage />
    </ClientOnly>
  );
}
