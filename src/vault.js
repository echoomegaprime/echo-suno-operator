import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, ".data");
const vaultPath = join(dataDir, "session.bin");
const hintPath = join(dataDir, "hint.txt");

function masterKey() {
  const raw = process.env.VAULT_MASTER_KEY?.trim();
  if (!raw || raw.length < 16) {
    throw new Error("Set VAULT_MASTER_KEY (16+ chars) in .env");
  }
  return scryptSync(raw, "echo-suno-operator", 32);
}

function encrypt(plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

function decrypt(buf) {
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

export async function saveCookie(cookie) {
  await mkdir(dataDir, { recursive: true });
  const trimmed = cookie.replace(/^Cookie:\s*/i, "").trim();
  if (!trimmed.includes("=")) throw new Error("That does not look like a Cookie header");
  if (trimmed.length < 40) throw new Error("Cookie too short");
  await writeFile(vaultPath, encrypt(trimmed));
  const hint = trimmed.slice(0, 12).replace(/[^=;]/g, "·") + "…" + String(trimmed.length);
  await writeFile(hintPath, hint);
  return { hint, bytes: trimmed.length };
}

export async function readCookie() {
  if (existsSync(vaultPath)) {
    return decrypt(readFileSync(vaultPath));
  }
  const env = process.env.SUNO_COOKIE?.trim();
  return env || null;
}

export async function clearCookie() {
  try {
    await unlink(vaultPath);
  } catch {}
  try {
    await unlink(hintPath);
  } catch {}
}

export function publicHint() {
  if (!existsSync(hintPath)) return null;
  return readFileSync(hintPath, "utf8").trim();
}
