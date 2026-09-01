# Writing a codoc document

How to write the HTML for a codoc document. Four things about codoc shape it: comments anchor to the visible text, later edits replace exact strings in the source, the page renders a sanitized version of the source, and it renders next to a comments rail that narrows the reading column. The sections below follow from those; the checklist at the end is what must hold before publishing.

## One file, HTML only

Produce one complete HTML source file. Keep document-specific CSS in a `<style>` block; remote images, fonts, and stylesheets may supplement it when the current render policy permits them. "One file" means one source of truth, not a requirement to work offline. Do not keep a parallel Markdown copy: it goes stale as soon as a comment is folded into the HTML.

The `title` passed to `create_doc` is the document's name. Editing the source `<title>` later does not rename it.

## Markup that is easy to edit later

Write unminified HTML with line breaks at element boundaries, not hard-wrapped mid-sentence. Source windows, diffs, and `edit_doc` targets then follow the document's structure instead of cutting across it.

Prefer simple semantic elements: `h1`–`h3`, `p`, `ul`, `table`, `section`, `figure`. Deeply nested wrappers make every later edit target wider than the change itself.

Repeated boilerplate is the main cause of ambiguous edit targets. If twelve sections open with the same `<div class="card"><h3>` sequence, every later edit must widen its target past that sequence to be unique. Put distinguishing content early in each section.

## Text that comments and edits can target

Two operations match on text: `edit_doc` targets match the stored source, and comment anchors match the visible text. Both need strings that occur once.

- Inline markup inside a sentence is fine. `<p>The floor is <strong>$4,200</strong> per site.</p>` anchors correctly because the visible text is still one sentence; `<strong>`, `<em>`, `<code>`, and `<a>` inside prose cause no problems. What breaks anchoring is splitting a sentence across sibling or container elements: the same words in three `<span>`s, or a clause moved into its own `<div>` or `<p>`, look the same on screen but anchor badly.
- Avoid near-duplicate sentences in different sections. If a figure appears in the executive summary and again in the sizing table, make the sentences around it different.
- Keep a number's arithmetic in the same element as the number, so one edit changes both.

## Layout next to the comments rail

The document scrolls inside the reading viewport, and comments take space from it.

- On desktop, comments open in a rail on the right and narrow the document column. On mobile they open in a bottom sheet while the referenced part of the document stays visible.
- Use responsive layout so the reading content remains usable when the rail narrows it. Fixed dimensions are fine for elements such as icons or compact controls; avoid fixed content-column widths or `min-width` values that make the document overflow. Check the design at about two-thirds of its full width.
- Put wide content (tables, code, diagrams) in its own `overflow-x: auto` container so the page body never scrolls sideways.
- Hover styles may enhance the experience, but essential content and navigation must remain available on touch devices, which have no hover state.
- `position: sticky` works well for a table of contents or section header because it remains in the document flow while staying visible during scroll. `position: fixed` is available for a banner or persistent control. A fixed element stays inside the document iframe and cannot cover Codoc's comment rail, but it can cover the document's own content; keep it compact and account for the narrower comment view.

## What HTML gives you

Use the features a word processor cannot offer. Everything here is static content or native browser behaviour, so it renders under the policy below.

- **Navigation.** A sticky table of contents (`position: sticky`) and `href="#id"` links between sections. Anchor links stay in the page; every other link opens in a new tab. `:target` styling can highlight the section a link lands on.
- **Collapsible sections.** `<details>` and `<summary>` for methodology, raw data, appendices, and per-segment detail. The summary stays short and the reader chooses how deep to go.
- **Callouts.** An `<aside>` or a styled `<div>` for a note, warning, assumption, or key takeaway, with a border or background that sets it apart from body text.
- **Layout.** CSS grid and flex for side-by-side comparisons, decision matrices, cards, and timelines, as long as they reflow at two-thirds width.
- **Tables.** Real `<table>`s with `<thead>`, a sticky header row, right-aligned numbers, and a scroll container for wide matrices.
- **Diagrams and charts.** Inline `<svg>`. It stays sharp at any size and is edited by string replacement like the rest of the document. Images can be `data:` URLs so the file stays self-contained.
- **Figures.** `<figure>` with `<figcaption>`, so a chart or table carries its own caption and source.
- **Inline semantics.** `<abbr title="…">` for abbreviations, `<dfn>` for a term where it is defined, `<code>` for identifiers, `<kbd>` for keys, `<mark>` for highlights, `<time>` for dates.
- **Pills and tags.** Small inline labels (a styled `<span>`) for status, evidence quality (verified, derived, estimated), segment names, or priority, so a reader can scan them.
- **Colour and type.** Fonts from Google Fonts. Colour that carries meaning: state, evidence quality, severity. Dark mode with `prefers-color-scheme`. A `@media print` stylesheet.

## Render policy

The reading page renders a sanitized version of the stored source. The source keeps its bytes; the rendered version drops what it will not run or load, and every write receipt reports what was removed or blocked.

| | |
|---|---|
| scripts | never run |
| images | any `https:` URL or `data:` URL |
| stylesheets | `https://fonts.googleapis.com`, `https://cdn.jsdelivr.net`, `https://cdnjs.cloudflare.com`, `https://unpkg.com` |
| fonts | `https://fonts.gstatic.com`, `https://cdn.jsdelivr.net`, `https://cdnjs.cloudflare.com`, `https://unpkg.com`, `data:` |

Everything else is dropped. Design for this: anything interactive must be native browser behaviour (`<details>`, `href="#id"` anchor links, `:target` styling) or static content. Form controls (`input`, `button`, `select`, `textarea`, `form`) are removed along with scripts, iframes, and embeds. Do not retry a blocked script with a different loader.

This table describes the current policy, not a permanent limit on what Codoc may support. The server is authoritative and the allowlist may expand. If they disagree, follow `codoc.mjs llms --section "Writing documents well"` for the live render policy, and `codoc.mjs llms --section "Reading page and comment syntax"` for what markup a comment body accepts.

Sanitization entries carry counts. One removed `<meta>` and twenty removed `<meta>` are the same entry with different counts; read the count before deciding whether a finding matters.

## Tone and content

Write for the document's purpose and the user's requested tone. When revising an existing document, prefer a coherent result over accidental draft history or commentary about the editing process. Include historical context, alternatives, and decision rationale when they help the reader; omit them when they are merely residue from producing the draft. If something looks removable but must stay, explain why so a later editor does not remove it.

When the user has not asked for another style, prefer direct claims, explicit decisions, and checkable criteria over decorative or flattering language. If the document contains an interface, use accent colour only for meaningful state, keep state visible without relying on hover alone, and use subtle backgrounds for interactive elements.

## Pre-publish checklist

- One HTML source file; document-specific CSS embedded; remote resources allowed by the current render policy.
- Unminified, with line breaks at element boundaries.
- No sentence split across elements for styling reasons.
- No repeated boilerplate that would force wide edit targets later.
- Responsive and readable at two-thirds width; no content-column constraint that forces page overflow; wide blocks scroll inside themselves.
- Essential content and navigation work without hover or scripts.
- Prose serves the document's purpose, without accidental draft residue or editing-process narration.
- After `create_doc`, read `sanitization` and `warnings` and fix anything that changes meaning, layout, or usable behaviour.
