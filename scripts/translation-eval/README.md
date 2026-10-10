# Synthetic translation transport evaluation

Evaluation-only Node.js 24 harness. No runtime imports this directory. The source loader strips TypeScript from the
actual recognition and transport modules, removes the single database import, and replaces it with a throwing stub.
It records source hashes and fails closed if that isolation seam changes. It never starts the translation worker.

```sh
node --test scripts/translation-eval/adapter.test.mjs
node scripts/translation-eval/run.mjs
node scripts/translation-eval/run.mjs --azure --output test-results/translation-initial.json
node scripts/translation-eval/run.mjs --azure --cases quantity,unit-price --repeats 2 --output test-results/translation-repeat.json
```

The default run is offline transport plumbing, **not** a simulated semantic evaluation. Azure is explicit opt-in.
The original 16 Stage 3 sources remain unchanged. Five focused 2026-10-10 cases add Bank Slot Token singular/plural,
explicit Guild/group membership, subscription/banking negatives and composition with mod lists and typed links.
Their source-echo tests establish restoration contracts only; no new Azure or bilingual evidence accompanies them.
Only the fixed synthetic corpus is accepted; there is no arbitrary-text, database, history, or requeue input.
The configured key is read internally from `AZURE_TRANSLATOR_KEY_FILE` or the ignored local config key file.
Optional `AZURE_TRANSLATOR_REGION` and `AZURE_TRANSLATOR_ENDPOINT` select the same service settings as the worker.
Never commit credentials or full environment files. Results default to ignored `test-results/` and contain synthetic
provider observations, request text, detection, both returned targets, source hashes, and separate structural/semantic
records. They are dated evidence, never stable expected translation snapshots.

N uses the actual current document builder and strict result parser. H changes only complete recognized numeric
GP/SC/AP/EP/XP/HP occurrences into escaped source-visible `<span id="amount-N">…</span>` elements. Their child text
can translate but is discarded after validation; the exact source amount is restored by occurrence ID. Bare units,
mod titles/list bodies, glossary terms, names, URLs, versions, code and typed links retain their numeric opaque markers.
H deliberately retains N's HTML fragment shape to avoid adding a root-element confound. It accepts only its generated
canonical span grammar, text children, safe entities and exactly-once IDs; nesting, extra attributes, new markup,
altered IDs and excessive output fail closed. Whole-span reordering is allowed. Provider HTML is never rendered.
This narrow grammar may reject otherwise benign HTML spelling differences; do not widen it to salvage observations.

Both arms omit `from`, request `en` and `zh-Hans`, and inspect both returned targets, including the source variant
production would omit. Existing English-detection gating selects curated Chinese restoration. Requests are sequential,
at least one second apart, with a ten-second timeout through body consumption, and no hidden retries. A request/envelope failure saves progress and stops the experiment. At most three
runs per selected case are allowed. Repeated runs alternate arm order. Identical N/H inputs are deliberate controls.

Review `semantic` independently of `structure` for each target: mark faithful, ambiguous, failed, or unassessable;
record failures under price, quantity, negation, action, deadline, mixed-language, or eligibility. Check amounts and
units in surrounding prose too, each versus total, exactly/at-least/all, buy/sell/open objects and order, prohibition,
until/before/after boundaries, membership threshold, and mixed-language completeness. Exact marker restoration is
not semantic success. Structural rejections are unpublishable, but raw meaning can still be reviewed separately.
Repeat apparent improvements and regressions in both arms; compare outputs and detection across repetitions before
recommending a candidate. A bilingual agent review is not an independent bilingual review or a population error rate.

Billing exposure can be compared via submitted Unicode code-point counts × two targets. These are input-size
proxies, not an invoice or a measured monetary price; the harness does not query subscription pricing. Latency includes
local pacing and is diagnostic only. Do not infer a benchmark from these small sequential samples.

## Recorded experiment

