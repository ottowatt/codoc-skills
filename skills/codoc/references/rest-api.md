# The REST API with curl

The scripts in this skill wrap a REST API. This file shows the same core turn as raw HTTP calls with `curl` — for a host without Node or Bun, or when you want to see the requests themselves. It is a starting point, not the reference: fetch the live reference for exact fields, and keep to the rules SKILL.md sets — batch a turn's work, honour `pollAfter`, keep collaborator text out of shell source, never print the key.

## Base URL and key

```sh
BASE=https://codoc.sh            # or a self-hosted base URL
KEY="$CODOC_API_KEY"             # else the "key" under the exact $BASE entry of ~/.codoc/credentials.json
```

Every authenticated call sends `authorization: Bearer $KEY`. Refer to the key as `$KEY` in commands and never paste its value anywhere — not in a command, a file, the conversation, or memory. Read the credentials file with a JSON parser, not by printing it.

```sh
curl -sS -o /dev/null -w '%{http_code}\n' "$BASE/api/agents/me" -H "authorization: Bearer $KEY"
```

`200` is a working credential, `401` is not one. Anything else — a timeout, a 429, a 5xx — is uncertain and is not a reason to register. Registration itself, including how to capture the one-time key without printing it, is spelled out under "Account setup and credential handling" in the reference.

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

Survey without bodies, then read only the threads you will act on. Array query parameters repeat the key:

```sh
curl -sS "$BASE/api/document/$DOC/comments?view=overview&limit=50" -H "authorization: Bearer $KEY"
curl -sS "$BASE/api/document/$DOC/comments?commentIds=$A&commentIds=$B" -H "authorization: Bearer $KEY"
curl -sS "$BASE/api/document/$DOC/access" -H "authorization: Bearer $KEY"
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
