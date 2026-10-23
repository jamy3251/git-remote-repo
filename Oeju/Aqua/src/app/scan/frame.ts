import type { Box } from "@/lib/lockOn";

export const SEND_WIDTH = 640;

/** 영상 한 프레임을 640px JPEG(base64, 접두어 제외)로 */
export function grabFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement, maxWidth = SEND_WIDTH, quality = 0.72) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const scale = Math.min(1, maxWidth / vw);
  const width = Math.round(vw * scale);
  const height = Math.round(vh * scale);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, width, height);
  const image = canvas.toDataURL("image/jpeg", quality).split(",")[1];
  return { image, width, height };
}

/** 조준 박스 주변을 잘라 도감용 썸네일로 */
export function cropThumbnail(video: HTMLVideoElement, box: Box, size = 192): string | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const side = Math.max(box.w * vw, box.h * vh) * 1.25;
  const cx = box.x * vw;
  const cy = box.y * vh;
  const sx = Math.max(0, Math.min(vw - side, cx - side / 2));
  const sy = Math.max(0, Math.min(vh - side, cy - side / 2));
  const s = Math.min(side, vw, vh);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, sx, sy, s, s, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", 0.75);
}

/**
 * 학습용 사진: 물고기 주변을 넉넉히(박스의 1.8배) 잘라 최대 640px.
 * 전체 화면 대신 이렇게 보내면 옆 관람객이 찍힐 일이 크게 준다.
 */
export function cropForTraining(video: HTMLVideoElement, box: Box, maxSide = 640, margin = 1.8): string | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const w = Math.min(vw, box.w * vw * margin);
  const h = Math.min(vh, box.h * vh * margin);
  const sx = Math.max(0, Math.min(vw - w, box.x * vw - w / 2));
  const sy = Math.max(0, Math.min(vh - h, box.y * vh - h / 2));
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, sx, sy, w, h, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
}

/** 2차 판정용: 평가 도구와 같은 조건 (박스의 1.3배, 작게) */
export function cropForVerify(video: HTMLVideoElement, box: Box): string | null {
  return cropForTraining(video, box, 320, 1.3);
}

/** object-fit: cover 로 그려진 영상 위에 정규화 좌표를 올리기 위한 변환 */
export function coverTransform(container: { w: number; h: number }, media: { w: number; h: number }) {
  const scale = Math.max(container.w / media.w, container.h / media.h);
  const dw = media.w * scale;
  const dh = media.h * scale;
  const ox = (container.w - dw) / 2;
  const oy = (container.h - dh) / 2;
  return (b: Box) => ({
    left: ox + (b.x - b.w / 2) * dw,
    top: oy + (b.y - b.h / 2) * dh,
    width: b.w * dw,
    height: b.h * dh,
  });
}
