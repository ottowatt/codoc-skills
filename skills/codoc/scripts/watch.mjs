#!/usr/bin/env node

import { setTimeout as sleep } from "node:timers/promises";

import { parseArgs, required, number, oneOf, noExtraPositionals } from "./lib/args.mjs";
import {
  credentialCandidates,
  readWatchState,
  writeWatchState,
} from "./lib/credentials.mjs";
import { parseDocumentId } from "./lib/doc-id.mjs";
import { requestOnce, retryAfterMilliseconds } from "./lib/http.mjs";
import {
  CliError,
  diagnostic,
  internalFailure,
  installPipeHygiene,
  noCredential,
  usage,
  writeJsonLine,
} from "./lib/output.mjs";
import { normalizeBaseUrl, queryPath } from "./lib/url.mjs";

installPipeHygiene();

const HELP = `Usage: node skills/codoc/scripts/watch.mjs <doc> [options]

  --mode long|poll    long-poll or periodic transport; default long
  --follow            continue after events instead of once semantics
  --interval <s>      poll-mode interval; default 10 seconds
  --include-self      include this agent's own events
  --no-hydrate        do not fetch named comment threads
  --max-seconds <n>   stop after this many elapsed seconds
  --fresh             ignore saved cursor and perform a new attach
  --base <url>        API origin; CODOC_BASE or https://codoc.sh by default
  --compact           accepted for consistency; JSON Lines are always compact
  --help              show this help`;

const FLAGS = {
  "--mode": "value",
  "--follow": "boolean",
  "--interval": "value",
  "--include-self": "boolean",
  "--no-hydrate": "boolean",
  "--max-seconds": "value",
  "--fresh": "boolean",
  "--base": "value",
  "--compact": "boolean",
  "--help": "boolean",
};

class WatchExit extends Error {
  constructor(exitCode, error) {
    super(error?.message ?? "watch stopped");
    this.exitCode = exitCode;
    this.error = error;
  }
}

function parseOptions(argv) {
  const { options, positional } = parseArgs(argv, FLAGS);
  if (options.help) return { help: true };
  noExtraPositionals(positional, 1);
  const documentId = parseDocumentId(required(positional[0], "<doc>"));
  const rawBase = options.base ?? process.env.CODOC_BASE ?? "https://codoc.sh";
  return {
    base: normalizeBaseUrl(rawBase),
    documentId,
    follow: Boolean(options.follow),
    fresh: Boolean(options.fresh),
    hydrate: !options["no-hydrate"],
    excludeSelf: !options["include-self"],
    mode: oneOf(options.mode ?? "long", "--mode", ["long", "poll"]),
    interval: options.interval === undefined ? 10 : number(options.interval, "--interval", { min: 0 }),
    maxSeconds: options["max-seconds"] === undefined
      ? undefined
      : number(options["max-seconds"], "--max-seconds", { min: 0 }),
  };
}

function testBackoff(milliseconds) {
  const override = Number(process.env.CODOC_TEST_WATCH_BACKOFF_MS);
  return Number.isFinite(override) && override >= 0 ? override : milliseconds;
}

async function interruptibleSleep(milliseconds, control, fallbackMilliseconds = 5000) {
  const safe = Number.isFinite(milliseconds) && milliseconds >= 0
    ? milliseconds
    : fallbackMilliseconds;
  if (safe <= 0) return;
  try {
    await sleep(Math.ceil(safe), undefined, { signal: control.signal });
  } catch (error) {
    if (!control.signal.aborted) throw error;
  }
}

function remainingSeconds(startedAt, maximum) {
  if (maximum === undefined) return undefined;
  return maximum - (Date.now() - startedAt) / 1000;
}

function exitCodeFor(status) {
  if (status === 401) return 3;
  return 1;
}

