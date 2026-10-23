"use client";

import { useCallback, useState } from "react";
import { judgeFix, type GeoVerdict } from "./geo";
import { recordVisit } from "./visits";

export type GeoState =
  | { kind: "idle" }
  | { kind: "locating" }
  | GeoVerdict
  | { kind: "denied" }
  | { kind: "unavailable"; reason: string };

export function useGeoCheckin() {
  const [state, setState] = useState<GeoState>({ kind: "idle" });

  const check = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setState({ kind: "unavailable", reason: "이 기기는 위치를 지원하지 않아요" });
      return;
    }
    setState({ kind: "locating" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const verdict = judgeFix({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        if (verdict.kind === "inside") recordVisit("gps");
        setState(verdict);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setState({ kind: "denied" });
        else if (err.code === err.TIMEOUT) setState({ kind: "unavailable", reason: "위치 신호가 약해요" });
        else setState({ kind: "unavailable", reason: "위치를 찾지 못했어요" });
      },
      // 지하에서는 고정밀 측위가 오래 걸린다. 12초 안에 못 잡으면 QR로 넘긴다
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  }, []);

  return { state, check };
}
