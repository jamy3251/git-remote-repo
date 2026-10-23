"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { recordVisit } from "@/lib/visits";

type State = "checking" | "ok" | "bad";

/** 입구 QR로 들어오는 화면. 코드를 서버에서 확인하고 오늘 방문을 기록한다 */
export function CheckinView() {
  const code = useSearchParams().get("c");
  const [state, setState] = useState<State>(code ? "checking" : "bad");

  useEffect(() => {
    if (!code) return;
    fetch("/api/checkin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    })
      .then((r) => {
        if (!r.ok) return setState("bad");
        recordVisit("qr");
        setState("ok");
      })
      .catch(() => setState("bad"));
  }, [code]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      {state === "checking" && <p className="text-muted">도착 확인 중...</p>}
      {state === "ok" && (
        <>
          <p className="hud text-xs text-accent">ON SITE</p>
          <h1 className="text-3xl font-black leading-tight">코엑스 아쿠아리움에 오신 걸 환영해요</h1>
          <p className="text-muted">오늘 포획하는 생물은 현장 보너스로 경험치가 1.5배예요.</p>
          <Link href="/scan" className="mt-2 w-full rounded-2xl bg-accent py-4 text-lg font-black text-accent-ink">
            탐사 시작
          </Link>
        </>
      )}
      {state === "bad" && (
        <>
          <h1 className="text-2xl font-black">확인할 수 없는 QR이에요</h1>
          <p className="text-muted">입구에 붙은 QR을 다시 찍어 주세요. 홈에서 위치로도 확인할 수 있어요.</p>
          <Link href="/" className="mt-2 w-full rounded-2xl border border-line py-3.5 font-medium">
            홈으로
          </Link>
        </>
      )}
    </main>
  );
}
