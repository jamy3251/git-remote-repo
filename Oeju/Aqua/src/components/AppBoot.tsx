"use client";

import { useEffect } from "react";
import { startUploadQueue } from "@/lib/uploadQueue";

/** 앱 시작 시 한 번: 서비스 워커 등록, 못 보낸 학습용 사진 재전송 */
export function AppBoot() {
  useEffect(() => {
    startUploadQueue();
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
  }, []);
  return null;
}
