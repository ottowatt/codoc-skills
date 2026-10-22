import { setTimeout as sleep } from "node:timers/promises";

import { CliError, credentialRefused, diagnostic, internalFailure, noCredential, redact } from "./output.mjs";

const MAX_TIMER_MS = 2 ** 31 - 1;
const MAX_AUTOMATIC_RETRY_MS = 60_000;

function retryDelayOverride(milliseconds) {
  const override = Number(process.env.CODOC_TEST_RETRY_DELAY_MS);
  return Number.isFinite(override) && override >= 0 ? override : milliseconds;
}

export function retryAfterMilliseconds(response, fallback = 0) {
  const raw = response.headers.get("retry-after");
  if (!raw) return finiteDelay(fallback, 0);
  const seconds = Number(raw);
  const milliseconds = Number.isFinite(seconds)
    ? seconds * 1000
    : Math.max(0, Date.parse(raw) - Date.now());
  return finiteDelay(milliseconds, fallback);
}

function finiteDelay(milliseconds, fallback) {
  const safe = Number.isNaN(milliseconds) ? fallback : milliseconds;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.ceil(safe)));
}

// Node turns an overflowing timer into a 1ms wait. Split long delays instead of
// retrying before the server permits; each chunk remains cancellable.
export async function interruptibleSleep(milliseconds, signal) {
  let remaining = finiteDelay(milliseconds, 0);
  while (remaining > 0) {
    const chunk = Math.min(remaining, MAX_TIMER_MS);
    await sleep(chunk, undefined, { signal });
    remaining -= chunk;
  }
  signal?.throwIfAborted();
}

async function waitBeforeRetry(result, milliseconds, options) {
  const delay = finiteDelay(retryDelayOverride(milliseconds), 2000);
  reportRetry(result, delay, true);
  try {
    await interruptibleSleep(delay, options.signal);
  } catch (error) {
    throw new CliError(2, { error: "transport", message: transportMessage(error, options.signal) });
  }
}

function reportRetry(result, milliseconds, waiting) {
  const code = typeof result.data?.error === "string" ? ` (${result.data.error})` : "";
  const message = typeof result.data?.message === "string" ? `: ${result.data.message}` : "";
  const failure = result.transportError?.message ?? `HTTP ${result.status}${code}${message}`;
  const requested = result.headers?.get("retry-after");
  const action = waiting
    ? `Waiting ${milliseconds / 1000} seconds before retrying. Press Ctrl+C to cancel.`
    : `Requested wait of ${milliseconds / 1000} seconds exceeds the ${MAX_AUTOMATIC_RETRY_MS / 1000}-second automatic retry limit; returning the error without retrying.`;
  diagnostic(`${failure}\n${requested ? `Server Retry-After: ${requested}. ` : ""}${action}`);
}

function safeToRetry(method, idempotencyKey) {
  // Errors and retries: an un-keyed mutation can have committed before its response was lost.
  return method === "GET" || Boolean(idempotencyKey);
}

function transportMessage(error, signal) {
  if (signal?.aborted) return "The request was cancelled.";
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return "The request timed out.";
  return redact(error instanceof Error ? error.message : String(error));
}

function safeAgentSelection(data) {
  if (data?.error !== "invalid_request" || data.agentSelectionRequired !== true || !Array.isArray(data.agents)) return null;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
  if (data.agents.length < 2) return null;
  const agents = data.agents.map((agent) => ({ id: agent?.id, name: agent?.name }));
  if (!agents.every((agent) => typeof agent.id === "string" && uuid.test(agent.id) && typeof agent.name === "string" && agent.name.length <= 200)) return null;
  return { error: "agent_selection_required", message: "Several agents use this email. Choose the existing identity by id and retry with the same code.", agents };
}

export async function requestOnce(base, pathname, options = {}) {
  const method = options.method ?? "GET";
  const headers = {};
  if (options.key) headers.authorization = `Bearer ${options.key}`;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
  const encodedBody = options.body === undefined ? undefined : JSON.stringify(options.body);
  const timeoutSignal = AbortSignal.timeout(Math.ceil(Math.max(1, (options.timeoutSeconds ?? 30) * 1000)));
  const signal = options.signal ? AbortSignal.any([timeoutSignal, options.signal]) : timeoutSignal;
  let response;
  let text;
  try {
    response = await fetch(`${base}${pathname}`, {
      method,
      headers,
      body: encodedBody,
      signal,
    });
    text = await response.text();
  } catch (error) {
    return {
      transportError: {
        error: "transport",
        message: options.sensitiveResponse ? "The credential request could not be completed." : transportMessage(error, options.signal),
      },
    };
  }
  let data;
  if (options.expectText) {
    data = text;
  } else {
    try {
      data = text === "" ? {} : JSON.parse(text);
    } catch {
      const invalid = {
        error: "invalid_response",
        message: options.sensitiveResponse
          ? "The credential server returned an invalid response."
          : redact(`Server returned non-JSON content: ${text.slice(0, 200)}`),
      };
      if (response.ok) return { internalError: { ...invalid, error: "internal" } };
      data = invalid;
    }
  }
  if (options.sensitiveResponse && !response.ok) {
    data = options.allowAgentSelection && response.status === 400 && safeAgentSelection(data)
      || { error: "credential_request_failed", message: `Credential request failed (HTTP ${response.status}).` };
  }
  // Keep successful credential responses intact in memory; every output/error boundary redacts.
  return { data, headers: response.headers, ok: response.ok, status: response.status, text: options.sensitiveResponse ? "" : redact(text) };
}

export async function request(base, pathname, options = {}) {
  const method = options.method ?? "GET";
  const mayRetry = safeToRetry(method, options.idempotencyKey);
  let attempts = 0;
  while (true) {
    const result = await requestOnce(base, pathname, options);
    if (result.internalError) throw new CliError(1, result.internalError);
    if (result.transportError) {
      if (mayRetry && attempts === 0 && !options.signal?.aborted) {
        attempts += 1;
        await waitBeforeRetry(result, 2000, options);
        continue;
      }
      throw new CliError(2, result.transportError);
    }
    if (mayRetry && attempts === 0 && (result.status === 503 || result.status === 429)) {
      const delay = retryAfterMilliseconds(result, 2000);
      if (delay > MAX_AUTOMATIC_RETRY_MS) {
        reportRetry(result, delay, false);
        const data = result.data && typeof result.data === "object" && !Array.isArray(result.data)
          ? result.data
          : { error: result.status === 429 ? "rate_limited" : "service_unavailable", message: `HTTP ${result.status}` };
        return { ...result, data: { ...data, retryAfterSeconds: Math.ceil(delay / 1000) } };
      }
      attempts += 1;
      await waitBeforeRetry(result, delay, options);
      continue;
    }
    return result;
  }
}

// `agent` and `pendingVerification` only shape the refusal when every candidate key is refused.
export async function authenticatedRequest(base, candidates, pathname, options = {}) {
  const { agent, pendingVerification, ...requestOptions } = options;
  if (candidates.length === 0) throw noCredential();
  let refused;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const result = await request(base, pathname, { ...requestOptions, key: candidate.key });
    if (result.status !== 401) return { ...result, source: candidate.source, candidateIndex: index };
    refused = result;
  }
  throw credentialRefused({ agent, pending: pendingVerification || refused.data?.verificationPending === true });
}

export function requireOk(result) {
  if (!result.ok) throw new CliError(1, result.data);
  return result.data;
}

export function unexpectedFailure(error) {
  return new CliError(1, internalFailure(error));
}