[2026-10-09 evidence](observations/2026-10-09.json) retains all 96 successful requests and 192 returned targets,
including raw provider text, exact reconstruction, per-target semantic assessments and source hashes. It is synthetic
public evaluation evidence, not a test fixture that promises identical Azure output. No-go: repeated-links H returned
raw `8<span id="amount-1">万金币</span>` on all three runs.
The raw split means 80,000 GP; replacing only the span with the full source `80k GP` leaves `8` + `80k GP`, creating
`880k GP`. This is a restoration-boundary regression, not evidence that Azure invented an extra digit in the raw
price. Structural success coexists with a wrong reconstructed price.

```sh
node scripts/translation-eval/inspect.mjs
```

This offline replay checks recorded structural claims against the actual source parser and source hashes, reports
repeat variability and explicit review coverage, and prints the recorded recommendation. It does not infer sentence
meaning from structure or turn past provider observations into expected future translations. Source drift deliberately
requires review before replaying old evidence. The detailed comparison and limitations live in the private terminology
plan; this evidence and harness are independently usable in the public source export.

The qualified Crucible removal in `3a6a281a` caused both historical inspectors to fail the
`translation_terms.ts` source-hash gate. The focused reversal restores the exact previous module bytes, so both
inspectors now pass against current source with the original recorded hashes. No experiment inputs, outputs or
hashes were regenerated or changed. Stage 4 replay covers 96 historical requests / 192 accepted targets / 192 recorded
reviews; Stage 5 covers 52 offline rows / 104 accepted targets / zero semantic reviews. These are provenance and
reconstruction checks, not new provider evidence or proof of overall semantic correctness/deployment readiness.

## Bounded Crucible rollback comparison — 2026-10-09

[New evidence](observations/2026-10-09-crucible-rollback.json) compares the actual transport at
`bba413b0c3428370951a6c5f217d085994b2c710` (pre) and `3a6a281a0ea694a245bb1bc77b3ce05d4b1a2d85`
(post), loaded from isolated Git blobs with database access forbidden. The shared checkout was never switched.
Only the historical 850m GP sentence and existing `negation` / `after` corpus sources were submitted.
Two trials reverse pre/post arm order: **12 requests, 24 targets, zero retries**. All submitted HTML was precomputed:
**2,292 character units including markup × both targets**, below the 10,000 cap. The existing key was verified in
memory against the existing F0 resource; its preflight quota was 113,168 / 2,000,000, leaving 1,886,832 units.
These counts bound submitted input exposure, not an invoice; concurrent service use and quota-reporting delay remain possible.

**Decision: removal rejected on retained matched evidence; the previous qualified Crucible entry is restored.**
Restoration avoids the demonstrated wait/then regression; it does not establish overall semantic correctness or
deployment readiness, and does not repair the historical action/deadline failure.

| Source / Chinese target, identical in both trials | Pre rollback | Post rollback |
| --- | --- | --- |
| Historical “Do not spend 850m GP until 24h after voting closes on Crucible page.” | Spend verb absent; prohibition limited to the 24h post-close interval | Same action/scope defects; clearer page placement does not repair them |
| Existing simple negation | Spend and do-not-yet retained | Spend and do-not-yet retained |
| Existing explicit wait/then | `花钱` = spend money; close → wait 24h → then retained | `花时间` = spend time; material action/object regression despite intact temporal order |

No stay (`停留`) substitution was observed, so the historical stay finding was not reproduced. All targets passed the
actual strict parser and preserved complete amount occurrences; none of these sources contains typed IDs. Pre restores
`熔炉`, post leaves `Crucible`; this terminology difference and provider spacing are acceptable separately from meaning.
All requests detected English (score 1); English reconstructions exactly echo the sources and production would omit
those 12 variants. Of 24 manually assessed targets, six fail meaning: four historical Chinese targets and two post
wait/then Chinese targets. Raw output, exact request bodies, occurrence tables, source/harness hashes, detection,
reconstructed parts and separate assessments are retained. No output repair or independent bilingual review occurred.

```sh
node scripts/translation-eval/crucible-rollback.mjs          # precompute only; no provider calls
node scripts/translation-eval/crucible-rollback.mjs --verify # offline replay of the new evidence
```

