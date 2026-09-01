# codoc-skills

An [Agent Skill](https://agentskills.io/specification) for [codoc](https://codoc.sh), a shared document surface for people and their agents. It lets an agent hand you documents instead of terminal output: it publishes a plan, report, or write-up as a web page, you read and comment in the browser, and it answers, revises, and keeps watching for your next comment.

The skill teaches an agent to publish a document, hand over its `/d/<id>` URL, read the comments that come back, edit the document, reply, and watch the document for new activity. It ships two zero-dependency Node scripts that own the API transport, and writing guides for particular kinds of documents.

## Install

**Claude Code**

```sh
claude plugin marketplace add ottowatt/codoc-skills
claude plugin install codoc@codoc-skills
```

**Supported agents** — Claude Code, Codex, Cursor, Gemini CLI, and Copilot all read the same skill directory:

```sh
npx skills add ottowatt/codoc-skills
```

**Gemini CLI**

```sh
gemini skills install https://github.com/ottowatt/codoc-skills
```

**Codex CLI** — clone into `~/.agents/skills/codoc`:

```sh
git clone https://github.com/ottowatt/codoc-skills /tmp/codoc-skills
mkdir -p ~/.agents/skills
cp -R /tmp/codoc-skills/skills/codoc ~/.agents/skills/codoc
```

**Manual** — copy `skills/codoc` into your agent's skills directory.

## First run

```sh
node <skill-dir>/scripts/codoc.mjs auth status
```

Exit 3 means there is no credential yet. Register one — supply a recovery email dedicated to the agent account, because without one a lost key loses the account:

```sh
node <skill-dir>/scripts/codoc.mjs auth register --name "Document agent" --email you+agent@example.com
node <skill-dir>/scripts/codoc.mjs auth verify-email --code <code from that inbox>
```

The address is attached only once the code is submitted — until then `auth status` shows it as `pendingEmail`, and `auth attach-email --email <address>` restarts verification.

The key is stored in `~/.codoc/credentials.json` (mode 0600) and is never printed. Set `CODOC_API_KEY` to override it, `CODOC_BASE` to point at a self-hosted instance.

## Monitoring

`watch.mjs <doc>` exits as soon as something happens — for harnesses that block on a command, or that wake the agent when a background command exits.

`watch.mjs <doc> --follow` streams JSON Lines until the server says stop — for harnesses that can stream a background process's stdout as events. Add `--mode poll` when a 25-second held request will not survive the network in between.

## Requirements

Node 20 or newer, or Bun. No dependencies — the scripts use built-in `fetch`, `node:fs`, and `node:crypto`, so `npx skills add` copies them onto machines that never run `npm install`.

## Layout

```
skills/codoc/
├── SKILL.md
├── scripts/
│   ├── codoc.mjs             # the CLI
│   ├── watch.mjs             # the monitor
│   └── lib/
└── references/
    ├── rest-api.md           # the same turn as raw curl calls
    └── writing/
        ├── document.md           # HTML craft for the reading page
        └── market-research.md    # one guide per kind of document
```

A writing guide for a new kind of document is one file in `skills/codoc/references/writing/` plus a row in the table under "Writing a document" in `SKILL.md`.

## Source

This repository is published as snapshots from the codoc monorepo, one commit per release. It is a distribution target, not the source of truth, and does not accept issues or pull requests.

## License

MIT. See [LICENSE](LICENSE).
