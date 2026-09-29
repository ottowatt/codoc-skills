#!/usr/bin/env node

import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { parseArgs, required, integer, oneOf, noExtraPositionals } from "./lib/args.mjs";
import {
  agentHome,
  credentialCandidates,
  credentialSource,
  listAgents,
  readCredentialStore,
  rewriteCredentialStore,
  storeCredential,
  storedCredential,
  storePendingCredential,
  writeCredentialStore,
} from "./lib/credentials.mjs";
import { parseDocumentId } from "./lib/doc-id.mjs";
import { authenticatedRequest, request, requireOk, unexpectedFailure } from "./lib/http.mjs";
import { CliError, installPipeHygiene, redact, usage, writeJson } from "./lib/output.mjs";
import { normalizeBaseUrl, queryPath } from "./lib/url.mjs";

installPipeHygiene();

const DEFAULT_BASE = "https://codoc.sh";
const COMMON_FLAGS = {
  "--base": "value",
  "--compact": "boolean",
  "--timeout": "value",
  "--help": "boolean",
};

const HELP = `Usage: node skills/codoc/scripts/codoc.mjs <command> [args] --agent <name> [--base <url>] [--compact]

Commands:
  auth list                           list saved agents without keys
  auth status                         validate and describe the selected credential
  auth rename --name <n>              change this agent's display name and folder
  auth register --email <e> --name <n>  register an agent, save it under its name, and email a code
  auth verify-email --code <code>      verify the address with the stored key
  auth request-email --email <e>       resend the verification code
  auth recover --email <e> [--agent-id <id>] [--code <code>] recover an agent key
  auth rotate                          rotate and securely store the agent key
  create --title <t> --visibility <v> create a document (this route has no idempotency key)
  read <doc>                           read a document view
  find <doc> <query>...                find source targets or text evidence
  edit <doc> --base-version <n>        apply exact source patches
  write <doc> --base-version <n>       replace the whole source document
  diff <doc> --from <n>                read a bounded source or text diff
  comments <doc>                       read comment threads
  comments-batch <doc>                 apply a raw comment-operation batch
  comment <doc> --quote|--quote-file --body|--body-file  create one anchored comment
  reanchor <doc> --comment <uuid> --quote|--quote-file   re-anchor one thread
  reply <doc> --comment <uuid> --body|--body-file        create one reply
  resolve <doc> --comment <uuid>       resolve or unresolve one thread
  access <doc>                         read or change document access
  events <doc>                         perform one raw event poll
  delete <doc> --yes                   irreversibly delete a document
  llms [--section <name>]              print the live API reference or one operation block

Global flags:
  --agent <name>     the acting agent's name; required unless CODOC_API_KEY is set
  --base <url>       API origin; CODOC_BASE or https://codoc.sh by default
  --compact          print JSON on one line
  --timeout <s>      request timeout in seconds; default 30
  --help             show command-specific help
  --flag=value       use this form when a value begins with --`;

