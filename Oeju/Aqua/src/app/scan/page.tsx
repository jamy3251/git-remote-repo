import { Suspense } from "react";
import { ScanView } from "./ScanView";

export const metadata = { title: "탐사 | 아쿠아 도감" };

export default function ScanPage() {
  return (
    <Suspense fallback={<main className="fixed inset-0 bg-black" />}>
      <ScanView />
    </Suspense>
  );
}
