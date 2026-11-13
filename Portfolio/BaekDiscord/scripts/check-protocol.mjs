#!/usr/bin/env node
// runner/src/protocol.ts and web/lib/runner/protocol.ts are hand-kept copies until the protocol
// package exists. Fails when they differ (line endings ignored).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const a = "runner/src/protocol.ts";
const b = "web/lib/runner/protocol.ts";
const read = (p) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const la = read(a).split("\n");
const lb = read(b).split("\n");

const n = Math.max(la.length, lb.length);
for (let i = 0; i < n; i++) {
  if (la[i] !== lb[i]) {
    console.error(`프로토콜 사본이 다릅니다: ${a}:${i + 1} 과 ${b}:${i + 1}`);
    console.error(`  ${a}: ${la[i] ?? "(끝)"}`);
    console.error(`  ${b}: ${lb[i] ?? "(끝)"}`);
    console.error("고치는 법: 한쪽을 고쳤다면 같은 내용을 다른 쪽에도 복사하세요.");
    process.exit(1);
  }
}
console.log(`프로토콜 사본 일치 (${la.length}줄)`);
