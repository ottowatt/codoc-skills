const SECRET_PATTERN = /sk_agent_\S+/gu;

export class CliError extends Error {
  constructor(exitCode, value) {
    super(redact(typeof value?.message === "string" ? value.message : "codoc command failed"));
    this.name = "CliError";
    this.exitCode = exitCode;
    this.value = sanitize(value);
  }
}

export function redact(value) {
  return String(value).replaceAll(SECRET_PATTERN, "[REDACTED]");
}

export function sanitize(value) {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [redact(key), sanitize(item)]));
  }
  return value;
}

export function jsonText(value, compact = false) {
  return JSON.stringify(sanitize(value), null, compact ? 0 : 2);
}

export function writeJson(value, compact = false) {
  process.stdout.write(`${jsonText(value, compact)}\n`);
}

export function writeJsonLine(value) {
  process.stdout.write(`${jsonText(value, true)}\n`);
}

export function diagnostic(message) {
  process.stderr.write(`${redact(message)}\n`);
}

export function usage(message, hint) {
  return new CliError(4, {
    error: "usage",
    message,
    ...(hint ? { hint } : {}),
  });
}

export function noCredential() {
  return new CliError(3, {
    error: "no_credential",
    message: "No valid codoc credential was found for this base URL.",
    hint: "check the name with auth list; for an existing agent with a lost key or disconnected pairing, run auth recover --agent <name> --email <address> [--agent-id <id>]; otherwise run auth register --email <address> --name <agent-name>",
  });
}

export function internalFailure(error) {
  return {
    error: "internal",
    message: redact(error instanceof Error ? error.message : String(error)),
  };
}

export function installPipeHygiene() {
  const stop = (error) => {
    if (!error || error.code === "EPIPE") process.exit(0);
    process.exit(1);
  };
  process.stdout.on("error", stop);
  process.stdout.on("close", () => process.exit(0));
}
