// 안드로이드 런처 아이콘·스플래시를 앱 아이콘으로 교체: node scripts/android-assets.mjs
// (npx cap add android 직후 한 번, 아이콘을 바꿨을 때 다시)
import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import sharp from "sharp";

const res = "android/app/src/main/res";
if (!existsSync(res)) throw new Error("android/ 가 없습니다. 먼저 npx cap add android");

for (const dir of readdirSync("assets/android")) {
  cpSync(`assets/android/${dir}`, `${res}/${dir}`, { recursive: true });
}
// 적응형 아이콘(Capacitor 기본 로고)을 지우고 위 PNG 를 쓰게 한다
rmSync(`${res}/mipmap-anydpi-v26`, { recursive: true, force: true });

// 스플래시: 기존 파일 크기 그대로, 어두운 배경 가운데 아이콘
for (const dir of readdirSync(res).filter((d) => d.startsWith("drawable"))) {
  const file = `${res}/${dir}/splash.png`;
  if (!existsSync(file)) continue;
  const { width, height } = await sharp(file).metadata();
  const side = Math.round(Math.min(width, height) * 0.28);
  const icon = await sharp("assets/icon.svg").resize(side, side).png().toBuffer();
  const rounded = await sharp(icon)
    .composite([{ input: Buffer.from(`<svg width="${side}" height="${side}"><rect width="${side}" height="${side}" rx="${side * 0.22}"/></svg>`), blend: "dest-in" }])
    .png()
    .toBuffer();
  await sharp({ create: { width, height, channels: 4, background: "#050e14" } })
    .composite([{ input: rounded, gravity: "center" }])
    .png()
    .toFile(file + ".tmp");
  cpSync(file + ".tmp", file);
  rmSync(file + ".tmp");
}
console.log("android assets ok");
