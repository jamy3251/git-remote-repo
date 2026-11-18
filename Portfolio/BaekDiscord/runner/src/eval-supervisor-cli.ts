/** Entry for `npm run eval:supervisor`; the logic and exit codes are in supervisor/eval.ts. */
import { main } from "./supervisor/eval.js";

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    console.error(`eval:supervisor 실패: ${(e as Error).message}`);
    process.exitCode = 1;
  },
);
