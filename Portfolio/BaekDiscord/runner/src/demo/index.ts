/**
 * Fake runner for `npm run demo` (started by scripts/demo.mjs together with the web app).
 * DEMO_PORT: first port to try (next ones if taken). DEMO_WEB: the Next.js app to proxy.
 * Prints `DEMO_READY <port>` on stdout once listening.
 */
import { createDemoServer } from "./server.js";

const first = Number(process.env.DEMO_PORT ?? 7340);
const web = process.env.DEMO_WEB ?? "http://127.0.0.1:3000";
const demo = createDemoServer({ webProxy: web });

async function listen(): Promise<number> {
  for (let p = first; p < first + 20; p++) {
    try {
      return await demo.listen(p);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE") throw e;
    }
  }
  throw new Error(`포트 ${first}~${first + 19}가 모두 사용 중입니다. DEMO_PORT로 다른 시작 포트를 주세요.`);
}

listen()
  .then((port) => console.log(`DEMO_READY ${port}`))
  .catch((e: Error) => {
    console.error(`[demo] 시작 실패: ${e.message}`);
    process.exit(1);
  });

const stop = () => void demo.close().finally(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
