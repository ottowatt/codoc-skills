import { setTimeout as sleep } from "node:timers/promises";

import { CliError, internalFailure, noCredential, redact } from "./output.mjs";

function retryDelayOverride(milliseconds) {
  const override = Number(process.env.CODOC_TEST_RETRY_DELAY_MS);
  return Number.isFinite(override) && override >= 0 ? override : milliseconds;
}

export function retryAfterMilliseconds(response, fallback = 0) {
  const raw = response.headers.get("retry-after");
  if (!raw) return fallback;
  const seconds = Number(raw);
  const milliseconds = Number.isFinite(seconds)
    ? seconds * 1000
    : Math.max(0, Date.parse(raw) - Date.now());
  if (!Number.isFinite(milliseconds)) return fallback;
  return Math.min(30_000, Math.max(0, milliseconds));
}

function finiteDelay(milliseconds, fallback) {
  const safe = Number.isFinite(milliseconds) && milliseconds >= 0 ? milliseconds : fallback;
  return Math.ceil(safe);
}

function safeToRetry(method, idempotencyKey) {
  // Errors and retries: an un-keyed mutation can have committed before its response was lost.
  return method === "GET" || Boolean(idempotencyKey);
}

function transportMessage(error) {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return "The request timed out.";
  return redact(error instanceof Error ? error.message : String(error));
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
    return { transportError: { error: "transport", message: transportMessage(error) } };
  }
  let data;
  if (options.expectText) {
    data = text;
  } else {
    try {
      data = text === "" ? {} : JSON.parse(text);
    } catch {
      const invalid = { error: "invalid_response", message: redact(`Server returned non-JSON content: ${text.slice(0, 200)}`) };
      if (response.ok) return { internalError: { ...invalid, error: "internal" } };
      data = invalid;
    }
  }
  // Keep successful credential responses intact in memory; every output/error boundary redacts.
  return { data, headers: response.headers, ok: response.ok, status: response.status, text: redact(text) };
}

export async function request(base, pathname, options = {}) {
  const method = options.method ?? "GET";
  const mayRetry = safeToRetry(method, options.idempotencyKey);
  let attempts = 0;
  while (true) {
    const result = await requestOnce(base, pathname, options);
    if (result.internalError) throw new CliError(1, result.internalError);
    if (result.transportError) {
      if (mayRetry && attempts === 0) {
        attempts += 1;
        await sleep(finiteDelay(retryDelayOverride(2000), 2000));
        continue;
      }
      throw new CliError(2, result.transportError);
    }
    if (mayRetry && attempts === 0 && (result.status === 503 || result.status === 429)) {
      attempts += 1;
      const delay = result.status === 429
        ? retryAfterMilliseconds(result, retryDelayOverride(2000))
        : retryDelayOverride(2000);
      await sleep(finiteDelay(delay, 2000));
      continue;
    }
    return result;
  }
}

export async function authenticatedRequest(base, candidates, pathname, options = {}) {
  if (candidates.length === 0) throw noCredential();
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const result = await request(base, pathname, { ...options, key: candidate.key });
    if (result.status !== 401) return { ...result, source: candidate.source, candidateIndex: index };
  }
  throw noCredential();
}

export function requireOk(result) {
  if (!result.ok) throw new CliError(1, result.data);
  return result.data;
}

export function unexpectedFailure(error) {
  return new CliError(1, internalFailure(error));
}