const COMMAND_HELP = {
  "auth list": `Usage: codoc.mjs auth list [--base <url>] [--compact]
  Lists saved agents with their IDs, names, emails, and origins, never their keys.
  --base <url>    only agents with a credential for this origin
  --compact       print compact JSON
  --help          show this help`,
  "auth status": `Usage: codoc.mjs auth status --agent <name> [--base <url>] [--compact] [--timeout <s>]
  --agent <name>  the agent to check
  --base <url>    select the exact credential-store entry
  --compact       print compact JSON
  --timeout <s>   request timeout; default 30
  --help          show this help`,
  "auth rename": `Usage: codoc.mjs auth rename --agent <name> --name <new-name> [--base <url>] [--compact]
  --agent <name> the agent to rename; its folder moves to match the new name
  --name <name>  new display name for the authenticated agent
  --base <url>   API origin
  --compact      print compact JSON
  --timeout <s>  request timeout; default 30
  --help         show this help`,
  "auth rotate": `Usage: codoc.mjs auth rotate --agent <name> [--base <url>] [--compact]
  --agent <name>  the agent whose key is rotated and saved
  --base <url>    API origin
  --compact       print compact JSON
  --timeout <s>   request timeout; default 30
  --help          show this help`,
  "auth register": `Usage: codoc.mjs auth register --email <address> --name <name>
  --email <address>    email address used to verify and recover this agent
  --name <name>        agent name; the key is saved in the agent folder derived from it
  --base <url>         API origin
  --help               show this help`,
  "auth verify-email": `Usage: codoc.mjs auth verify-email --agent <name> --code <code> [--email <address>]
  --agent <name>      the registered agent
  --code <code>       six-digit code sent to the registration email
  --email <address>   address used at registration, if needed
  --base <url>        API origin
  --help              show this help`,
  "auth request-email": `Usage: codoc.mjs auth request-email --agent <name> --email <address>
  --agent <name>     the registered agent
  --email <address>  registration email
  --base <url>       API origin
  --help             show this help`,
  "auth recover": `Usage: codoc.mjs auth recover --agent <name> --email <address> [--agent-id <id>] [--code <code>]
  --agent <name>     the agent folder that receives the replacement key
  --email <address>  agent's verified email
  --agent-id <id>    select the existing agent identity when needed
  --code <code>      six-digit recovery code; omit to request one
  --base <url>       API origin
  --help             show this help`,
  create: `Usage: codoc.mjs create --title <t> --visibility public|private [options]
  --title <text>         authoritative document title
  --visibility <value>   public or private (required)
  --share-with <email[:commenter|owner]>  invite a collaborator; repeatable, default commenter
  --via <text>           creation attribution
  --summary <text>       initial change summary
  --file <path>          read HTML from a file; otherwise read stdin
  --allow-empty          permit an intentionally empty document
  --base <url>           API origin
  --compact              print compact JSON
  --timeout <s>          request timeout; default 30
  --help                 show this help
  create_doc has no idempotency key; an ambiguous transport result must not be retried blindly.`,
  read: `Usage: codoc.mjs read <doc> [options]
  --view <view>      overview, source, text, or history; default overview
  --from <n>         first 1-based source line
  --to <n>           last inclusive source line
  --version <n>      retained source/text version
  --raw              print only source HTML or projected text
  --base <url>       API origin
  --compact          print compact JSON
  --timeout <s>      request timeout; default 30
  --help             show this help`,
  find: `Usage: codoc.mjs find <doc> <query> [<query>...] [options]
  --space <space>        source or text; default source
  --regex                treat every query as RE2 syntax
  --case-insensitive     source-space matching only
  --max <n>              maximum results per query; at most 50
  --base <url>           API origin
  --compact              print compact JSON
  --timeout <s>          request timeout; default 30
  --help                 show this help`,
  edit: `Usage: codoc.mjs edit <doc> --base-version <n> [options] (--patches-file <path> | patches JSON on stdin | --target <t> --replacement <r>)
  --base-version <n>       version the patches were based on
  --summary <text>         one-line change summary
  --dry-run                evaluate without persistence
  --idempotency-key <key>  reuse a mutation identity; generated when absent
  --patches-file <path>    read a JSON patch array
  --target <text>          one exact source target
  --replacement <text>     replacement paired with --target
  --replace-all            replace every target occurrence
  --base <url>             API origin
  --compact                print compact JSON
  --timeout <s>            request timeout; default 30
  --help                   show this help`,
  write: `Usage: codoc.mjs write <doc> --base-version <n> [options] [--file <path>]
  --base-version <n>       current version for compare-and-swap
  --summary <text>         one-line change summary
  --dry-run                evaluate without persistence
  --idempotency-key <key>  reuse a mutation identity; generated when absent
  --file <path>            read HTML from a file; otherwise read stdin
  --allow-empty            permit an intentionally empty document
  --base <url>             API origin
  --compact                print compact JSON
  --timeout <s>            request timeout; default 30
  --help                   show this help`,
  diff: `Usage: codoc.mjs diff <doc> --from <n> [--to <m>] [--space source|text]
  --from <n>       first version
  --to <n>         second version; current version when omitted
  --space <space>  source or text; default source
  --base <url>     API origin
  --compact        print compact JSON
  --timeout <s>    request timeout; default 30
  --help           show this help`,
  comments: `Usage: codoc.mjs comments <doc> [options]
  --view <view>            full or overview
  --ids <uuid[,uuid]>      comment IDs; repeatable and sent as repeated query keys
  --active-since <iso>     filter by latest activity
  --last-author <name>     filter by last speaker display name
  --last-author-id <uuid>  filter by last speaker account ID
  --resolved true|false    filter by resolution
  --state <state>          attached or detached
  --limit <n>              maximum threads
  --reply-limit <n>        maximum replies per thread
  --include-source         include exact source excerpts
  --base <url>             API origin
  --compact                print compact JSON
  --timeout <s>            request timeout; default 30
  --help                   show this help`,
  "comments-batch": `Usage: codoc.mjs comments-batch <doc> [options] [--file <path>]
  --base-version <n>       top-level version for reanchors
  --idempotency-key <key>  reuse a mutation identity; generated when absent
  --file <path>            read batch JSON from a file; otherwise read stdin
  --base <url>             API origin
  --compact                print compact JSON
  --timeout <s>            request timeout; default 30
  --help                   show this help`,
  comment: `Usage: codoc.mjs comment <doc> (--quote <text> | --quote-file <path>) (--body <text> | --body-file <path>) [options]
  --quote <text>           exact visible-text query
  --quote-file <path>      read the quote from a file; - reads stdin
  --body <text>            comment body
  --body-file <path>       read the body verbatim from a file; - reads stdin
  --occurrence <n>         select one match when the quote is ambiguous
  --idempotency-key <key>  reuse a mutation identity; generated when absent
  --base <url>             API origin
  --compact                print compact JSON
  --timeout <s>            request timeout; default 30
  --help                   show this help`,
  reanchor: `Usage: codoc.mjs reanchor <doc> --comment <uuid> (--quote <text> | --quote-file <path>) [options]
  --comment <uuid>         detached thread ID
  --quote <text>           exact visible-text query for the new anchor
  --quote-file <path>      read the quote from a file; - reads stdin
  --occurrence <n>         select one match when the quote is ambiguous
  --base-version <n>       document version; fetched from overview when absent
  --idempotency-key <key>  reuse a mutation identity; generated when absent
  --base <url>             API origin
  --compact                print compact JSON
  --timeout <s>            request timeout; default 30
  --help                   show this help`,
  reply: `Usage: codoc.mjs reply <doc> --comment <uuid> (--body <text> | --body-file <path>) [options]
  --comment <uuid>         thread ID
  --body <text>            reply body
  --body-file <path>       read the body verbatim from a file; - reads stdin
  --resolve                resolve the thread in the same batch
  --idempotency-key <key>  reuse a mutation identity; generated when absent
  --base <url>             API origin
  --compact                print compact JSON
  --timeout <s>            request timeout; default 30
  --help                   show this help`,
  resolve: `Usage: codoc.mjs resolve <doc> --comment <uuid> [--unresolve] [options]
  --comment <uuid>         thread ID
  --unresolve              reopen instead of resolve
  --idempotency-key <key>  reuse a mutation identity; generated when absent
  --base <url>             API origin
  --compact                print compact JSON
  --timeout <s>            request timeout; default 30
  --help                   show this help`,
  access: `Usage: codoc.mjs access <doc> [operations]
  --add <email>[:role]          add or invite owner/commenter; repeatable
  --remove <accountId>         remove a member; repeatable
  --revoke-invite <email>      revoke an invitation; repeatable
  --set-role <accountId>:<role> set owner/commenter role; repeatable
  --visibility public|private  change visibility
  --base <url>                 API origin
  --compact                    print compact JSON
  --timeout <s>                request timeout; default 30
  --help                       show this help`,
  events: `Usage: codoc.mjs events <doc> [options]
  --since now|<cursor>  attach point or returned cursor
  --wait <0-25>         long-poll seconds; default 0
  --listening           renew the listening cue
  --exclude-self        omit this account's events
  --base <url>          API origin
  --compact             print compact JSON
  --timeout <s>         request timeout; default 30
  --help                show this help`,
  delete: `Usage: codoc.mjs delete <doc> --yes
  --yes           confirm irreversible deletion
  --base <url>    API origin
  --compact       print compact JSON
  --timeout <s>   request timeout; default 30
  --help          show this help`,
  llms: `Usage: codoc.mjs llms [--section <name>] [--base <url>]
  --section <name>  print one ### operation block
  --base <url>      API origin
  --compact         accepted for consistency; raw reference text is unchanged
  --timeout <s>     request timeout; default 30
  --help            show this help`,
};