Replay requires the original Git revision objects. The live flag additionally requires a fresh credential-free local
F0/quota preflight and refuses to overwrite existing evidence; it is not authorization to repeat this experiment.
Historical evidence and hashes remain unchanged. The later focused reversal restores only the qualified Crucible
entry and test expectations, with the required backend-version increment. Other rules, player history and deployment
remain unchanged. Remaining blockers: obtain independent bilingual review,
retain the unresolved historical action/temporal defects and previously identified rule-comparison gaps, and complete
separately authorized deployment validation. No further experiments, code repair or deployment start automatically.

## Current direction — 2026-10-09

Keep the existing free Azure service with zero additional cost and lightweight recognition/restoration on the
Raspberry Pi. No local LLMs, paid providers or additional paid training/hosting. Narrow or remove individual rules
when they materially worsen sentence meaning versus Azure without added protection/glossary rules; inconsistent
terminology is acceptable. Exact preservation and parser acceptance do not prove meaning. H remains rejected.
No history correction or deployment is included. No provider experiments were run in the offline direction reset.

## Sentence context adapter (C; superseded evaluation direction)

The GPT/provider-replacement experiment below is retained as historical design and offline plumbing evidence.
Its credentialed evaluation recommendation and live commands are superseded by the constraints above; do not run
it or provision credentials as the next step. No actual C translation-quality result exists.

`context.mjs` prepares a full sentence and the actual N transport's occurrence table for a pinned
`gpt-4.1-mini-2025-04-14` structured-output request. The model sees source words and link labels together with their
positions, instead of having to infer semantics from numeric markers. Output is ordered prose/reference segments;
the adapter requires every occurrence once, restores authoritative objects through N's actual parser, and retains
the existing English-detection gate. Source-derived labels supply context, not new glossary entries or localized
item-name authorities. Prose is escaped and never interpreted as provider HTML. This still cannot prove meaning or
prevent an extra digit outside a correct occurrence. Do not repair observations with numeric cleanup.

```sh
node --test scripts/translation-eval/adapter.test.mjs scripts/translation-eval/context.test.mjs
```

The new fixed contrast corpus adds until/within/strict-before/only-after, inclusive/exclusive tenure, reversed
unit/total prices, reversed buy/sell prohibition, instruction-as-data and preservation probes. Reviewer-only contrast
oracles are not sent to the model. H remains a rejected historical control, not a candidate.

```sh
node scripts/translation-eval/context-run.mjs
node scripts/translation-eval/context-inspect.mjs
# Requires OPENAI_API_KEY or OPENAI_API_KEY_FILE, plus the existing Azure key configuration:
node scripts/translation-eval/context-run.mjs --live --repeats 3 --output test-results/translation-context-live.json
node scripts/translation-eval/context-inspect.mjs test-results/translation-context-live.json
```

The paired runner compares N/Azure and C/OpenAI on all 26 fixed synthetic sources, in alternating order per repeat.
Both return en/zh-Hans, with independent detection; detection disagreements require review. It uses one-second start
spacing, a ten-second network/body deadline, bounded envelopes, and no retries. Request failures save progress and
stop. Refusals/truncation are failures, never empty successful translations. Invalid C structures retain raw JSON for
separate meaning review but are unpublishable. A rejected target invalidates C's whole two-target result. The runner
records raw results, exact requests, source/harness SHA-256 hashes, model identity, usage and network/body latency
(excluding deliberate pacing) when live. It never logs keys, auth headers or provider error bodies.

[Offline evidence](observations/2026-10-09-context-offline.json) records 52 plumbing rows/104 targets, with **zero
semantic reviews**. These are source echoes, including deliberately artificial English detection for mixed text;
they are not provider observations, quality evidence, measured latency or billable usage. The inspector rebuilds
requests and reconstruction against source hashes. H's historical evidence remains separate. New live reports must
be explicitly reviewed and retained as dated synthetic evidence; do not overwrite the historical reports.

