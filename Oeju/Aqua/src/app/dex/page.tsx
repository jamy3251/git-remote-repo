import { Suspense } from "react";
import { DexGrid } from "./DexGrid";

export const metadata = { title: "도감 | 아쿠아 도감" };

export default function DexPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh" />}>
      <DexGrid />
    </Suspense>
  );
}