function baseAndOutput(options) {
  const raw = options.base ?? process.env.CODOC_BASE ?? DEFAULT_BASE;
  const base = normalizeBaseUrl(raw);
  const timeoutSeconds = options.timeout === undefined ? 30 : Number(options.timeout);
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) throw usage("--timeout must be positive.");
  return { base, compact: Boolean(options.compact), timeoutSeconds };
}

const AGENT_FLAG_HELP = "  --agent <name>  acting agent; required unless CODOC_API_KEY is set";
// Registration names the agent with --name, and these commands act as no agent.
const WITHOUT_AGENT = new Set(["auth register", "auth list", "llms"]);

function flagsFor(command, extra) {
  return { ...COMMON_FLAGS, ...(WITHOUT_AGENT.has(command) ? {} : { "--agent": "value" }), ...extra };
}

function showHelp(name) {
  const agentLine = COMMAND_HELP[name] && name !== "llms" && !name.startsWith("auth ") ? `${AGENT_FLAG_HELP}\n` : "";
  process.stdout.write(`${COMMAND_HELP[name] ?? HELP}\n${agentLine}`);
}

function agentFlag(source) {
  return source.agent ? ` --agent ${source.agent}` : "";
}

function agentField(source) {
  return source.agent ? { agent: source.agent } : {};
}

function statusOutput(context, via, account) {
  return { base: context.base, ...agentField(context.source), source: via, account };
}

function verificationPending(source) {
  return new CliError(3, { error: "verification_pending", message: "The agent's email is not verified yet.", hint: `run auth verify-email${agentFlag(source)} --code <code>` });
}

