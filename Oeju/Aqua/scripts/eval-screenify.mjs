// 평가용: 모니터에 띄운 영상을 폰으로 찍은 것처럼 사진을 망가뜨린다.
//   node scripts/eval-screenify.mjs <원본 폴더> <출력 폴더>
// 흐림, 대비·채도 저하, 푸른 색 틀어짐, 화면 줄무늬(모아레), 반사광, 모니터 테두리
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const [src, out] = process.argv.slice(2);
await mkdir(out, { recursive: true });

for (const f of (await readdir(src)).filter((n) => /\.(jpe?g|png)$/i.test(n))) {
  const base = await sharp(join(src, f)).rotate().resize({ width: 560 }).toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = base.info;
  const lines = Array.from({ length: Math.ceil(h / 3) }, (_, i) => `<rect y="${i * 3}" width="${w}" height="1" fill="#000" opacity="0.18"/>`).join("");
  const overlay = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <defs><radialGradient id="g" cx="0.7" cy="0.2" r="0.6"><stop offset="0" stop-color="#fff" stop-opacity="0.35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
      ${lines}<rect width="${w}" height="${h}" fill="url(#g)"/></svg>`,
  );
  const screen = await sharp(base.data)
    .blur(1.1)
    .modulate({ saturation: 0.75, brightness: 0.92 })
    .tint({ r: 200, g: 220, b: 255 })
    .linear(0.8, 20)
    .composite([{ input: overlay }])
    .toBuffer();
  // 모니터 테두리와 방 배경: 화면이 전체의 약 80%
  const pad = Math.round(w * 0.1);
  await sharp(screen)
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: "#16181c" })
    .jpeg({ quality: 70 })
    .toFile(join(out, f));
}
console.log("done");
