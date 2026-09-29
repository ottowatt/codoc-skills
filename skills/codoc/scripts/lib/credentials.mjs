import fs from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { CliError, redact, usage } from "./output.mjs";

/*
 * One folder per agent keeps each agent's keys and watch cursors apart:
 *
 *   $CODOC_HOME (default ~/.codoc)
 *   └── agents/
 *       ├── claude/        ← --agent Claude
 *       │   ├── credentials.json   { "<origin>": { id, key, name, email, ... } }
 *       │   └── state/watch/<doc>.json
 *       └── research-bot/  ← --agent "Research Bot"
 *
 * The credential source is resolved once per command: --agent, then CODOC_API_KEY
 * (key only, nothing saved locally).
 */

export function codocRoot(env = process.env) {
  return env.CODOC_HOME || path.join(os.homedir(), ".codoc");
}

export function agentsDirectory(env = process.env) {
  return path.join(codocRoot(env), "agents");
}

// Folder names derive from display names, so an agent finds its folder by the name it goes by.
// 60 characters of at most 4 UTF-8 bytes each stay under the common 255-byte file-name limit.
const FOLDER_NAME_CHARACTERS = 60;

export function agentFolderName(name) {
  const folder = Array.from(String(name).normalize("NFC").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, ""))
    .slice(0, FOLDER_NAME_CHARACTERS).join("")
    .replace(/-+$/u, "");
  if (!folder) throw usage(`The agent name ${JSON.stringify(String(name))} needs at least one letter or digit.`);
  return folder;
}


export function agentHome(name, env = process.env) {
  return path.join(agentsDirectory(env), agentFolderName(name));
}

export function credentialSource(agentName, env = process.env) {
  if (agentName !== undefined) {
    const agent = agentFolderName(agentName);
    return { agent, home: path.join(agentsDirectory(env), agent) };
  }
  if (validKey(env.CODOC_API_KEY)) return { envKey: env.CODOC_API_KEY };
  throw new CliError(4, {
    error: "agent_required",
    message: "Pass --agent <name> to choose which agent acts.",
    agents: listAgents(undefined, env).map(({ agent }) => agent),
    hint: "run auth list to see saved agents, or auth register --email <address> --name <agent-name> to create one",
  });
}

export function credentialsPath(home) {
  return path.join(home, "credentials.json");
}

export function readCredentialStore(home) {
  if (!home) return {};
  const filename = credentialsPath(home);
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

export function storedCredential(base, source) {
  return readCredentialStore(source.home)[base];
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

export function credentialCandidates(base, source) {
  if (source.envKey) return [{ key: source.envKey, source: "env" }];
  const entry = storedCredential(base, source);
  return entry && validKey(entry.key) ? [{ key: entry.key, source: "file" }] : [];
}

// Return only identity metadata, so discovery never exposes keys.
export function listAgents(base, env = process.env) {
  const directory = agentsDirectory(env);
  let folders;
  try {
    folders = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw unreadableCredentialStore(directory, error);
  }
  return folders
    .filter((folder) => folder.isDirectory())
    .map((folder) => folder.name)
    .sort()
    .map((agent) => {
      const home = path.join(directory, agent);
      const credentials = Object.entries(readCredentialStore(home))
        .filter(([origin]) => !base || origin === base)
        .map(([origin, entry]) => ({
          base: origin,
          ...(typeof entry?.id === "string" ? { id: entry.id } : {}),
          ...(typeof entry?.name === "string" ? { name: entry.name } : {}),
          ...(typeof entry?.email === "string" ? { email: entry.email } : {}),
          pendingVerification: Boolean(entry?.pendingVerification),
        }));
      return { agent, storedIn: credentialsPath(home), credentials };
    })
    .filter(({ credentials }) => !base || credentials.length > 0);
}

function requireHome(home) {
  if (!home) throw usage("This command saves a key; pass --agent <name> to choose where it is stored.");
  return home;
}

export function writeCredentialStore(store, home) {
  const directory = requireHome(home);
  const filename = credentialsPath(directory);
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

export function rewriteCredentialStore(home) {
  return writeCredentialStore(readCredentialStore(requireHome(home)), home);
}

export function storeCredential(base, credential, home) {
  const store = readCredentialStore(requireHome(home));
  const sameAgent = store[base]?.id === credential.id;
  const email = credential.email ?? (sameAgent ? store[base]?.email : undefined);
  const name = credential.name ?? (sameAgent ? store[base]?.name : undefined);
  store[base] = { id: credential.id, key: credential.key, idVerified: true,
    ...(email ? { email } : {}),
    ...(name ? { name } : {}),
    ...(credential.pendingVerification ? { pendingVerification: true } : {}) };
  // Credentials and account responses: rename makes a crash preserve the old complete store.
  return writeCredentialStore(store, home);
}

export function storePendingCredential(base, key, expectedId, home) {
  const store = readCredentialStore(requireHome(home));
  store[base] = {
    ...(store[base] ?? {}),
    pendingCredential: { key, ...(expectedId ? { expectedId } : {}) },
  };
  return writeCredentialStore(store, home);
}

export function watchStatePath(documentId, home) {
  return path.join(home, "state", "watch", `${documentId}.json`);
}

// Without an agent folder (CODOC_API_KEY only) there is nowhere private to keep a cursor.
export function readWatchState(base, documentId, home) {
  if (!home) return undefined;
  try {
    const value = JSON.parse(fs.readFileSync(watchStatePath(documentId, home), "utf8"));
    return value?.base === base && value?.documentId === documentId && typeof value?.cursor === "string"
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

export function writeWatchState(base, documentId, cursor, home) {
  if (!home || typeof cursor !== "string" || cursor.length === 0) return;
  const filename = watchStatePath(documentId, home);
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
