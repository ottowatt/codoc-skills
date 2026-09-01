# Changelog

## 0.1.0 — 2026-09-01

- First release of the `codoc` skill: publish an HTML document on codoc.sh, hand over its `/d/<id>` URL, read the comments that come back, edit, reply, and watch for new activity.
- Two zero-dependency Node scripts — `codoc.mjs`, the CLI that owns the API transport and the `~/.codoc/credentials.json` key, and `watch.mjs`, which either exits on the first activity or streams JSON Lines with `--follow`.
- Writing guides under `references/writing/` — `document.md` for HTML craft on the reading page, `market-research.md` as the first per-kind guide.
- `references/rest-api.md` — the core turn as raw `curl` calls, for hosts without Node or Bun.
