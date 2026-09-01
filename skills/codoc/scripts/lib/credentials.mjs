import fs from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { CliError, redact } from "./output.mjs";

export function codocHome(env = process.env) {
  return env.CODOC_HOME || path.join(os.homedir(), ".codoc");
}

export function credentialsPath(env = process.env) {
  return path.join(codocHome(env), "credentials.json");
}

export function readCredentialStore(env = process.env) {
  const filename = credentialsPath(env);
  let contents;
  try {
    contents = fs.readFileSync(filename, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw unreadableCredentialStore(filename, error);
  }
  try {
    const parsed = JSON.parse(contents);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("the top-level value is not an object");
    }
    return parsed;
  } catch (error) {
    throw unreadableCredentialStore(filename, error);
  }
}

function unreadableCredentialStore(filename, error) {
  return new CliError(1, {
    error: "credentials_unreadable",
    message: `Could not read credentials at ${filename}: ${redact(error.message)}. Repair or move the file before continuing.`,
  });
}

function validKey(value) {
  return typeof value === "string" && value.startsWith("sk_agent_");
}

export function credentialCandidates(base, env = process.env) {
  const candidates = [];
  // Account setup and credential handling: environment precedence is part of the wire workflow.
  if (validKey(env.CODOC_API_KEY)) candidates.push({ key: env.CODOC_API_KEY, source: "env" });
  const entry = readCredentialStore(env)[base];
  if (entry && validKey(entry.key) && !candidates.some(({ key }) => key === entry.key)) {
    candidates.push({ key: entry.key, source: "file" });
  }
  return candidates;
}

export function fileCredential(base, env = process.env) {
  const entry = readCredentialStore(env)[base];
  return entry && validKey(entry.key) ? { key: entry.key, source: "file" } : undefined;
}

export function writeCredentialStore(store, env = process.env) {
  const directory = codocHome(env);
  const filename = credentialsPath(env);
  const temporary = `${filename}.tmp-${randomUUID()}`;
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(directory, 0o700);
    fs.writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, filename);
    fs.chmodSync(filename, 0o600);
    return filename;
  } catch (error) {
    try {
      fs.unlinkSync(temporary);
    } catch {
      // A failed atomic write may never make cleanup more important than the original error.
    }
    throw new CliError(1, {
      error: "credential_write_failed",
      message: `Could not write credentials at ${filename}: ${redact(error.message)}.`,
    });
  }
}

export function rewriteCredentialStore(env = process.env) {
  return writeCredentialStore(readCredentialStore(env), env);
}

export function storeCredential(base, credential, env = process.env) {
  const store = readCredentialStore(env);
  store[base] = { id: credential.id, key: credential.key };
  // Account setup and credential handling: rename makes a crash preserve the old complete store.
  return writeCredentialStore(store, env);
}

export function watchStatePath(documentId, env = process.env) {
  return path.join(codocHome(env), "state", "watch", `${documentId}.json`);
}

export function readWatchState(base, documentId, env = process.env) {
  try {
    const value = JSON.parse(fs.readFileSync(watchStatePath(documentId, env), "utf8"));
    return value?.base === base && value?.documentId === documentId && typeof value?.cursor === "string"
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

export function writeWatchState(base, documentId, cursor, env = process.env) {
  if (typeof cursor !== "string" || cursor.length === 0) return;
  const filename = watchStatePath(documentId, env);
  const directory = path.dirname(filename);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  fs.writeFileSync(
    filename,
    `${JSON.stringify({ base, documentId, cursor, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    { mode: 0o600 },
  );
  fs.chmodSync(filename, 0o600);
}