async function runWatcher(options) {
  const candidates = credentialCandidates(options.base);
  if (candidates.length === 0) throw noCredential();
  const root = `/api/document/${options.documentId}`;
  const control = new AbortController();
  const startedAt = Date.now();
  let selectedCredential = 0;
  let cursor = null;
  let signalExit;
  let backoffMilliseconds = testBackoff(5000);

  const onSignal = (exitCode) => {
    signalExit = exitCode;
    control.abort();
  };
  process.once("SIGINT", () => onSignal(130));
  process.once("SIGTERM", () => onSignal(143));

  const save = () => {
    if (cursor) writeWatchState(options.base, options.documentId, cursor);
  };
  const emitExit = (reason, error) => {
    save();
    writeJsonLine({ type: "exit", reason, cursor, ...(error ? { error } : {}) });
  };
  const checkTermination = () => {
    if (signalExit) {
      emitExit("signal");
      return signalExit;
    }
    const remaining = remainingSeconds(startedAt, options.maxSeconds);
    if (remaining !== undefined && remaining <= 0) {
      emitExit("max-seconds");
      return 0;
    }
    return undefined;
  };

  const longPollWaitSeconds = () => {
    if (options.mode !== "long") return 0;
    const remaining = remainingSeconds(startedAt, options.maxSeconds);
    // Monitor for new activity: leave budget for the held response and local termination.
    return remaining === undefined
      ? 25
      : Math.min(25, Math.max(0, Math.floor(remaining) - 1));
  };

  const sleepWithinBudget = async (milliseconds, fallbackMilliseconds = 5000) => {
    const finite = Number.isFinite(milliseconds) && milliseconds >= 0
      ? milliseconds
      : fallbackMilliseconds;
    const remaining = remainingSeconds(startedAt, options.maxSeconds);
    const allowed = remaining === undefined
      ? finite
      : Math.min(finite, Math.max(0, remaining * 1000));
    await interruptibleSleep(allowed, control, fallbackMilliseconds);
  };

  async function authenticatedOnce(pathname, requestOptions = {}) {
    const order = [selectedCredential, ...candidates.map((_, index) => index).filter((index) => index !== selectedCredential)];
    let unauthorized;
    for (const index of order) {
      const result = await requestOnce(options.base, pathname, {
        ...requestOptions,
        key: candidates[index].key,
        timeoutSeconds: requestOptions.timeoutSeconds ?? 10,
        signal: control.signal,
      });
      if (result.transportError) return result;
      if (result.status !== 401) {
        selectedCredential = index;
        return result;
      }
      unauthorized = result;
    }
    throw new WatchExit(3, unauthorized.data);
  }

  async function resilientRequest(pathname, requestOptions = {}, { allowStale = false } = {}) {
    while (true) {
      const terminated = checkTermination();
      if (terminated !== undefined) return { terminated };
      const result = await authenticatedOnce(pathname, requestOptions);
      if (signalExit) return { terminated: checkTermination() };
      if (result.internalError) throw new WatchExit(1, result.internalError);
      if (result.transportError || result.status === 429 || result.status === 503) {
        const terminated = checkTermination();
        if (terminated !== undefined) return { terminated };
        const waitMilliseconds = result.transportError
          ? backoffMilliseconds
          : retryAfterMilliseconds(result, backoffMilliseconds);
        writeJsonLine({
          type: "notice",
          message: result.transportError?.message ?? `HTTP ${result.status}; retrying the same cursor.`,
          retryIn: waitMilliseconds / 1000,
        });
        await sleepWithinBudget(waitMilliseconds, backoffMilliseconds);
        backoffMilliseconds = Math.min(testBackoff(60_000), Math.max(testBackoff(5000), backoffMilliseconds * 2));
        continue;
      }
      backoffMilliseconds = testBackoff(5000);
      if (!result.ok) {
        if (allowStale && result.status === 400) return { stale: true, result };
        throw new WatchExit(exitCodeFor(result.status), result.data);
      }
      return { result };
    }
  }

  async function hydrateAndEmit(events) {
    let byId = new Map();
    if (options.hydrate) {
      const ids = [...new Set(events.map((event) => event.commentId).filter((id) => typeof id === "string"))];
      for (let offset = 0; offset < ids.length; offset += 50) {
        const batch = ids.slice(offset, offset + 50);
        const path = queryPath(`${root}/comments`, [
          ["view", "full"],
          ["limit", batch.length],
          ...batch.map((id) => ["commentIds", id]),
        ]);
        const fetched = await resilientRequest(path);
        if (fetched.terminated !== undefined) return fetched.terminated;
        for (const thread of fetched.result.data.threads ?? []) byId.set(thread.id, thread);
      }
    }
    for (const event of events) {
      const threads = options.hydrate && event.commentId && byId.has(event.commentId)
        ? [byId.get(event.commentId)]
        : [];
      writeJsonLine({ type: "event", event, ...(options.hydrate && event.commentId ? { threads } : {}) });
    }
    return undefined;
  }

  async function acceptPage(page) {
    const termination = await hydrateAndEmit(Array.isArray(page.events) ? page.events : []);
    if (termination !== undefined) return termination;
    if (typeof page.nextCursor === "string") {
      cursor = page.nextCursor;
    } else {
      writeJsonLine({ type: "notice", message: "Event response omitted nextCursor; retaining the previous cursor.", retryIn: 0 });
    }
    save();
    return undefined;
  }

  async function baseline() {
    const overviewRead = await resilientRequest(queryPath(root, [["view", "overview"]]));
    if (overviewRead.terminated !== undefined) return overviewRead.terminated;
    // This comments overview is part of the attach sequence per llms.txt, not a data source.
    const commentsRead = await resilientRequest(queryPath(`${root}/comments`, [["view", "overview"]]));
    if (commentsRead.terminated !== undefined) return commentsRead.terminated;
    const overview = overviewRead.result.data;
    writeJsonLine({
      type: "baseline",
      version: overview.version,
      title: overview.title,
      comments: overview.comments ?? {
        total: commentsRead.result.data.total,
        returned: commentsRead.result.data.returned,
        truncated: commentsRead.result.data.truncated,
      },
      cursor,
    });
    return undefined;
  }

  function eventPath(since, waitSeconds, listening) {
    return queryPath(`${root}/events`, [
      ["since", since],
      ["waitSeconds", waitSeconds],
      ...(listening ? [["listening", "true"]] : []),
      ...(options.excludeSelf ? [["excludeSelf", "true"]] : []),
    ]);
  }

  async function waitAfter(page) {
    if (page.pollAfter === "stop") return "stop";
    const floor = typeof page.pollAfter === "number" ? page.pollAfter : 0;
    const seconds = options.mode === "poll" ? Math.max(floor, options.interval) : floor;
    // Events: 15 polls/min at the 4s floor plus attach baselines and ≤2 hydration reads/page stays under 120/min.
    await sleepWithinBudget(seconds * 1000);
    return undefined;
  }

  try {
    let page;
    const saved = options.fresh ? undefined : readWatchState(options.base, options.documentId);
    if (saved) {
      cursor = saved.cursor;
      writeJsonLine({ type: "resume", cursor });
      const waitSeconds = longPollWaitSeconds();
      const resumed = await resilientRequest(
        eventPath(cursor, waitSeconds, true),
        { timeoutSeconds: waitSeconds + 10 },
        { allowStale: true },
      );
      if (resumed.terminated !== undefined) return resumed.terminated;
      if (!resumed.stale) {
        page = resumed.result.data;
        const stopped = await acceptPage(page);
        if (stopped !== undefined) return stopped;
        if ((page.events?.length ?? 0) > 0 && !options.follow) {
          emitExit("event");
          return 0;
        }
        if (page.pollAfter === "stop") {
          emitExit("stop");
          return 0;
        }
      } else {
        diagnostic("Saved event cursor was refused; performing a fresh attach.");
        cursor = null;
        page = undefined;
      }
    }

    if (!page) {
      // events / Monitor for new activity: attach first, baseline second, then continue only from nextCursor.
      const attached = await resilientRequest(eventPath("now", 0, false));
      if (attached.terminated !== undefined) return attached.terminated;
      page = attached.result.data;
      const attachEvents = Array.isArray(page.events) ? page.events : [];
      const hydrated = await hydrateAndEmit(attachEvents);
      if (hydrated !== undefined) return hydrated;
      if (typeof page.nextCursor === "string") {
        cursor = page.nextCursor;
      } else {
        writeJsonLine({ type: "notice", message: "Attach response omitted nextCursor; retaining the previous cursor.", retryIn: 0 });
      }
      const based = await baseline();
      if (based !== undefined) return based;
      save();
      if (attachEvents.length > 0 && !options.follow) {
        emitExit("event");
        return 0;
      }
      if (page.pollAfter === "stop") {
        emitExit("stop");
        return 0;
      }
    }

    while (true) {
      const terminated = checkTermination();
      if (terminated !== undefined) return terminated;
      const waitReason = await waitAfter(page);
      if (waitReason === "stop") {
        emitExit("stop");
        return 0;
      }
      const afterWait = checkTermination();
      if (afterWait !== undefined) return afterWait;
      const waitSeconds = longPollWaitSeconds();
      const polled = await resilientRequest(
        eventPath(cursor, waitSeconds, true),
        { timeoutSeconds: waitSeconds + 10 },
      );
      if (polled.terminated !== undefined) return polled.terminated;
      page = polled.result.data;
      const accepted = await acceptPage(page);
      if (accepted !== undefined) return accepted;
      if ((page.events?.length ?? 0) > 0 && !options.follow) {
        emitExit("event");
        return 0;
      }
      if (page.pollAfter === "stop") {
        emitExit("stop");
        return 0;
      }
    }
  } catch (error) {
    if (error instanceof WatchExit) {
      emitExit("error", error.error);
      return error.exitCode;
    }
    if (error instanceof CliError) throw error;
    emitExit("error", internalFailure(error));
    return 1;
  }
}

try {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
  } else {
    process.exitCode = await runWatcher(options);
  }
} catch (error) {
  const failure = error instanceof CliError
    ? error
    : new CliError(1, internalFailure(error));
  writeJsonLine({
    type: "exit",
    reason: failure.exitCode === 4 ? "usage" : "error",
    cursor: null,
    error: failure.value,
  });
  process.exitCode = failure.exitCode;
}
