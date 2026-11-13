import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** AES-256-GCM for at-rest secrets (team webhook URL). Key derived from TEAM_WEBHOOK_ENC_KEY (falls back to AUTH_SECRET). */
function key(): Buffer {
  const raw = process.env.TEAM_WEBHOOK_ENC_KEY ?? process.env.AUTH_SECRET ?? "dev-insecure-key";
  return createHash("sha256").update(raw).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

export function decryptSecret(token: string): string {
  const [v, ivB, tagB, encB] = token.split(".");
  if (v !== "v1" || !ivB || !tagB || !encB) throw new Error("bad ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encB, "base64url")), decipher.final()]).toString("utf8");
}

export function newId(prefix = ""): string {
  const id = randomBytes(10).toString("base64url");
  return prefix ? `${prefix}_${id}` : id;
}
