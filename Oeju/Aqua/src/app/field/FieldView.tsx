"use client";

import Link from "next/link";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { RECOMMENDED_MODELS } from "@/lib/detection/models";
import { ScanView } from "../scan/ScanView";

const KEY = "coex-aqua-dex:field-key";
// 이 화면은 "분석 모드"(운영자용). 경로는 /field 를 유지한다

type Auth = { key: string; checkinCode: string | null };

function readSaved(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

async function verify(key: string): Promise<Auth | null> {
  const res = await fetch("/api/field/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { ok: boolean; checkinCode: string | null };
  return data.ok ? { key, checkinCode: data.checkinCode } : null;
}

export function FieldView() {
  const [auth, setAuth] = useState<Auth | null>(null);
  const [checking, setChecking] = useState(true);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  // 같은 탭에서 다시 들어오면 저장된 암호로 자동 인증
  useEffect(() => {
    Promise.resolve(readSaved())
      .then((saved) => (saved ? verify(saved) : null))
      .then((a) => setAuth(a))
      .catch(() => setAuth(null))
      .finally(() => setChecking(false));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const a = await verify(input.trim()).catch(() => null);
    if (!a) {
      setError("암호가 맞지 않거나 현장 모드가 꺼져 있어요.");
      return;
    }
    try {
      sessionStorage.setItem(KEY, a.key);
    } catch {}
    setAuth(a);
  }

  // 인증되면 곧바로 카메라를 켜고 실시간 분석 화면으로 들어간다
  if (auth) return <ScanView fieldKey={auth.key} info={<FieldInfo checkinCode={auth.checkinCode} />} />;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 pb-10 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <header className="flex h-10 items-center justify-between">
        <Link href="/" className="text-sm text-muted">
          홈
        </Link>
        <h1 className="font-bold">분석 모드</h1>
        <span className="w-6" />
      </header>

      {checking ? (
        <p className="text-sm text-muted">확인 중...</p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3 rounded-3xl border border-line bg-surface p-5">
          <p className="text-sm leading-relaxed text-muted">
            운영자용 화면이에요. 들어가면 바로 카메라가 켜지고 모델별 인식 결과를 실시간으로 보여줘요.
          </p>
          <input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="분석 모드 암호"
            aria-label="분석 모드 암호"
            autoComplete="off"
            className="rounded-2xl border border-line bg-bg px-4 py-3.5 outline-none focus:border-accent"
          />
          {error && <p className="text-sm text-danger">{error}</p>}
          <button type="submit" className="rounded-2xl bg-accent py-3.5 font-bold text-accent-ink">
            카메라 켜고 분석 시작
          </button>
        </form>
      )}
    </main>
  );
}

/** 분석 화면 안에서 여는 안내: 할 일, 사용 중인 모델, 입구 QR */
function FieldInfo({ checkinCode }: { checkinCode: string | null }) {
  return (
    <div className="space-y-4 text-sm">
      <section>
        <h2 className="font-bold">현장에서 할 일</h2>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 leading-relaxed text-muted">
          <li>수조마다 구역을 고르고 모델별 결과를 확인</li>
          <li>안 잡히거나 틀리는 종은 &ldquo;학습용 촬영&rdquo;으로 여러 각도에서 촬영</li>
          <li>오답이 잦으면 포획 기준 확신도를 올려 보고 적당한 값을 기록</li>
          <li>Roboflow 프로젝트에서 사진에 박스를 그리고 새 버전 학습</li>
        </ol>
      </section>
      <section>
        <h2 className="font-bold">사용 중인 모델</h2>
        <ul className="mt-2 space-y-1.5 text-muted">
          {RECOMMENDED_MODELS.map((m) => (
            <li key={m.id}>
              <span className="hud text-xs text-text">{m.id}</span>
              <span className="block text-xs">{m.role}</span>
            </li>
          ))}
        </ul>
      </section>
      <CheckinQr code={checkinCode} />
    </div>
  );
}

function CheckinQr({ code }: { code: string | null }) {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    const url = `${window.location.origin}/checkin?c=${encodeURIComponent(code)}`;
    QRCode.toString(url, { type: "svg", margin: 1, color: { dark: "#050e14", light: "#ffffff" } })
      .then(setSvg)
      .catch(() => setSvg(null));
  }, [code]);

  return (
    <section>
      <h2 className="font-bold">입구 도착 확인 QR</h2>
      {!code ? (
        <p className="mt-2 text-muted">CHECKIN_CODE 환경변수를 넣으면 여기에 QR이 생겨요.</p>
      ) : (
        <>
          <p className="mt-1 text-muted">지하라 GPS가 안 잡힐 때를 위한 QR이에요. 인쇄해서 입구에 두세요.</p>
          {svg && (
            <div
              className="mx-auto mt-4 w-48 overflow-hidden rounded-2xl bg-white p-2"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          )}
        </>
      )}
    </section>
  );
}
