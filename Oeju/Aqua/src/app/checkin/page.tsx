import { Suspense } from "react";
import { CheckinView } from "./CheckinView";

export const metadata = { title: "도착 확인 | 아쿠아 도감", robots: { index: false } };

export default function CheckinPage() {
  return (
    <Suspense fallback={<main className="min-h-dvh" />}>
      <CheckinView />
    </Suspense>
  );
}
