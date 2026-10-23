import { Suspense } from "react";
import { FieldView } from "./FieldView";

export const metadata = { title: "분석 모드 | 아쿠아 도감", robots: { index: false } };

export default function FieldPage() {
  return (
    <Suspense fallback={<main className="min-h-dvh" />}>
      <FieldView />
    </Suspense>
  );
}
