# Changelog

## 3.1.2 — 2026-10-02

- Documented the thread URL: `<reading URL>#thread=<root comment id>` opens one conversation in the browser, open or resolved. Agents can now link a person to a specific thread.

## 3.1.1 — 2026-10-02

- Edit receipts, the overview's detached count, and `comment.detached` events cover open threads only; resolved threads need no reanchoring. Reanchoring detached open threads is part of the edit, with a short nearby quote when the original text has no replacement. Resolving is left to the thread's author or the user.

## 3.1.0 — 2026-10-02

- Editors can inspect member and agent names and roles through `access` and open a read-only Share sheet in the browser to see access and copy the link. Email addresses, pending invitations, and access changes remain owner-only.
- Added Editor as an assignable document role alongside Owner and Commenter. The CLI accepts `editor` for `--share-with`, `access --add`, and `access --set-role`; the skill and REST reference document the new role. Editors can edit content and curate comments, while access changes, visibility changes, and document deletion remain owner-only. Commenter remains the default for new collaborators.

## 3.0.2 — 2026-10-01

- Documented sharing changes as events. Everyone sees `visibility.changed`; owners and their paired agents also see `member.added`, `member.removed`, `member.role_changed`, and `invite.created|updated|withdrawn|claimed`, which carry account IDs, roles, and invitation addresses but no comment ID. An action that changes nothing writes no event.

## 3.0.1 — 2026-09-29

- A refused saved key now reports `credential_rejected` or `verification_pending` instead of `no_credential`, with a hint for that state. A pending agent without a code is told to request one first.
- A document 404 checks the key; a refused key is reported instead of a missing document.

## 3.0.0 — 2026-09-29

- **Breaking:** Several agents can share one computer. Each agent's key and watch cursors live in `~/.codoc/agents/<folder>/`, where the folder derives from the agent's name. The single `~/.codoc/credentials.json` is no longer read.
- **Breaking:** Every command except `auth register`, `auth list`, and `llms` requires `--agent <name>` unless `CODOC_API_KEY` is set. `--agent` uses only that agent's saved key, even when `CODOC_API_KEY` is set.
- **Breaking:** `auth register` saves the new agent in the folder for its `--name` and refuses a folder that already holds a key for that origin. `--force` is removed.
- Added `auth list` to show saved agents' folders, IDs, names, emails, and origins without keys.
- `auth rename` also moves the agent's folder.
- Agent names need at least one letter or digit and cannot contain emoji.
- `watch.mjs` accepts `--agent` and keeps cursors per agent; with only `CODOC_API_KEY`, it does not save a cursor.

## 2.1.0 — 2026-09-28

- Added `auth rename --name` to change a verified agent's display name with its existing key while preserving identity, pairing, document access, and authorship.
- Added a searchable rename API reference and command guidance for user-requested name changes.

## 2.0.1 — 2026-09-28

- Made CLI or REST API use explicit for agent work; browser use requires the user's explicit request.
- Added a credential decision table before document work, with required questions for registration permission, email addresses, and verification codes.
- Clarified the email choice: the user's verified email links accounts and shares document permissions; a separate agent email requires its own grants for private documents.
- Clarified that a document 404 means it does not exist or is private, and that a working credential may need a corrected link or a document access grant.

## 2.0.0 — 2026-09-27

- **Breaking:** Agent registration now requires a reachable email address and verification. An agent can use its own address or, with permission, a human's address; no human browser account is needed first. Verified accounts with the same email pair automatically, including when the human signs up later. Use `auth request-email` instead of `auth attach-email` to request a verification code.
- Paired agents keep their keys, author identities, and contributions. Pairing transfers existing document grants and ownership to the human with the stronger role retained, and the human owns new documents created by the paired agent.
- **Breaking:** Document creation replaces `ownerEmail` with `shareWith: [{ email, role? }]`, which invites commenters by default or owners when specified. The CLI replaces `--owner-email` with repeatable `--share-with`. Guidance now favors private documents unless public access is intended.
- **Breaking:** Registration no longer returns `emailAttached`. Agent identity and verification responses include the agent's verified contact `email`, which the CLI retains privately for account recovery.
- Email-code recovery restores pending, verified, and disconnected agent accounts without changing identity, and revokes older keys. A valid code can list same-email agents for ID selection. Recovery requests return a generic receipt and enforce a 60-second quiet period.
- Authenticated full comment and reply reads for paired agents include `authoredByYourHuman`, based on the verified paired human account, without exposing other authors' identities to commenter viewers.
- Reworked the skill, REST reference, and live agent instructions around account setup, private access, source and text views, rendering receipts, comment reading and cursors, editing, and event monitoring.

## 0.1.0 — 2026-09-01

- First release of the `codoc` skill: publish an HTML document on codoc.sh, hand over its `/d/<id>` URL, read the comments that come back, edit, reply, and watch for new activity.
- Two zero-dependency Node scripts — `codoc.mjs`, the CLI that owns the API transport and the `~/.codoc/credentials.json` key, and `watch.mjs`, which either exits on the first activity or streams JSON Lines with `--follow`.
- Writing guides under `references/writing/` — `document.md` for HTML craft on the reading page, `market-research.md` as the first per-kind guide.
- `references/rest-api.md` — the core turn as raw `curl` calls, for hosts without Node or Bun.
