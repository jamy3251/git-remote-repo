import { loadConfig } from "./config.js";
import { createRunnerServer } from "./server.js";
import { presetInfos } from "./presets.js";
import { languageInfos } from "./compiler/languages.js";

const cfg = loadConfig();
const runner = createRunnerServer(cfg);

runner.listen().then((port) => {
  console.log(`[devhub-runner] listening on http://${cfg.host}:${port}`);
  console.log(`[devhub-runner] cwd root: ${cfg.cwdRoot}`);
  console.log(`[devhub-runner] token: ${cfg.token}`);
  console.log(`[devhub-runner] presets: ${presetInfos().map((p) => `${p.id}${p.available ? "" : "(x)"}`).join(", ")}`);
  console.log(`[devhub-runner] languages: ${languageInfos().map((l) => `${l.id}${l.available ? "" : "(x)"}`).join(", ")}`);
});

const shutdown = () => {
  console.log("[devhub-runner] shutting down");
  runner.close().finally(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
