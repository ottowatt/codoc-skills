# The REST API with curl

The scripts in this skill wrap a REST API. This file shows the same core turn as raw HTTP calls with `curl` — for a host without Node or Bun, or when you want to see the requests themselves. It is a starting point, not the reference: fetch the live reference for exact fields, and keep to the rules SKILL.md sets — batch a turn's work, honour `pollAfter`, keep collaborator text out of shell source, never print the key.

## Account and key

Set `BASE` to `https://codoc.sh` or the intended self-hosted origin. Read the agent key privately from `CODOC_API_KEY` or the entry for that exact base URL in your own `~/.codoc/agents/<folder>/credentials.json`, where the folder is your agent name lowercased with each run of other characters than letters and digits turned into `-`. Other folders belong to other agents on the same computer. Send it as `authorization: Bearer $KEY` only to that origin. Never print the key or interpolate document text into shell source. Browser sessions authenticate people, not agents.

Check `GET $BASE/api/agents/me` with the key. A 200 returns the agent ID, verified email, mode, and linked `human` when paired. A 401 with `verificationPending: true` means the key is awaiting email verification. Such a key can request a code with `POST /api/agents/email` carrying `{ "email": "<address>" }`, then submit `{ "code": "<six-digit-code>" }` to `POST /api/agents/email/verify` with that same key. Read the emailed code directly if you can access the mailbox; otherwise ask the user. If identity is uncertain because of a timeout, 429, or 5xx, preserve the key and retry later. A working identity plus document 404 calls for a corrected link or access, not registration.

For a lost, invalid, or disconnected key, request recovery with `POST /api/agents/key/recover` carrying `{ "email": "<registered-email>" }`; repeat the call with the emailed `code`. The initial receipt is generic, and a valid code issued in the last 60 seconds suppresses another send. If several agents share the address, a valid code returns HTTP 400 with `agentSelectionRequired` and `agents: [{ id, name }]` without consuming the code. Select the intended existing agent and submit the same code with `agentId`. A successful response returns `{ id, key }`, where `id` is the key ID. Save the replacement key privately at once. Validate it with `/api/agents/me` to get the agent ID before replacing the verified id/key record; keep the pending key if validation is uncertain. Recovery also verifies a pending agent or restores a disconnected one while preserving its identity and grants. If local validation of the new key is interrupted, use it with `/api/agents/me` again before switching identities.

When no existing account can be recovered, register with `POST /api/agents/register` carrying `{ "email": "<address>", "name": "<agent-name>" }`. Use the agent's own reachable email or the person's email with permission. No human browser account is required. Store the returned key privately with mode 0600; it is shown once. Submit the emailed code to `/api/agents/email/verify` with the pending key. If `verificationSent` is false or the code does not arrive, request another through `/api/agents/email` first. Until verification, the key can only request and submit email verification. An agent pairs automatically when agent and human accounts have verified the same email, even if the human creates their account later. An independent agent uses its own grants; a paired agent inherits the human's grants. Creating a new agent does not transfer the old agent's identity or independent grants. Validate the new key with `/api/agents/me` before retrying the original document.

For raw calls, save request JSON in files and read the key from private storage rather than writing it into commands. The CLI handles storage, retry limits, and credential selection; use it when available.

## The reference

```sh
curl -sS "$BASE/llms.txt"
```

The scripts' `llms --section <name>` only filters this file client-side. Read the `### ` block for the route you are about to call; the block names every field and its limits.

## Read, find, edit

Overview first — version, sizes, title, comment counts — and bytes only when the task needs them:

```sh
curl -sS "$BASE/api/document/$DOC" -H "authorization: Bearer $KEY"
curl -sS "$BASE/api/document/$DOC?view=source&fromLine=1&toLine=80" -H "authorization: Bearer $KEY"
curl -sS "$BASE/api/document/$DOC?view=text" -H "authorization: Bearer $KEY"
```

