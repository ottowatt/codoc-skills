# Writing a market-research document

A market-research document on codoc is read by people who will check it. A reader who disagrees will anchor a comment to the exact sentence and ask where the number came from. Write for that reader.

Read `document.md` first for the HTML. This file covers the content.

## Body and comments

The body is the deliverable. The comment threads are the discussion. Keep them separate.

The body states final positions. It contains no Q&A with the reader, no revision history ("corrected", "revised after review", "updated to reflect feedback"), and no commentary about its own wording. A reader arriving a month later should not be able to tell which paragraphs were disputed.

Questions, challenges, and answers go in comment threads. When a thread settles, update the body as a plain statement, not as a note that something changed, and reply in the thread saying what the body now says. Resolve the thread only when it is finished.

## Positions belong to the company

Positions belong to the company, not to a person. Write "the company declines contracts below $5,000 in annual value", using the company's name where that reads better. Do not write "the founder decided" or "the head of sales thinks". No named individual holds a position in the body.

Anything shared with you as private context (personal financial targets, exit plans, risk appetite, an internal disagreement) stays out of the document. Many people read these documents, and context given to you privately is not for them. Leave it in the conversation where it was given.

## Methodology

Describe method only where it helps the reader judge the evidence. "The three national competitors publish list pricing; the independent operators were priced from bids on twelve comparable contracts" tells the reader how much to trust the range, so it belongs. How a forum was browsed, which searches were run, or how many sources were discarded does not. The test: would the reader's confidence in a number change if the sentence were removed?

## Numbers

Every derived figure shows its arithmetic inline, in the same sentence or table cell:

> 1.2–4% × ~$180M SAM ⇒ $2.2–7.2M/yr

The reader must never have to reconstruct what was multiplied. If the chain has more than one step, show the intermediate value.

- Define trade jargon at first use, "CAM (Common Area Maintenance)", and then use one term for one thing.
- State bounds plainly: floor, ceiling, and what each rests on. No rhetorical questions about uncertainty and no hedging that leaves the reader unable to act. For example: "Floor $2.2M assumes 1.2% capture, the rate observed for single-crew entrants in comparable metros; ceiling $7.2M assumes 4%, which no entrant in this set has sustained past its third year."
- Label evidence quality where it varies (verified, derived, estimated), and use each label consistently.
- Every figure must agree everywhere it appears. When changing a number, find its other occurrences (executive summary, funnel, tables, risk section) and change all of them in the same edit. This is the most common defect reviewers find.

## Segmentation

Do not put unlike businesses in one segment because they sell adjacent things. A national franchise selling nightly cleaning through a call centre and a four-crew independent operator bidding on local RFPs are not one segment, and reviewers will challenge a segmentation that combines them.

Name the axes of every segmentation (contract size, service model, channel, geography) and be able to justify each boundary. If you cannot say why the line is at $5,000 rather than $2,500, it is not yet a finding.

## Tactical decisions

A settled tactical decision gets one line stating the decision, not a paragraph of deliberation. "Crews are scheduled one site per night and never split across sites" is enough. The reasoning belongs in a comment thread if someone asks, or nowhere.

## Verdicts

State the verdict, then the evidence it rests on, then what would overturn it. The verdict follows from the evidence, not from what the reader hopes to hear: agreeing with the reader is not a finding, and neither is softening an unwelcome conclusion. Include the condition that would falsify it, "this fails if contract renewal at twelve months is below 60%", so the reader knows what to watch.

## Sections

1. **The question.** What decision this document informs, in one or two sentences.
2. **Market definition and sizing.** What is counted and what is not, then TAM/SAM/SOM with the arithmetic shown at each step.
3. **Segmentation.** The named axes, the segments they produce, and which segments are in scope.
4. **Competitive set.** Who occupies each in-scope segment, on comparable dimensions: pricing, service model, channel, response time. A table is better than prose here.
5. **Demand evidence.** What buyers actually do: search volume, bid and quote requests, published contract awards, verbatim quotes with source links. Never present a paraphrase as a quote, and never invent a quote.
6. **Verdict and what would change it.** The conclusion, the falsifying conditions, and the thresholds worth monitoring.
7. **Sources.** Linked, and specific enough to re-check.

Change the order when the material requires it, but every item must appear somewhere.

## Pre-publish checklist

Read the body once against this list before publishing, and before an edit that closes a review round:

- **Dialogue residue.** "you asked", "as noted above in response to", rhetorical questions, second person addressing a reviewer.
- **History residue.** "revised", "corrected", "previously", "in the earlier draft", "now updated".
- **Personal names and private context.** Any individual holding a position, any personal target or constraint shared in conversation.
- **Unshown arithmetic.** A derived figure without its inputs visible.
- **Inconsistent figures.** Search for each headline number and confirm every occurrence matches.
- **Undefined jargon.** A trade term used before it is defined.
- **Unsupported segmentation.** A segment boundary with no stated axis.