function parseJsonInput(filename, description) {
  let text;
  try {
    if (!filename) {
      text = fs.readFileSync(0, "utf8");
    } else {
      const stdin = process.stdin.isTTY ? "" : fs.readFileSync(0, "utf8");
      if (stdin.length > 0) throw usage(`${description} was provided by both --file and stdin.`);
      text = fs.readFileSync(filename, "utf8");
    }
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw usage(`Could not read ${description}: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw usage(`${description} must contain valid JSON.`);
  }
}

function readTextInput(filename, description) {
  try {
    if (!filename) return fs.readFileSync(0, "utf8");
    const stdin = process.stdin.isTTY ? "" : fs.readFileSync(0, "utf8");
    if (stdin.length > 0) throw usage(`${description} was provided by both --file and stdin.`);
    return fs.readFileSync(filename, "utf8");
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw usage(`Could not read ${description}: ${error.message}`);
  }
}

function resolveTextSources(options, sources) {
  const stdinSources = sources.filter(({ file }) => options[file] === "-");
  if (stdinSources.length > 1) {
    throw usage(`Only one of ${stdinSources.map(({ file }) => `--${file}`).join(" and ")} may read stdin with -.`);
  }

  const resolved = {};
  for (const { direct, file, stripTrailingNewline = false } of sources) {
    const hasDirect = options[direct] !== undefined;
    const hasFile = options[file] !== undefined;
    if (hasDirect === hasFile) {
      throw usage(`Exactly one of --${direct} or --${file} must be given.`);
    }
    if (hasDirect) {
      resolved[direct] = options[direct];
      continue;
    }
    try {
      let text = fs.readFileSync(options[file] === "-" ? 0 : options[file], "utf8");
      if (stripTrailingNewline) {
        if (text.endsWith("\r\n")) text = text.slice(0, -2);
        else if (text.endsWith("\n") || text.endsWith("\r")) text = text.slice(0, -1);
      }
      resolved[direct] = text;
    } catch (error) {
      throw usage(`Could not read --${file}: ${error.message}`);
    }
  }
  return resolved;
}

async function callAuthenticated(context, pathname, options = {}) {
  let result;
  try { result = await authenticatedRequest(
    context.base,
    credentialCandidates(context.base, context.source),
    pathname,
    { ...options, timeoutSeconds: context.timeoutSeconds },
  ); } catch (error) {
    if (error instanceof CliError && error.exitCode === 3 && storedCredential(context.base, context.source)?.pendingVerification) {
      throw verificationPending(context.source);
    }
    throw error;
  }
  return { data: requireOk(result), source: result.source };
}

function outputReceipt(data, idempotencyKey, compact) {
  writeJson({ ...data, idempotencyKey }, compact);
}

async function keyedCall(idempotencyKey, operation) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof CliError && error.exitCode === 2) {
      throw new CliError(2, { ...error.value, idempotencyKey });
    }
    throw error;
  }
}

async function finalizePendingCredential(context) {
  const pending = storedCredential(context.base, context.source)?.pendingCredential;
  if (!pending) return null;
  if (typeof pending.key !== "string" || !pending.key.startsWith("sk_agent_")) {
    throw new CliError(1, { error: "pending_credential_invalid", message: "The saved replacement key is malformed. Existing credentials were preserved." });
  }
  let result;
  try {
    result = await request(context.base, "/api/agents/me", {
      key: pending.key, timeoutSeconds: context.timeoutSeconds, sensitiveResponse: true,
    });
  } catch {
    throw new CliError(2, { error: "pending_credential_validation", message: "The replacement key was saved, but its identity could not be checked. Run auth status to finish." });
  }
  if (!result.ok) {
    throw new CliError(result.status === 401 ? 3 : 1, {
      error: "pending_credential_validation",
      message: `The replacement key was saved, but its identity check failed (HTTP ${result.status}). Run auth status to retry.`,
    });
  }
  const account = result.data;
  if (account?.kind !== "agent" || typeof account.id !== "string") {
    throw new CliError(1, { error: "invalid_response", message: "The replacement key was saved, but the identity response was invalid. Run auth status to retry." });
  }
  if (pending.expectedId && account.id !== pending.expectedId) {
    throw new CliError(1, { error: "recovery_identity_mismatch", message: "The replacement key belongs to a different agent. Existing credentials were preserved." });
  }
  const storedIn = storeCredential(context.base, { id: account.id, key: pending.key,
    email: account.email, name: account.name }, context.source.home);
  return { account, storedIn };
}

async function captureTextEvidence(context, root, quote, occurrence) {
  const found = (await callAuthenticated(context, `${root}/find`, {
    method: "POST",
    body: { maxResultsPerQuery: 50, space: "text", queries: [{ query: quote }] },
  })).data;
  const matches = found?.results?.[0]?.matches;
  if (!Array.isArray(matches) || matches.length === 0) {
    throw new CliError(1, { error: "no_match", message: "The quote was not found in document text.", quote });
  }
  if (typeof matches[0].occurrenceCount !== "number" || !Number.isFinite(matches[0].occurrenceCount)) {
    throw new CliError(1, { error: "invalid_response", message: "Find returned an invalid occurrenceCount." });
  }
  if (matches[0].occurrenceCount > 1 && occurrence === undefined) {
    throw new CliError(4, {
      error: "usage",
      message: "The quote is ambiguous; choose one candidate with --occurrence <n>.",
      occurrences: matches.map((match) => ({
        occurrence: match.occurrence,
        context: { prefix: match.context.prefix, suffix: match.context.suffix },
      })),
    });
  }
  const evidence = occurrence === undefined
    ? matches[0]
    : matches.find((match) => match.occurrence === occurrence);
  if (!evidence) throw usage(`--occurrence ${occurrence} was not returned by find.`);
  if (typeof evidence.occurrenceCount !== "number" || !Number.isFinite(evidence.occurrenceCount)) {
    throw new CliError(1, { error: "invalid_response", message: "Find returned an invalid occurrenceCount." });
  }
  return evidence;
}

function sliceLlmsSection(text, requestedHeading) {
  const headings = [...text.matchAll(/^(#{2,3})\s+(.+)$/gmu)];
  const wanted = requestedHeading.trim().toLowerCase();
  const index = headings.findIndex((match) => {
    const title = match[2].trim();
    const operation = title.match(/^(.+?)\s+—\s+[A-Z]+\s+\/\S.*$/u)?.[1];
    return (operation ?? title).toLowerCase() === wanted;
  });
  if (index < 0) throw usage(`No llms.txt section named ${requestedHeading}.`);
  const selected = headings[index];
  const level = selected[1].length;
  const next = headings.slice(index + 1).find((match) => match[1].length <= level);
  return text.slice(selected.index, next?.index ?? text.length).replace(/\n+$/u, "");
}

async function authCommand(argv) {
  const subcommand = argv[0];
  if (!subcommand || subcommand === "--help") {
    process.stdout.write(`Usage: codoc.mjs auth <list|status|rename|register|request-email|verify-email|recover|rotate> [flags]\n`);
    return;
  }
  const key = `auth ${subcommand}`;
  if (!COMMAND_HELP[key]) throw usage(`Unknown auth subcommand: ${subcommand}`);
  const extra = {
    rename: { "--name": "value" },
    register: { "--name": "value", "--email": "value" },
    "request-email": { "--email": "value" },
    "verify-email": { "--code": "value", "--email": "value" },
    recover: { "--email": "value", "--agent-id": "value", "--code": "value" },
  }[subcommand] ?? {};
  const { options, positional } = parseArgs(argv.slice(1), flagsFor(key, extra));
  if (options.help) return showHelp(key);
  noExtraPositionals(positional, 0);
  const context = baseAndOutput(options);

  if (subcommand === "list") {
    writeJson({ agents: listAgents(options.base === undefined ? undefined : context.base) }, context.compact);
    return;
  }
  if (subcommand === "register") {
    const email = required(options.email, "--email <address>");
    const name = required(options.name, "--name <name>");
    const source = credentialSource(name);
    const existing = storedCredential(context.base, source);
    if (existing?.pendingVerification) {
      throw usage(`Agent ${source.agent} is awaiting email verification. Run auth verify-email --agent ${source.agent} --code <code>.`);
    }
    if (existing) {
      throw usage(`Agent ${source.agent} already has a credential for this base URL. Run auth status --agent ${source.agent}, or register under a different name.`);
    }
    rewriteCredentialStore(source.home);
    const result = await request(context.base, "/api/agents/register", {
      method: "POST", body: { email, name },
      timeoutSeconds: context.timeoutSeconds, sensitiveResponse: true,
    });
    const value = requireOk(result);
    if (typeof value.id !== "string" || typeof value.key !== "string") {
      throw new CliError(1, { error: "invalid_response", message: "Registration response omitted its credential fields." });
    }
    let storedIn;
    try { storedIn = storeCredential(context.base, { id: value.id, key: value.key, email, name: value.name ?? name, pendingVerification: true }, source.home); }
    catch (error) { throw new CliError(1, { error: "credential_write_failed", message: "Registration succeeded but its key could not be saved. Repair local credential storage, then recover this agent with its registration email and agent ID if known. Do not register another identity.", cause: error.value ?? redact(error.message) }); }
    writeJson({ id: value.id, name: value.name, agent: source.agent, verificationSent: value.verificationSent, storedIn,
      next: value.verificationSent ? `auth verify-email --agent ${source.agent} --code <code>` : `auth request-email --agent ${source.agent} --email <registration-email>` }, context.compact);
    return;
  }

  context.source = credentialSource(options.agent);
  const { home } = context.source;

  if (subcommand === "status") {
    const resumed = await finalizePendingCredential(context);
    if (resumed) {
      writeJson(statusOutput(context, "file", resumed.account), context.compact);
      return;
    }
    let result;
    const candidates = credentialCandidates(context.base, context.source);
    try { result = await authenticatedRequest(
      context.base,
      candidates,
      "/api/agents/me",
      { timeoutSeconds: context.timeoutSeconds },
    ); } catch (error) {
      if (error instanceof CliError && error.exitCode === 3 && storedCredential(context.base, context.source)?.pendingVerification) {
        throw verificationPending(context.source);
      }
      throw error;
    }
    const account = requireOk(result);
    const stored = storedCredential(context.base, context.source);
    if (stored?.key && candidates[result.candidateIndex]?.key === stored.key &&
        account?.kind === "agent" && typeof account.id === "string" &&
        (stored.pendingVerification || !stored.idVerified || stored.id !== account.id ||
          (typeof account.email === "string" && stored.email !== account.email) ||
          (typeof account.name === "string" && stored.name !== account.name))) {
      storeCredential(context.base, { id: account.id, key: stored.key, email: account.email, name: account.name }, home);
    }
    writeJson(statusOutput(context, result.source, account), context.compact);
    return;
  }
  if (subcommand === "rename") {
    const name = required(options.name, "--name <name>");
    const target = home ? agentHome(name) : undefined;
    const moving = Boolean(target) && target !== home;
    if (moving && fs.existsSync(target)) {
      throw usage(`Another agent already uses the folder for that name (${path.basename(target)}). Choose a different name.`);
    }
    const { data } = await callAuthenticated(context, "/api/agents/me", {
      method: "PATCH", body: { name },
    });
    if (home) {
      // The server rename already happened; renaming again with the same name is safe and finishes the local update.
      try {
        const store = readCredentialStore(home);
        if (store[context.base] && typeof data?.name === "string") {
          store[context.base].name = data.name;
          writeCredentialStore(store, home);
        }
        if (moving) fs.renameSync(home, target);
      } catch (error) {
        throw new CliError(1, { error: "local_rename_incomplete",
          message: `The agent was renamed to ${JSON.stringify(data?.name ?? name)}, but its folder ${home} could not be updated: ${redact(error.message)}. Keep using --agent ${context.source.agent}, fix the cause, and run the same auth rename again to finish.` });
      }
    }
    writeJson({ ...data, ...(home ? { agent: path.basename(target) } : {}) }, context.compact);
    return;
  }
  if (subcommand === "verify-email") {
    const candidates = credentialCandidates(context.base, context.source);
    const result = await authenticatedRequest(context.base, candidates, "/api/agents/email/verify", {
      method: "POST",
      body: { code: required(options.code, "--code <code>"), ...(options.email ? { email: options.email } : {}) },
      timeoutSeconds: context.timeoutSeconds, sensitiveResponse: true,
    });
    const receipt = requireOk(result);
    const stored = storedCredential(context.base, context.source);
    if (stored?.pendingVerification && stored.id && candidates[result.candidateIndex]?.key === stored.key) {
      storeCredential(context.base, { id: stored.id, key: stored.key, email: receipt.email ?? stored.email, name: receipt.name ?? stored.name }, home);
    }
    writeJson(receipt, context.compact);
    return;
  }
  if (subcommand === "request-email") {
    const result = await authenticatedRequest(context.base, credentialCandidates(context.base, context.source), "/api/agents/email", {
      method: "POST", body: { email: required(options.email, "--email <address>") },
      timeoutSeconds: context.timeoutSeconds, sensitiveResponse: true,
    });
    requireOk(result);
    writeJson({ sent: true, next: `auth verify-email${agentFlag(context.source)} --code <code>` }, context.compact);
    return;
  }
  if (subcommand === "recover") {
    const email = required(options.email, "--email <address>");
    const stored = storedCredential(context.base, context.source);
    if (options["agent-id"] && stored?.idVerified && stored.id !== options["agent-id"]) {
      throw usage(`Agent ${context.source.agent} is ${stored.id}, not ${options["agent-id"]}. Recover another agent with its own --agent name.`);
    }
    const agentId = options["agent-id"] ?? (stored?.idVerified ? stored.id : undefined);
    if (options.code) rewriteCredentialStore(home);
    const result = await request(context.base, "/api/agents/key/recover", {
      method: "POST", body: { email, ...(agentId ? { agentId } : {}), ...(options.code ? { code: options.code } : {}) },
      timeoutSeconds: context.timeoutSeconds, sensitiveResponse: true, allowAgentSelection: Boolean(options.code),
    });
    if (result.data?.error === "agent_selection_required") {
      throw new CliError(1, { ...result.data, hint: `rerun auth recover${agentFlag(context.source)} --email <address> --agent-id <chosen-id> --code <same-code>` });
    }
    const value = requireOk(result);
    if (!options.code) {
      writeJson({
        email,
        ...(agentId ? { agentId } : {}),
        ok: value.ok,
        message: value.message,
        verification: value.verification,
        next: `auth recover${agentFlag(context.source)} --email <address>${agentId ? ` --agent-id ${agentId}` : ""} --code <code>`,
      }, context.compact);
      return;
    }
    if (typeof value.id !== "string" || typeof value.key !== "string") {
      throw new CliError(1, { error: "invalid_response", message: "Recovery response omitted its credential fields." });
    }
    let storedIn;
    try { storedIn = storePendingCredential(context.base, value.key, agentId, home); }
    catch (error) { throw new CliError(1, { error: "credential_write_failed", message: "Recovery completed but the replacement key could not be saved. Request a new code and retry.", cause: error.value ?? redact(error.message) }); }
    const finalized = await finalizePendingCredential(context);
    writeJson({ id: finalized.account.id, ...agentField(context.source), storedIn }, context.compact);
    return;
  }
  if (subcommand === "rotate") {
    rewriteCredentialStore(home);
    const current = (await callAuthenticated(context, "/api/agents/me")).data;
    if (current?.kind !== "agent" || typeof current.id !== "string") {
      throw new CliError(1, { error: "invalid_response", message: "The current agent identity could not be verified." });
    }
    const { data } = await callAuthenticated(context, "/api/agents/key/rotate", { method: "POST" });
    if (typeof data.key !== "string" || typeof data.id !== "string") {
      throw new CliError(1, { error: "invalid_response", message: "Rotation response omitted its credential fields." });
    }
    let storedIn;
    try {
      storedIn = storePendingCredential(context.base, data.key, current.id, home);
    } catch (error) {
      throw new CliError(1, {
        error: "credential_write_failed",
        message: "The key rotated but could not be stored. Use auth recover with this agent's email to recover the identity.",
        cause: error.value ?? redact(error.message),
      });
    }
    const finalized = await finalizePendingCredential(context);
    writeJson({ id: finalized.account.id, ...agentField(context.source), storedIn }, context.compact);
  }
}

function parseShareRecipient(value, flag) {
  const colon = value.lastIndexOf(":");
  if (colon < 0) return { email: value };
  const email = value.slice(0, colon);
  const role = value.slice(colon + 1);
  if (!email || !["owner", "commenter"].includes(role)) {
    throw usage(`${flag} must be <email>[:owner|commenter], not ${value}.`);
  }
  return { email, role };
}

async function documentCommand(command, argv) {
  const specs = {
    create: { "--title": "value", "--visibility": "value", "--share-with": "repeat", "--via": "value", "--summary": "value", "--file": "value", "--allow-empty": "boolean" },
    read: { "--view": "value", "--from": "value", "--to": "value", "--version": "value", "--raw": "boolean" },
    find: { "--space": "value", "--regex": "boolean", "--case-insensitive": "boolean", "--max": "value" },
    edit: { "--base-version": "value", "--summary": "value", "--dry-run": "boolean", "--idempotency-key": "value", "--patches-file": "value", "--target": "value", "--replacement": "value", "--replace-all": "boolean" },
    write: { "--base-version": "value", "--summary": "value", "--dry-run": "boolean", "--idempotency-key": "value", "--file": "value", "--allow-empty": "boolean" },
    diff: { "--from": "value", "--to": "value", "--space": "value" },
    comments: { "--view": "value", "--ids": "repeat", "--active-since": "value", "--last-author": "value", "--last-author-id": "value", "--resolved": "value", "--state": "value", "--limit": "value", "--reply-limit": "value", "--include-source": "boolean" },
    "comments-batch": { "--base-version": "value", "--idempotency-key": "value", "--file": "value" },
    comment: { "--quote": "value", "--quote-file": "value", "--body": "value", "--body-file": "value", "--occurrence": "value", "--idempotency-key": "value" },
    reanchor: { "--comment": "value", "--quote": "value", "--quote-file": "value", "--occurrence": "value", "--base-version": "value", "--idempotency-key": "value" },
    reply: { "--comment": "value", "--body": "value", "--body-file": "value", "--resolve": "boolean", "--idempotency-key": "value" },
    resolve: { "--comment": "value", "--unresolve": "boolean", "--idempotency-key": "value" },
    access: { "--add": "repeat", "--remove": "repeat", "--revoke-invite": "repeat", "--set-role": "repeat", "--visibility": "value" },
    events: { "--since": "value", "--wait": "value", "--listening": "boolean", "--exclude-self": "boolean" },
    delete: { "--yes": "boolean" },
    llms: { "--section": "value" },
  };
  const { options, positional } = parseArgs(argv, flagsFor(command, specs[command]));
  if (options.help) return showHelp(command);
  const context = baseAndOutput(options);

  if (command === "llms") {
    noExtraPositionals(positional, 0);
    const result = await request(context.base, "/llms.txt", {
      timeoutSeconds: context.timeoutSeconds,
      expectText: true,
    });
    if (!result.ok) throw new CliError(1, result.data);
    let text = result.text;
    if (options.section) text = sliceLlmsSection(text, options.section);
    process.stdout.write(`${text}${text.endsWith("\n") ? "" : "\n"}`);
    return;
  }

  context.source = credentialSource(options.agent);

  if (command === "create") {
    noExtraPositionals(positional, 0);
    const visibility = oneOf(required(options.visibility, "--visibility <public|private>"), "--visibility", ["public", "private"]);
    const html = readTextInput(options.file, "HTML input");
    if (html.length === 0 && !options["allow-empty"]) {
      throw usage("HTML input is empty; pass --allow-empty to create an empty document.");
    }
    const body = {
      html,
      title: required(options.title, "--title <text>"),
      visibility,
      ...(options["share-with"] ? { shareWith: options["share-with"].map((value) => parseShareRecipient(value, "--share-with")) } : {}),
      ...(options.via ? { via: options.via } : {}),
      ...(options.summary ? { change: { summary: options.summary } } : {}),
    };
    // Create a document: create_doc has no idempotency key, so an uncertain call is not retried.
    const { data } = await callAuthenticated(context, "/api/document", { method: "POST", body });
    writeJson(data, context.compact);
    return;
  }

  const documentId = parseDocumentId(required(positional[0], "<doc>"));
  const root = `/api/document/${documentId}`;

  if (command === "read") {
    noExtraPositionals(positional, 1);
    const view = oneOf(options.view ?? "overview", "--view", ["overview", "source", "text", "history"]);
    if (options.raw && !["source", "text"].includes(view)) throw usage("--raw is only valid with --view source or --view text.");
    const entries = [["view", view]];
    if (options.from !== undefined) entries.push(["fromLine", integer(options.from, "--from", { min: 1 })]);
    if (options.to !== undefined) entries.push(["toLine", integer(options.to, "--to", { min: 1 })]);
    if (options.version !== undefined) entries.push(["version", integer(options.version, "--version", { min: 1 })]);
    const { data } = await callAuthenticated(context, queryPath(root, entries));
    if (options.raw) {
      const raw = view === "source" ? data.html : data.text;
      if (typeof raw !== "string") {
        throw new CliError(1, { error: "invalid_response", message: `The ${view} response omitted its content string.` });
      }
      process.stdout.write(redact(raw));
    }
    else writeJson(data, context.compact);
    return;
  }

  if (command === "find") {
    if (positional.length < 2) throw usage("find requires <doc> and at least one <query>.");
    if (positional.length > 11) throw usage("find accepts at most 10 queries.");
    const space = oneOf(options.space ?? "source", "--space", ["source", "text"]);
    if (space === "text" && options["case-insensitive"]) throw usage("--case-insensitive is source-space only.");
    const queries = positional.slice(1).map((query) => ({
      query,
      ...(options.regex ? { regex: true } : {}),
      ...(options["case-insensitive"] ? { caseSensitive: false } : {}),
    }));
    const body = { space, queries, ...(options.max ? { maxResultsPerQuery: integer(options.max, "--max", { min: 1, max: 50 }) } : {}) };
    const { data } = await callAuthenticated(context, `${root}/find`, { method: "POST", body });
    writeJson(data, context.compact);
    return;
  }

  if (command === "edit") {
    noExtraPositionals(positional, 1);
    const baseVersion = integer(required(options["base-version"], "--base-version <n>"), "--base-version", { min: 1 });
    let patches;
    const single = options.target !== undefined || options.replacement !== undefined || options["replace-all"];
    if (options["patches-file"] && single) throw usage("Use either --patches-file or --target/--replacement, not both.");
    if (single) {
      patches = [{
        target: required(options.target, "--target <text>"),
        replacement: options.replacement === undefined
          ? required(options.replacement, "--replacement <text>")
          : options.replacement,
        ...(options["replace-all"] ? { replaceAll: true } : {}),
      }];
    } else {
      patches = parseJsonInput(options["patches-file"], "patches input");
      if (!Array.isArray(patches)) throw usage("Patches input must be a JSON array.");
    }
    const body = { baseVersion, patches, ...(options.summary ? { change: { summary: options.summary } } : {}), ...(options["dry-run"] ? { dryRun: true } : {}) };
    const idempotencyKey = options["idempotency-key"] ?? randomUUID();
    const { data } = await keyedCall(idempotencyKey, () => callAuthenticated(context, root, { method: "PATCH", body, idempotencyKey }));
    outputReceipt(data, idempotencyKey, context.compact);
    return;
  }

  if (command === "write") {
    noExtraPositionals(positional, 1);
    const html = readTextInput(options.file, "HTML input");
    if (html.length === 0 && !options["allow-empty"]) {
      throw usage("HTML input is empty; pass --allow-empty to write an empty document.");
    }
    const body = {
      baseVersion: integer(required(options["base-version"], "--base-version <n>"), "--base-version", { min: 1 }),
      html,
      ...(options.summary ? { change: { summary: options.summary } } : {}),
      ...(options["dry-run"] ? { dryRun: true } : {}),
    };
    const idempotencyKey = options["idempotency-key"] ?? randomUUID();
    const { data } = await keyedCall(idempotencyKey, () => callAuthenticated(context, root, { method: "PUT", body, idempotencyKey }));
    outputReceipt(data, idempotencyKey, context.compact);
    return;
  }

  if (command === "diff") {
    noExtraPositionals(positional, 1);
    const entries = [["fromVersion", integer(required(options.from, "--from <n>"), "--from", { min: 1 })]];
    if (options.to !== undefined) entries.push(["toVersion", integer(options.to, "--to", { min: 1 })]);
    if (options.space !== undefined) entries.push(["space", oneOf(options.space, "--space", ["source", "text"])]);
    const { data } = await callAuthenticated(context, queryPath(`${root}/diff`, entries));
    writeJson(data, context.compact);
    return;
  }

  if (command === "comments") {
    noExtraPositionals(positional, 1);
    const entries = [];
    if (options.view) entries.push(["view", oneOf(options.view, "--view", ["full", "overview"])]);
    if (options.ids) {
      const ids = options.ids.flatMap((value) => value.split(","));
      if (ids.some((id) => id === "")) throw usage("--ids values must contain one or more UUIDs.");
      for (const id of ids) entries.push(["commentIds", id]);
    }
    for (const [flag, query] of [["active-since", "activeSince"], ["last-author", "lastAuthor"], ["last-author-id", "lastAuthorId"], ["state", "state"]]) {
      if (options[flag] !== undefined) entries.push([query, options[flag]]);
    }
    if (options.resolved !== undefined) entries.push(["resolved", oneOf(options.resolved, "--resolved", ["true", "false"])]);
    if (options.limit !== undefined) entries.push(["limit", integer(options.limit, "--limit", { min: 1, max: 100 })]);
    if (options["reply-limit"] !== undefined) entries.push(["replyLimit", integer(options["reply-limit"], "--reply-limit", { min: 1, max: 200 })]);
    if (options["include-source"]) entries.push(["includeSource", "true"]);
    const { data } = await callAuthenticated(context, queryPath(`${root}/comments`, entries));
    writeJson(data, context.compact);
    return;
  }

  if (command === "comments-batch") {
    noExtraPositionals(positional, 1);
    let body = parseJsonInput(options.file, "comment batch input");
    if (!body || typeof body !== "object" || Array.isArray(body)) throw usage("Comment batch input must be a JSON object.");
    if (options["base-version"] !== undefined) {
      if (body.baseVersion !== undefined) throw usage("baseVersion appears in both the batch and --base-version.");
      body = { ...body, baseVersion: integer(options["base-version"], "--base-version", { min: 1 }) };
    }
    const idempotencyKey = options["idempotency-key"] ?? randomUUID();
    const { data } = await keyedCall(idempotencyKey, () => callAuthenticated(context, `${root}/comments/batch`, { method: "POST", body, idempotencyKey }));
    outputReceipt(data, idempotencyKey, context.compact);
    return;
  }

  if (command === "comment") {
    noExtraPositionals(positional, 1);
    const { quote, body: bodyText } = resolveTextSources(options, [
      { direct: "quote", file: "quote-file", stripTrailingNewline: true },
      { direct: "body", file: "body-file" },
    ]);
    const occurrence = options.occurrence === undefined ? undefined : integer(options.occurrence, "--occurrence", { min: 1 });
    const idempotencyKey = options["idempotency-key"] ?? randomUUID();
    const { data } = await keyedCall(idempotencyKey, async () => {
      const evidence = await captureTextEvidence(context, root, quote, occurrence);
      // Read and answer comments: find's text evidence crosses this boundary field-for-field.
      const item = {
        body: bodyText,
        quote: evidence.quote,
        occurrenceCount: evidence.occurrenceCount,
        ...(evidence.occurrence !== undefined ? { occurrence: evidence.occurrence } : {}),
        context: { prefix: evidence.context.prefix, suffix: evidence.context.suffix },
      };
      return callAuthenticated(context, `${root}/comments/batch`, {
        method: "POST", body: { createComments: [item] }, idempotencyKey,
      });
    });
    outputReceipt(data, idempotencyKey, context.compact);
    return;
  }

  if (command === "reanchor") {
    noExtraPositionals(positional, 1);
    const commentId = required(options.comment, "--comment <uuid>");
    const { quote } = resolveTextSources(options, [
      { direct: "quote", file: "quote-file", stripTrailingNewline: true },
    ]);
    const occurrence = options.occurrence === undefined
      ? undefined
      : integer(options.occurrence, "--occurrence", { min: 1 });
    const idempotencyKey = options["idempotency-key"] ?? randomUUID();
    const result = await keyedCall(idempotencyKey, async () => {
      const evidence = await captureTextEvidence(context, root, quote, occurrence);
      const baseVersion = options["base-version"] === undefined
        ? (await callAuthenticated(context, root)).data.version
        : integer(options["base-version"], "--base-version", { min: 1 });
      if (!Number.isSafeInteger(baseVersion) || baseVersion < 1) {
        throw new CliError(1, { error: "invalid_response", message: "Document overview omitted a valid version." });
      }
      // comments: reanchorComments receives text-space capture evidence without transformation.
      const item = {
        commentId,
        quote: evidence.quote,
        occurrenceCount: evidence.occurrenceCount,
        ...(evidence.occurrence !== undefined ? { occurrence: evidence.occurrence } : {}),
        context: { prefix: evidence.context.prefix, suffix: evidence.context.suffix },
      };
      const response = await callAuthenticated(context, `${root}/comments/batch`, {
        method: "POST",
        body: { baseVersion, reanchorComments: [item] },
        idempotencyKey,
      });
      return { ...response, baseVersion };
    });
    writeJson({ ...result.data, baseVersion: result.baseVersion, idempotencyKey }, context.compact);
    return;
  }

  if (command === "reply" || command === "resolve") {
    noExtraPositionals(positional, 1);
    const commentId = required(options.comment, "--comment <uuid>");
    const replyBody = command === "reply"
      ? resolveTextSources(options, [{ direct: "body", file: "body-file" }]).body
      : undefined;
    const body = command === "reply"
      ? {
          createReplies: [{ commentId, body: replyBody }],
          ...(options.resolve ? { setResolved: [{ commentId, resolved: true }] } : {}),
        }
      : { setResolved: [{ commentId, resolved: !options.unresolve }] };
    const idempotencyKey = options["idempotency-key"] ?? randomUUID();
    const { data } = await keyedCall(idempotencyKey, () => callAuthenticated(context, `${root}/comments/batch`, { method: "POST", body, idempotencyKey }));
    outputReceipt(data, idempotencyKey, context.compact);
    return;
  }

  if (command === "access") {
    noExtraPositionals(positional, 1);
    const hasOperations = options.add || options.remove || options["revoke-invite"] || options["set-role"] || options.visibility;
    if (!hasOperations) {
      const { data } = await callAuthenticated(context, `${root}/access`);
      writeJson(data, context.compact);
      return;
    }
    const body = {};
    if (options.add) body.addMembers = options.add.map((value) => parseShareRecipient(value, "--add"));
    if (options.remove) body.removeMembers = options.remove;
    if (options["revoke-invite"]) body.revokeInvites = options["revoke-invite"];
    if (options["set-role"]) body.setRoles = options["set-role"].map((value) => {
      const match = value.match(/^(.+):(owner|commenter)$/u);
      if (!match) throw usage(`--set-role must be <accountId>:owner|commenter, not ${value}.`);
      return { accountId: match[1], role: match[2] };
    });
    if (options.visibility) body.setVisibility = oneOf(options.visibility, "--visibility", ["public", "private"]);
    const { data } = await callAuthenticated(context, `${root}/access`, { method: "POST", body });
    writeJson(data, context.compact);
    return;
  }

  if (command === "events") {
    noExtraPositionals(positional, 1);
    const entries = [];
    if (options.since) entries.push(["since", options.since]);
    if (options.wait !== undefined) entries.push(["waitSeconds", integer(options.wait, "--wait", { min: 0, max: 25 })]);
    if (options.listening) entries.push(["listening", "true"]);
    if (options["exclude-self"]) entries.push(["excludeSelf", "true"]);
    const { data } = await callAuthenticated(context, queryPath(`${root}/events`, entries));
    writeJson(data, context.compact);
    return;
  }

  if (command === "delete") {
    noExtraPositionals(positional, 1);
    if (!options.yes) throw usage("Deletion is irreversible; pass --yes to confirm.");
    const { data } = await callAuthenticated(context, root, { method: "DELETE" });
    writeJson(data, context.compact);
  }
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  if (!command || command === "--help") {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (command === "auth") return authCommand(argv);
  if (!COMMAND_HELP[command]) throw usage(`Unknown command: ${command}`);
  return documentCommand(command, argv);
}

try {
  await main();
} catch (error) {
  const failure = error instanceof CliError
    ? error
    : unexpectedFailure(error);
  writeJson(failure.value, process.argv.includes("--compact"));
  process.exitCode = failure.exitCode;
}