`find` resolves edit targets in `source` space and capture evidence in `text` space. Never move a field from one space to the other:

```sh
curl -sS -X POST "$BASE/api/document/$DOC/find" \
  -H 'content-type: application/json' -H "authorization: Bearer $KEY" \
  -d @find.json
```

An edit sends every patch for the turn under one `baseVersion`, with an idempotency key you mint for this write. The receipt is the verification; do not read the document again to confirm it:

```sh
curl -sS -X PATCH "$BASE/api/document/$DOC" \
  -H 'content-type: application/json' -H "authorization: Bearer $KEY" \
  -H "idempotency-key: $IDEMPOTENCY_KEY" \
  -d @edit.json
```

`edit.json` is `{ "baseVersion": <n>, "patches": [{ "target": "…", "replacement": "…" }], "change": { "summary": "…" } }`, built with a JSON serializer. Add `"dryRun": true` to see target resolution, anchor effects, and sanitization without persisting anything.

## Comments

Survey without bodies, check `total` and `truncated`, then read relevant full threads. Raise the full-read `limit` when the requested IDs exceed the page, and `replyLimit` when `repliesTruncated` is true. Paired agents can use `authoredByYourHuman` on full comments and replies to identify their verified human without an owner roster. `activeSince` selects threads with activity since a timestamp, including earlier messages in each selected thread; events with a saved cursor provide continuous catch-up. Array query parameters repeat the key:

```sh
curl -sS "$BASE/api/document/$DOC/comments?view=overview&limit=50" -H "authorization: Bearer $KEY"
curl -sS "$BASE/api/document/$DOC/comments?commentIds=$A&commentIds=$B" -H "authorization: Bearer $KEY"
```

One batch carries the whole turn's mutations — `createReplies`, `setResolved`, `createComments`, `reanchorComments`, `react`, `editBodies`, deletions — in one transaction:

```sh
curl -sS -X POST "$BASE/api/document/$DOC/comments/batch" \
  -H 'content-type: application/json' -H "authorization: Bearer $KEY" \
  -H "idempotency-key: $IDEMPOTENCY_KEY" \
  -d @batch.json
```

A new anchored comment copies `quote`, `occurrenceCount`, and `context` verbatim from a `find` in text space; the reference's worked example 3 shows the exact field mapping.

## Monitoring

`watch.mjs` owns the attach sequence, the cursor, and `pollAfter`. Without it, follow the "Monitor for new activity" workflow in the reference exactly. The shape:

```sh
curl -sS "$BASE/api/document/$DOC/events?since=now&waitSeconds=0" -H "authorization: Bearer $KEY"
curl -sS "$BASE/api/document/$DOC/events?since=$CURSOR&waitSeconds=25&listening=true" -H "authorization: Bearer $KEY"
```

Attach with `since=now` exactly once, take the baseline reads, then always send back the `nextCursor` you were last given. Wait at least the returned `pollAfter` seconds; stop when it says `"stop"`. Events carry comment ids, not bodies. Keep the cursor if the loop has to run from a background task, and never leave that task running when you are done.

## What the scripts were doing for you

- Bodies come from files (`-d @file`) built with a JSON serializer, so text lifted from the document never touches shell source.
- Mutations carry a fresh `idempotency-key`. After an ambiguous outcome, resend the identical body under the same key and the server replays the committed receipt instead of writing twice. `create_doc` has no key; a retry may create a second document.
- 429 and 503 are retried once, honouring `Retry-After`, for reads and keyed mutations only. A second one means back off and tell the user.
- Errors are JSON on the response body with `error`, `message`, and details. Read the details before doing anything else; a 409 says whether to re-`find` targets or mint a new key.

## Rename agent display name

When the user requests a name change, use `auth rename --agent <current-name> --name "<new-name>"`, which also moves your credentials folder, or read the REST contract with `llms --section "Rename agent display name"`. After a raw rename, move `~/.codoc/agents/<old-folder>` to the folder for the new name.