Review both raw and reconstructed targets blindly against the source, including rejected structures. Use faithful,
ambiguous, failed or unassessable, with explicit price, quantity, negation, eligibility, deadline, action,
mixed-language and preservation failure notes. For the inherited 16 cases, use the previous evidence's reasoning as
review guidance, never expected output strings. Repeat the full corpus three times; report critical failures by case
and category, detection changes, source-variant omission and repeat variability. Obtain independent bilingual review
before a production decision. Neither the JSON schema nor offline inspector scores meaning.

Historical decision (superseded): **go for a credentialed synthetic evaluation; no-go for production**. Meaning quality,
actual model access/schema acceptance, refusal behavior, full mixed-language handling, cost and latency remain
unverified. The historical experiment retained N; that selection does not establish semantic parity with Azure
without added rules. The amount-only H proposal is rejected.

## Amount / Charitree interaction — 2026-10-09

[Retained evidence](observations/2026-10-09-quantity-interaction.json) evaluates only the existing synthetic `quantity`
source: “Donate exactly 12 tokens to Charitree; keep at least 250k GP and do not donate all 30 tokens.”
Four arms select no added rules, amount protection only, Charitree glossary only, or both. Actual recognition functions
run before explicit evaluation-only subset filtering in an isolated Git-source loader; the actual document builder and
strict restoration parser handle selected occurrences. Database access throws; no worker is imported. Production
source is unchanged. The no-rules request uses plain mode; marker arms use HTML, matching the existing worker's mode
choice. Exact selection, modes, inputs, serialized request bodies, raw response envelopes, reconstructions, detection,
original/evaluation-source and harness SHA-256 hashes are retained.

Two trials reverse the complete arm order: **8 sequential Azure requests / 16 targets, zero retries**. Precomputed
input including HTML × both targets totals **1,824 character units**, below the 5,000 cap. The existing resource was
confirmed F0, with configured-key ownership checked in memory and 116,498 / 2,000,000 units reported used
(1,883,502 remaining) before submission. Quota reporting delay/concurrent use remain possible; this is a submitted
input budget, not invoice evidence. No paid provider or additional resource was used.

| Chinese results, identical across both trials | GP versus token reserve | Terminology | Exact amount bytes |
| --- | --- | --- | --- |
| No added rules | Correct `25万金币` = 250,000 gold | `Charitree` retained | Localized; differs acceptably |
| Amount only | Wrong `250k GP 个代币`, counting reserve as tokens | `Charitree` retained | Preserved |
| Charitree only | Correct `25万金币` = 250,000 gold | `慈善树` restored | Localized; differs acceptably |
| Both | Wrong `250k GP 个代币`, counting reserve as tokens | `慈善树` restored | Preserved |

All arms retain **12/30 quantities, exactly (`恰好`), at least (`至少`), all (`全部`) and prohibition (`不要捐出`)**.
The lower-bound operator survives even when its reserve referent is wrong. Localization of `250k GP` to `25万金币`
is a byte-preservation difference, **not a meaning failure**. Conversely, exact restored bytes do not excuse the token
classifier. All 16 targets reconstruct successfully; English targets exactly echo the source and production would
omit them (all detections are `en`, score 1). No typed links/IDs occur in this source.

**Finding: amount protection is implicated for this source; no observed Charitree main effect or additional interaction.**
The reserve failure appears with amount protection both without and with Charitree; adding Charitree alone preserves
meaning. Charitree-only is an HTML control with the amount visible, reducing a plain-versus-HTML explanation, but the
experiment does not separately isolate mode with a no-marker HTML baseline. This is one source, two repeated trials,
and single-agent review, not independent bilingual review or an error-rate estimate.

**Recommendation for review:** do not accept opaque amount protection as semantically safe for this sentence. Keep
production rules unchanged pending human review; this evidence does not justify global amount-rule removal or a
Charitree rule change. No further experiments, history correction, Pi/player access or deployment are authorized.

The Charitree experiment runner was removed when the feature retired. The observation file remains historical
research evidence; its source hashes identify the original implementation in Git history.
