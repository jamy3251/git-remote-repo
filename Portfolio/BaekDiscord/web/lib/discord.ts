import type { DiscordEmbed } from "./digest/render";

export class WebhookInvalidError extends Error {
  constructor(public readonly status: number) {
    super(`discord webhook rejected (${status})`);
    this.name = "WebhookInvalidError";
  }
}

export class WebhookRequestError extends Error {
  constructor(public readonly status: number, body: string) {
    super(`discord webhook failed (${status}): ${body.slice(0, 200)}`);
    this.name = "WebhookRequestError";
  }
}

export type FetchLike = typeof fetch;

export function isDiscordWebhookUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      (u.hostname === "discord.com" || u.hostname === "discordapp.com" || u.hostname === "ptb.discord.com" || u.hostname === "canary.discord.com") &&
      /^\/api\/webhooks\/\d+\/[\w-]+$/.test(u.pathname)
    );
  } catch {
    return false;
  }
}

async function check(res: Response): Promise<void> {
  if (res.ok) return;
  if (res.status === 401 || res.status === 404) throw new WebhookInvalidError(res.status);
  throw new WebhookRequestError(res.status, await res.text().catch(() => ""));
}

/** POST an embed; returns the created message id (uses ?wait=true). */
export async function postWebhook(url: string, embed: DiscordEmbed, fetchImpl: FetchLike = fetch): Promise<string> {
  const res = await fetchImpl(`${url}?wait=true`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ embeds: [embed] }),
  });
  await check(res);
  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new WebhookRequestError(res.status, "no message id in response");
  return json.id;
}

/** PATCH an existing webhook message in place. */
export async function patchWebhookMessage(
  url: string,
  messageId: string,
  embed: DiscordEmbed,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const res = await fetchImpl(`${url}/messages/${messageId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ embeds: [embed] }),
  });
  await check(res);
}

/** Validation message sent when a lead enters a webhook URL. */
export async function sendTestMessage(url: string, teamName: string, fetchImpl: FetchLike = fetch): Promise<void> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      content: `✅ DevHub 연결 확인: **${teamName}** 채널에 매일 21:00 다이제스트가 올라옵니다.`,
    }),
  });
  await check(res);
}
