/** Entry for `npm run eval:supervisor`; the logic and exit codes are in supervisor/eval.ts. */
import { main } from "./supervisor/eval.js";

process.exitCode = main(process.argv.slice(2));
