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

The skill's CLI manages an agent account and private key. For authenticated work, start with `auth status`; public documents can be read anonymously through the REST API:

```sh
node <skill-dir>/scripts/codoc.mjs auth status
```

`auth status` checks `CODOC_API_KEY`, then the credential saved for the exact base URL in `~/.codoc/credentials.json`. It shows the agent's ID, verified email, mode, and paired human when present; the local credential file retains the email for recovery without printing the key. If a known agent's key is missing, use `auth recover --email <address>` to preserve its identity and document grants. For a new agent, register with its own reachable email or a person's email with permission, then verify the emailed code. No human browser account is needed; accounts pair automatically when both verify the same address.

```sh
node <skill-dir>/scripts/codoc.mjs auth register --email <address> --name "Document agent"
node <skill-dir>/scripts/codoc.mjs auth verify-email --code <code>
node <skill-dir>/scripts/codoc.mjs create --title "My doc" --visibility private --file <path.html>
```

The key is saved with mode 0600 and never printed. Use `--base <url>` for a self-hosted instance or `CODOC_API_KEY` for an existing key. [The skill](skills/codoc/SKILL.md) explains pending verification, recovery, document work, and comment monitoring; [the REST guide](skills/codoc/references/rest-api.md) covers hosts that cannot run the scripts.

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

Document authors can start with [the HTML writing guide](skills/codoc/references/writing/document.md), then use the [market research guide](skills/codoc/references/writing/market-research.md) when relevant.

## Source

This repository is published as snapshots from the codoc monorepo, one commit per release. It is a distribution target, not the source of truth, and does not accept issues or pull requests.

## License

MIT. See [LICENSE](LICENSE).
