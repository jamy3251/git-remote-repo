// assets/icon.svg 하나로 PWA·안드로이드 아이콘을 만든다: node scripts/gen-icons.mjs
import { mkdirSync } from "node:fs";
import sharp from "sharp";

const src = "assets/icon.svg";
const out = [
  ["public/icon-192.png", 192],
  ["public/icon-512.png", 512],
  ["public/apple-touch-icon.png", 180],
];
for (const [file, size] of out) await sharp(src).resize(size, size).png().toFile(file);

// 마스커블: 안드로이드가 원·물방울로 잘라도 그림이 남도록 배경은 꽉 채우고 그림만 가운데로 줄인 원본을 쓴다
await sharp("assets/icon-maskable.svg").resize(512, 512).png().toFile("public/icon-maskable-512.png");

// Capacitor 안드로이드 런처 아이콘 (android/ 가 있을 때 scripts/android-icons 에서 복사)
mkdirSync("assets/android", { recursive: true });
const densities = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [d, size] of Object.entries(densities)) {
  mkdirSync(`assets/android/mipmap-${d}`, { recursive: true });
  await sharp("assets/icon-maskable.svg").resize(size, size).png().toFile(`assets/android/mipmap-${d}/ic_launcher.png`);
  const r = Math.round(size / 2);
  const mask = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${r}" cy="${r}" r="${r}"/></svg>`);
  await sharp(src).resize(size, size).composite([{ input: mask, blend: "dest-in" }]).png().toFile(`assets/android/mipmap-${d}/ic_launcher_round.png`);
}
console.log("icons ok");
