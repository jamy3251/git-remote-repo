import { loadConfig } from "./config.js";
import { createRunnerServer } from "./server.js";
import { presetInfos } from "./presets.js";
import { languageInfos } from "./compiler/languages.js";

const cfg = loadConfig();
const runner = createRunnerServer(cfg);

runner.listen().then((port) => {
  const log = (m: string) => console.log(`[devhub-runner] ${m}`);
  log(`listening on http://${cfg.host}:${port}  (API under /runner, dashboard proxied from ${cfg.webProxy ?? "off"})`);
  log(`cwd root: ${cfg.cwdRoot}`);
  log(`token: ${cfg.token}`);
  log(`dashboard: http://127.0.0.1:${port}${cfg.dashboardPath}#rt=${cfg.token}`);
  log(`presets: ${presetInfos().map((p) => `${p.id}${p.available ? "" : "(x)"}`).join(", ")}`);
  log(`languages: ${languageInfos().map((l) => `${l.id}${l.available ? "" : "(x)"}`).join(", ")}`);
  const sup = runner.supervisor.config();
  log(`supervisor: ${sup.enabled ? "on" : "off"}, default policy ${sup.defaultPolicy}, brain ${sup.brain}${sup.brainModel ? ` (${sup.brainModel})` : ""}, notify ${sup.notifyWebhook ? "webhook" : "off"}`);
  const t = runner.tunnel.status();
  log(`tunnel providers: ngrok ${t.available.ngrok ? "ok" : "missing"}, cloudflared ${t.available.cloudflared ? "ok" : "missing"}`);
  if (process.env.RUNNER_TUNNEL === "1") void runner.tunnel.start();
});

const shutdown = () => {
  console.log("[devhub-runner] shutting down");
  runner.close().finally(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
