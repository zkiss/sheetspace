# Sparse formatting selection projection

## Decision and scope

This is the investigation and implementation proposal for open Bead `sheetspace-erh`,
raised by `compact-workspace-toolbar` / Devflow `01-assure-compact-workspace-ui`.
It describes the frontend at `ef3fac4a490b`. It does **not** implement the refactor.
The goal is to make formatting summaries scale with axes and sparse overrides rather than
repeatedly materializing a selection's Cartesian product, while retaining today's controls.
This supports the responsiveness principle in [the project vision](../plan/PROJECT_VISION.md).

Recommend one validated selection descriptor, one five-property summary, and a separate
action-time write materializer. First consolidate the current algorithm into a streaming
dense reference implementation; then add exact sparse aggregation for large selections.
Keep a dense path for small selections. Do not add a maintained spatial index initially:
the existing override records permit sparse summaries without changing storage, but require
scanning **all cell override records**, including records outside the selected region.
Benchmark repeated small selections on heavily formatted sheets before investing in an index.

This document distinguishes:

- **Observed counts:** deterministic spies against current production functions, delivered in
  `NumberFormatControls.costEvidence.test.ts` and the existing memoization tests.
- **Derived costs:** loop, array and object counts from the cited source. These are not heap-byte
  measurements or timings; JavaScript engine allocation and garbage collection are unspecified.
- **Proposed budgets:** predictions for the algorithms below, not measured speedups.

All frontend source paths below are relative to `frontend/src/`. The changes are documentation
and focused characterization tests only. There are no backend, API, persistence, compatibility,
picker redesign, or unrelated workspace changes, and the Bead remains open.

## Current read and write path

### Selection geometry and call sites

[`workspace/NumberFormatControls.tsx`](../../frontend/src/workspace/NumberFormatControls.tsx)
currently owns both model calculations and React controls:

1. `selectionBounds` checks both sheet IDs and looks up both endpoints in both stable-ID axes
   with four `indexOf` calls. Axis selections still require valid row **and** column endpoints.
2. `selectionFormatWrites` validates again, slices both endpoint ranges in ascending order,
   then constructs local write targets. Cells use `flatMap` / `map` with a key, write object
   and number-format patch per position. Rows or columns use one axis `map`, but still slice
   the otherwise unused endpoint range on the opposite axis.
3. `selectionFormatControlState` materializes those targets with General patches, maps local
   number formats, then enumerates the effective region. It compares local and effective
   arrays separately and reports a format only if **both** are homogeneous.
4. `selectionAppearanceControlState` materializes a second target list. For each of four
   appearance properties it maps local values and separately builds effective values.
   Each effective pass validates bounds again and creates selected-axis slices. Rows expand
   over every sheet column; columns expand over every sheet row. Cell content is not consulted.
5. `resolveAppearanceProperty` in
   [`workbook/core/numberFormat.ts`](../../frontend/src/workbook/core/numberFormat.ts) creates
   a cell identity key, checks own cell properties, then row, column and application defaults.
   A lookup of a lower-precedence scope is skipped when a higher-precedence property is present.
6. Comparisons use `JSON.stringify(value) === JSON.stringify(first)`. `every` and `some`
   short-circuit, but only **after** the target and effective arrays have been constructed.
7. The toolbar's `useMemo` calls both summary functions, a further `selectionBounds` check for
   disabling, and `sheetCustomColours`. Dependencies are sheet ID, **content object**, overrides
   object, and selection object. Frame, revision and callback changes alone reuse the result;
   a content-value edit replacing content, or a new equivalent selection object, recomputes it.
8. Click handlers are created on each render and call the latest `onWrite`. Number-format
   writes enumerate targets once. Appearance writes enumerate number-format targets and then
   remap every target to a new write object and single-property patch, discarding the General
   patch. They do not compute effective values.

[`app/Workspace.tsx`](../../frontend/src/app/Workspace.tsx) imports these pure functions from
the React module. Ctrl/Cmd-B computes **all four** appearance summaries to toggle weight;
Ctrl/Cmd-Shift-1/5 computes the number-format summary to preserve matching precision.
Alignment and General shortcuts directly enumerate writes. Its keyboard listener is refreshed
with current sheet, selection, commands and interaction state; the toolbar and shortcuts do not
currently share a cached summary. `writeFormat` guards missing selection/sheet and cell editing,
dispatches nonempty writes, and restores grid focus. Modal dialogs disable background interaction.

### Cost notation

| Symbol | Meaning |
| --- | --- |
| `R`, `C` | Total durable rows and columns in the sheet |
| `r`, `c` | Inclusive endpoint rectangle sizes after normalizing reversed endpoints |
| `a`, `b` | Effective coverage axes: cells `(r,c)`, rows `(r,C)`, columns `(R,c)` |
| `E = a*b` | Effective coverage size, including blank positions |
| `W` | Local targets / write output: cells `r*c`, rows `r`, columns `c` |
| `Sᵣ`, `S꜀`, `Sₓ`, `S` | Own override records in row, column and cell maps; `S = Sᵣ+S꜀+Sₓ` |
| `Kp` | Selected cell records containing property `p`; bounded by `min(E,Sₓ)` |
| `Dp`, `U` | Distinct summary values for property `p`; distinct custom sheet colours |

Record cardinalities and property cardinalities differ: one cell record can contain all five
properties or just one. A row-local override is one write target but may cover `C` effective
positions. A column-local override similarly covers `R` positions. Sparse content values do not
reduce any current scan. Stable keys are defined in
[`workbook/core/cellIdentity.ts`](../../frontend/src/workbook/core/cellIdentity.ts), independently
of A1 coordinates or current axis order.

### Read-side work per toolbar memo miss

Counts below cover both summaries and the disabled check; palette work is separate.
An override, content/axes, selection or sheet-ID invalidation repeats exactly this path.

| Work | Cells | Rows | Columns |
| --- | ---: | ---: | ---: |
| Endpoint searches | 8 validations × 4 `indexOf` calls | same | same |
| Worst-case endpoint comparisons | `16R + 16C` | same | same |
| Selected-axis slices | 14 arrays, `7(r+c)` ID slots | 9 arrays, `7r+2c` slots | 9 arrays, `2r+7c` slots |
| Temporary target enumeration | `2W` cell targets | `2r` row targets | `2c` column targets |
| Local property reads / final local-array slots | `5W` | `5r` | `5c` |
| Effective property resolutions / final effective-array slots | `5E` | `5rC` | `5Rc` |
| Identity-key calls | `2W+5E = 7E` | `5E` | `5E` |
| Effective lookup checks | up to `15E` own-record checks (cell, row, column) | same | same |

Endpoint searches terminate at the found position; `16R+16C` is an upper bound, not the actual
cost of near-origin selections. The two exported summary helpers account for seven validations;
the toolbar adds the eighth. Invalid sheet/null/cross-sheet selection exits before axis searches.
Missing axis IDs still perform all four searches per attempted validation. Invalid summaries
skip effective enumeration; the palette still scans the sheet even when selection is invalid.

### Transient allocation versus peak memory

| Allocation category on a valid memo miss | Cells | Rows / columns |
| --- | --- | --- |
| Dummy targets | `2W` writes + `2W` patches + `2W` identity argument objects | `2W` writes + `2W` patches; no target identity objects |
| Target containers | 2 result arrays + `2r` inner arrays, `4W` cumulative target-reference slots | 2 result arrays, `2W` slots |
| Local containers | 5 arrays, `5W` slots | same |
| Effective containers | 5 result arrays + `5a` inner arrays, `10E` cumulative value-reference slots | same |
| Effective identity arguments | `5E` objects and `5E` key-producing calls | same |
| Bounds, empty state, summary records | Constant-size per call | same |
| Slices | As in read table | As in read table |

The two target lists are produced sequentially, not retained in the returned summary. Only one
property's effective and local arrays need remain reachable at a time. Thus algorithmic peak
reachable temporary storage is `O(W+E+a+b)`, not the sum of all five effective arrays. Inner
`map` arrays coexist transiently with a growing `flatMap` output. Cumulative allocated slots
above describe churn, **not** simultaneous live objects. Actual heap high-water marks depend
on GC timing, engine backing stores, string interning and React; none were measured here.

Homogeneous comparisons invoke two stringifications per visited value, including re-stringifying
the first value. Number format invokes up to `2W+2E`; its local mismatch skips the effective
comparison, but not effective enumeration. Each appearance property invokes up to `4W+2E`
when comparing local state twice, or `2W+2E` for all-inherited locals (the inherited test skips
one comparison). Across five properties this is at most `18W+10E` calls for uniform explicit
locals, or `10W+10E` for all-inherited locals. Stringifying undefined produces undefined, not
a string. Mixed cases can do much less comparison work while still allocating/scanning all
`5E` effective values. `local.every(undefined)` and number-format `local.some(Boolean)` add
up to `5W` presence checks overall; early presence/mismatch reduces them.

### Palette and memo hits

[`workspace/colourPalette.ts`](../../frontend/src/workspace/colourPalette.ts) already owns
palette enumeration. It allocates a three-element group array, three `Object.values` arrays
with `S` cumulative record references, and `S` two-element colour arrays. It visits both colour
properties per record, lowercases present values, filters the
fixed ten built-ins, builds a `Set` of `U` unique custom colours, and sorts a `U`-element output
by hue then lexical tie-break. Algorithmic work is `O(S + U log U)` and reachable auxiliary
storage `O(max(Sᵣ,S꜀,Sₓ)+U)`; sorting/engine internals are excluded. This is **sheet-level**
work: currently a selection-only invalidation unnecessarily repeats it. Palette normalization
is case-insensitive; effective property equality is not.

On a memo hit there are zero bounds searches, slices, target allocations, effective resolutions,
or palette scans in the memoized projection. JSX, closures, colour readout objects and ordinary
React rendering still occur; this is not a claim of allocation-free rendering. Frame/revision-only
updates are already verified in `NumberFormatControls.performance.test.tsx` and a real drag in
`app/App.formattingPerformance.test.tsx`. The former observes `7*400` keys on initial 20×20
render and zero on five frame/revision rerenders; that is a **baseline**, not a future budget.

### Action-time write costs

| Action (any valid scope) | Bounds / slices | Enumeration | Output and transient allocations |
| --- | --- | --- | --- |
| Number-format set/reset | 1 validation (4 searches); 2 slices with `r+c` slots | `W` targets; `W` keys only for cells | `W` writes + `W` patches; result array; cells also `r` inner arrays and `W` identity objects |
| Appearance set/reset | same | Same `W` targets followed by `W` remaps | `2W` writes + `2W` patches; second result array; same cell inner arrays/identities |
| Memo hit followed by action | Read work stays zero | Action work as above | A hit cannot remove the required output |

These counts end at the callback. Model command validation/application also costs work, but is
not included in selection projection costs. The existing `FormatWrite[]` callback necessarily
materializes `W` outputs: future summary optimization does not make a million-cell write
constant-space. Axis writes remain `r`/`c` outputs, not `E` cell writes. Avoiding the appearance
dummy remap can reduce churn without changing this lower bound.

### Repeatable workloads and limits

The delivered `NumberFormatControls.costEvidence.test.ts` spies on key creation, effective
resolution, endpoint searches and axis slices, then checks action output counts separately.
It reverses endpoints, uses blank sheets, and tests the first four rows below. The remaining
rows are source-derived extrapolations, deliberately not million-cell JSDOM mounts.

| Workload | `R×C`; mode; `r×c` | `E` | `W` | Current summary keys | Effective resolutions |
| --- | --- | ---: | ---: | ---: | ---: |
| Small blank rectangle | 2×3; cells; 2×2 | 4 | 4 | 28 | 20 |
| Large blank rectangle | 100×100; cells; 100×100 | 10,000 | 10,000 | 70,000 | 50,000 |
| Sparse sheet, two rows | 10,000×100; rows; 2×1 | 200 | 2 | 1,000 | 1,000 |
| Sparse sheet, two columns | 10,000×100; columns; 1×2 | 20,000 | 2 | 100,000 | 100,000 |
| Full sparse rectangle (derived) | 10,000×100; cells; 10,000×100 | 1,000,000 | 1,000,000 | 7,000,000 | 5,000,000 |
| Dense/mixed full rectangle (derived) | Same geometry, `Sₓ=E` | 1,000,000 | 1,000,000 | 7,000,000 | 5,000,000 |

Adding one exception in the last cell, or filling every cell with alternating values, leaves
these enumeration/key counts unchanged. Comparisons and palette cardinality change. The delivered
`NumberFormatControls.projectionContract.test.ts` demonstrates late exceptions for all five
properties, mixed local provenance with uniform effective defaults, and complete versus incomplete
cell masking on a 2×2 blank sheet in all three modes. Dense masking can remove an apparent
baseline mixture: it must not be reported mixed before accounting for cell overrides.

These deterministic observations measure algorithm calls, not browser latency, string bytes,
backend performance, or total application rendering. Tests themselves retain spy arguments;
their heap use is not a proxy for production heap use.

## Shared projection contract

The proposed pure interfaces are conceptual TypeScript contracts, not new stored data:

```ts
validateFormattingSelection({ sheetId, rows, columns }, selection)
  => InvalidSelection | ValidSelection
summarizeFormatting(validSelection, overrides)
  => FormattingSummary
materializeFormattingWrites(validSelection, singlePropertyPatch)
  => readonly FormatWrite[]
```

`InvalidSelection` has `valid: false`; controls adapt it to today's null-valued, inherited,
no-local-override state and disabled controls, and writes return `[]`.
`ValidSelection` has `valid: true`, sheet ID, mode, references to the immutable stable-ID
axes, normalized inclusive endpoint index ranges, effective coverage ranges, and `E` / `W`.
It stores neither target objects nor cell keys. Effective coverage uses all opposite-axis IDs
for row/column selections; write ranges retain only the selected axis. Empty axes cannot
validate endpoints. All four endpoint IDs must belong to the same supplied sheet, including
the otherwise irrelevant endpoint axis. Reversed endpoints normalize to the same ascending
write order. Structural reorder re-resolves endpoints by stable ID; removal invalidates a
missing endpoint instead of silently clamping. Blank cells remain part of both scopes.

For **each of five properties**, `FormattingSummary` exposes:

- Effective uniform/mixed state with a common effective value when uniform.
- Local common value or absence/mixed state, computed only over `W` selected-scope targets.
- `localOverrideState`: inherited if every local property is absent, explicit if every target
  has the same present property, mixed otherwise (including absent/present mixtures).
- `hasLocalOverrides`: true if any target has that property, even if explicitly default-valued.

Use tagged uniform/mixed accumulators internally; do not confuse absence, mixedness and an
application default. The UI adaptor can keep today's null sentinels. A validated region is
nonempty, so it always has a defined effective value or a genuine mixture. Appearance summaries
do not currently export number format; the new shared summary should include it without making
number-format button selection use the appearance-only rule.

### Semantics that must stay unchanged

The authority for types/defaults/writes remains
[`workbook/core/model.ts`](../../frontend/src/workbook/core/model.ts) and `numberFormat.ts`:

| Property | Explicit application default | Equality / special adaptation |
| --- | --- | --- |
| `numberFormat` | `{ kind: 'general' }` | Preserve current serialized equality and both local **and** effective homogeneity |
| `fontWeight` | `normal` | Exact value; toggle uses common effective bold, otherwise writes bold |
| `horizontalAlignment` | `general` | Exact value; General is not local absence |
| `textColor` | `automatic` | Exact stored string, including hex case; palette alone normalizes case |
| `fillColor` | `none` | Exact stored string; None is not local absence |

Inheritance resolves **property by property**: cell > row > column > application default.
A record containing only fill does not mask a row's number format or a column's weight.
An explicit default masks lower scopes. A null write removes only that local property;
unmentioned properties and constituent cell exceptions survive axis writes/resets.
Reuse the exported `APPLICATION_DEFAULT_*` constants rather than another default table.
Effective lookup must preserve own-record behavior (for example an ID `toString` must not read
Object.prototype); iteration must enumerate own records only.

Number-format UI rule: if local or effective values are mixed, report `format: null`; otherwise
return the common local format if present, else the effective format. Thus a cell explicitly
General beside an inherited General produces a mixed number-format control, even though the
effective appearance is uniform. A uniformly set axis format with conflicting cell formats
also produces a mixed number-format control. Do not replace this with effective-only uniformity.
Initially retain current `JSON.stringify` equality for number formats: serialize once per
observation and retain only accumulator/histogram keys, not a cache of every observed object.
Valid objects can have different property insertion orders. Switching to kind/precision equality
would change that edge behavior and needs a separate explicit decision.

[`workspace/colourControlReadout.ts`](../../frontend/src/workspace/colourControlReadout.ts)
stays the colour adaptor: row/column controls display local settings (or Inherit/Mixed), even
when row precedence or cell exceptions make effective values mixed. Cell controls retain their
effective/local readout and show mixed for either effective mixtures or mixed local provenance.
For inherited uniform hex colours they still show the inherited/reset marker, not an explicit
swatch. Keep effective state in accessible descriptions even when an axis swatch is uniform.
Weight/alignment pressed state still follows effective values; precision bounds remain 0–10.

### Invalidation and action safety

Geometry depends on sheet ID, immutable row/column references, mode and all endpoint scalar IDs.
Summary additionally depends on the immutable overrides reference. Content strings, frame,
revision, name, dimensions, callbacks and modal interaction flags do not change these results.
Replace axes or overrides immutably to invalidate; in-place mutation is not supported.
Value-normalized selection inputs avoid recomputing for a newly allocated equivalent selection.
Do not retain a descriptor after axis replacement; compute from the current tuple before actions.

Memoize sheet custom colours separately on sheet ID and overrides reference, not selection or
content. Preserve its current whole-map enumeration/filtering/sort behavior. An override change
anywhere may affect the palette even if outside effective coverage; without change metadata it
must also invalidate the summary. Structural changes invalidate geometry/summary but only require
a palette rescan if they replace overrides. Cache entries must be bounded to current inputs (or
weakly keyed), not accumulate every historic sheet/selection.

Own the current descriptor/summary in one focused workspace hook and pass the same data to the
toolbar and keyboard adaptor. Summary caches hold data, never callbacks or dispatch closures.
Handlers use current commands, selection tuple and `onWrite`; reuse of data must not reuse an
old callback. Direct writes use the same validated descriptor without running summary loops.
If a selection becomes invalid or interactions disabled, existing disabled/cancellation paths
still retire picker drafts/listeners. Keep editing/modal shortcut guards and grid-focus restore.
Write materialization accepts one typed appearance property with a value or null. Retain the
appearance helper's rejection of empty and multi-property control patches (`[]`); this does not
change the core command's support for valid multi-property batches elsewhere.

## Aggregation assessment

### Consolidated streaming dense reference

Walk the effective rectangle once. For each position create at most one cell key, load the
cell/row/column records once, resolve all five properties with the existing precedence, and
update fixed-size uniform/mixed accumulators. For cells, local summaries can be updated in
the same pass from the cell record; for axes, visit the `W` local records separately. Skip
completed property accumulators, but continue any unresolved property or local-presence check.
Do not call `resolveCellAppearance` unchanged: it currently creates a key five times through
five resolver calls. Share policy, not those repeated lookups.

Cost after bounds: `O(5E+5W)` work, at most `E` effective keys, no `E`-sized arrays or write
objects, and constant accumulator memory. Direct index iteration avoids axis slices. In a
mixed prefix, all effective and local answers may become final early; homogeneous defaults
and a last-cell exception still require the entire region. For axis modes local scans must
still discover overrides even if effective states are already mixed. This is a simpler, exact
oracle and a useful first improvement, but it still reads every implicit blank position.

### Exact sparse count aggregation

For each property `p`, treat the region as a multiset of `E` values. Build a count histogram,
not merely a set of present overrides. Let `Hᵣ[v]` count selected effective rows with a **present**
row property equal to `v`, and `r₀ = a - sum(Hᵣ)`. Let `H꜀[v]` count all `b` effective columns,
including absent column properties as the application default `d`. Before cell overrides:

```text
B[v] = b * Hᵣ[v] + r₀ * H꜀[v]
```

Build these histograms by iterating selected effective axis IDs and reading their own records;
do not enumerate the entire row/column override maps or cross-product axis values. Explicit
default rows count in `Hᵣ[d]` (and mask columns), not in `r₀`. Missing columns contribute default
coverage to `H꜀[d]`. Rows missing only property `p` inherit it regardless of other row properties.

Build membership sets of the `a` / `b` coverage IDs. Enumerate **all `Sₓ` own cell records**;
decode keys with `cellIdentityFromKey`, reject malformed keys or IDs outside those sets, and for
each present property in a relevant record:

```text
base = row[p] ?? column[p] ?? d
B[base] -= 1
B[cell[p]] += 1
```

A property absent in a cell record makes no adjustment. Baseline lookup is direct by row/column
ID and uses own records. A relevant explicit cell default still subtracts its baseline and
adds the explicit default. Records outside the selection have no effect; row/column modes use
membership across the entire opposite axis, so exceptions far beyond endpoint coordinates
still count. Delete zero-count bins or ignore them in final uniformity. Only after correction
is a single positive bin uniform; two or more positive bins are mixed.

Local summaries are independent: axes summarize the `W` selected row or column properties,
including missing-property counts, reusing the appropriate axis histogram pass. Cell locals
reuse the cell scan: count present values for
each `p` and add an **absent** bin of `W-Kp`; absence is not bin `d`. This detects uniform
inherited locals, explicit defaults, and partial-explicit mixtures without enumerating `W` cells.
Presence is exactly `Kp>0` for cell locals. Axis cell exceptions do not enter axis local counts.

Correctness follows from partitioning each position into row-defined coverage or row-absent
column/default coverage, then replacing that position's baseline once for each present cell
property. Counts always sum to `E`. An initial `B={red:1,default:3}` becomes `{default:4}` when
the red baseline cell is explicitly default; reporting mixed before that correction is wrong.
Likewise, fully covered cell overrides may remove *all* default coverage. Counting only override
values would incorrectly retain an implicit default or miss uncovered regions.

After bounds, five-property work is `O(5(a+b+Sₓ))`, with direct axis reads, one scan/decode per cell
record and at most five corrections per relevant record. Auxiliary memory is
`O(a+b+sum(Dp))` for membership sets and histograms; decoded key strings/objects add `O(Sₓ)`
transient churn, not retained cell targets. If implemented with `Object.entries`/`Object.keys`,
the cell scan additionally allocates `O(Sₓ)` reference containers; use own-record iteration
without an explicit entries array, while recognizing engines may internally enumerate keys.
Bounds remain `O(R+C)`; there is no claim of cost proportional only to **relevant** overrides.
Palette separately scans `S` and sorts `U`. Colours can make `Dp=O(Sₓ+a+b)`; dense coloured
regions therefore have linear histogram memory rather than dense streaming's constant memory.

Baseline mixedness is not a safe early exit: later cells can erase its bins. Complete the cell
scan before effective classification. Local mixedness and presence, once witnessed, are final;
their accumulators can stop even while effective counts continue. Histogram keys must reproduce
current equality, including serialized number-format keys and exact colour case.

### Recommendation, worst cases and indexing

Use the dense oracle for `E<=256` as an initial engineering cutoff, and the unindexed sparse
algorithm above for larger regions. The cutoff is an implementation starting point, not a
measured optimum or a product constraint. Tune it using the repeatable fixtures below. Keep
both algorithms interchangeable behind the same pure summary contract and compare their
outputs in tests. Selection validity and writes do not depend on the chosen aggregation path.

The sparse path replaces millions of blank-cell operations with axis counts and a cell-map
scan. Its cost is still poor when `Sₓ` is huge and almost every record is outside a modest
selection. Dense streaming wins there. In dense/many-colour cases `Sₓ≈E` and sparse aggregation
offers no asymptotic work improvement and can use more memory. Retain dense as a correctness
and workload fallback; do not invent a cheap density estimator by allocating `Object.keys`
on every selection and pretending that scan is free. A later adaptive chooser can cache
cardinality per immutable cell-map reference, charging its `O(Sₓ)` build explicitly. It is not
needed for the first implementation. Current recommendation has no indexed relevance query.

A candidate future index is a cell-override adjacency map by stable row ID (optionally a second
column map for narrow column selections). Building it costs `O(Sₓ)` time/space plus property
metadata, decoding and invalid-ID filtering; enumerating all row/column membership can add
`O(R+C)`. Querying row adjacency costs selected row bucket visits plus every entry in those
buckets, including entries rejected by the column range. It is not automatically `O(Kp)`.
Sorted positional buckets or a 2D range index add build/sort and structural-order maintenance
costs to get narrower queries. Even an indexed query retains default/axis coverage accounting.

Immutable formatting changes currently replace maps; rebuilding an adjacency index on each
new cell-map reference costs `O(Sₓ)` per change. Incremental maintenance needs a reliable changed
target stream and reset/undo/reorder/removal handling, not reference equality alone. Reorder
retains stable-ID adjacency but invalidates positional ordering; removal must exclude dead IDs.
Frame/revision-only changes should reuse it; weak-reference caches avoid unbounded history
retention. Add an index only if repeated queries amortize its build and retained memory and
measurements show full-map scans dominate. No storage/API change or compatibility layer is
necessary for any recommended step.

## Ownership and implementation sequence

The historical concern should not be solved by extracting modules that already exist:
palette derivation is in `colourPalette.ts`, native input/draft/listener lifecycle in
[`ColourPicker.tsx`](../../frontend/src/workspace/ColourPicker.tsx), and SVGs in
[`FormatIcon.tsx`](../../frontend/src/workspace/FormatIcon.tsx). Retain these responsibilities.
The remaining coupling is geometry + local targets + five independent effective passes inside
`NumberFormatControls.tsx`, copied defaults/comparisons, dummy appearance remapping, the combined
selection/palette memo, and Workspace importing computations from a React component.

| Proposed focused owner | Responsibility / dependency direction |
| --- | --- |
| `workbook/read/formattingSelection.ts` | Pure validation, normalized stable-ID ranges and scope descriptor; depends on core identity/model, not React |
| `workbook/read/formattingSummary.ts` | Five-property aggregation and equality policy; dense/sparse implementations can be sibling modules as they grow |
| `workbook/read/formattingWrites.ts` | Materialize one-property scoped writes from a valid descriptor; no summary arrays or dummy General patches |
| `workspace/useFormattingSelection.ts` | Current descriptor/summary memo orchestration shared by toolbar and Workspace keyboard consumers; no dispatch ownership |
| Existing control-state/readout adaptors | Number-format rule, appearance state mapping, colour readout and accessible labels |
| Existing `NumberFormatControls` / `ColourPicker` / icons | UI actions, bounded precision, popover drafts, cancellation, focus, styling and rendering |
| Existing `colourPalette.ts` | Separately memoized sheet-level palette derivation |

Use the existing selection shape structurally or a focused shared type rather than another
near-identical selection model. Keep model defaults/precedence in core; a resolver that accepts
preloaded records may share policy with the existing single-cell resolver without creating a
catch-all formatting utility. Respect existing frontend architecture tests for read/core/UI
dependency direction. There is no reason to refactor broader Workspace behavior.

Future implementation order:

1. Extract validated geometry and direct write materialization; characterize invalid endpoints,
   reversed ranges and every scope before changing call sites. Keep current summary results.
2. Introduce the unified dense streaming summary, reusing defaults/equality and removing
   target/effective arrays. Preserve both number-format and appearance adaptors. Replace the
   historical 7-pass assertion with the new deterministic read/write budgets.
3. Share the current projection between toolbar and keyboard through a focused hook; separate
   palette memoization. Preserve latest callbacks, focus restore, modal guards and selection
   invalidation. Plain content-value/frame/revision changes should not reproject formatting.
4. Implement sparse count aggregation behind the contract, differential-test against dense,
   then enable it for the large-selection cutoff. Record observed scan/memory counters before
   tuning or introducing adaptive selection/indexing.

Picker interaction remains unchanged: preview input never writes, application dispatches once,
Escape cancels/restores trigger focus, outside events cancel without stealing focus, invalid or
modal-disabled controls close drafts/listeners without background focus restoration. Retain
accessible names/descriptions, pressed state and inherited/default/mixed markers. JSDOM
characterization is not a physical native colour-dialog/browser-layout validation.

## Regression and performance scenario matrix

Abbreviations: **N** number format, **B** weight, **A** alignment, **T** text, **F** fill;
**C/R/K** cell/row/column selection. “Existing” means inspected coverage, not a claim that the
entire cross-product is already tested. Future pure tests should parameterize all five
properties × all three scopes unless the scenario explicitly concerns a UI-only adaptor.

| Invariant / scenario | Inspected coverage now | Required future focused coverage |
| --- | --- | --- |
| Uniform application defaults / inherited overrides, including blanks | `NumberFormatControls.test.ts` (N/B/A/F); `colourState` (T/F, C/R/K); cost evidence blank C/R/K | Model C/R/K × N/B/A/T/F: default and inherited common nondefault value; local absence stays inherited |
| Explicit defaults mask lower scopes; null means removal | Core `numberFormat.test.ts` property-wise defaults; `render` writes all defaults; `axisColours` R/K T/F reset preserves cells and weight | Model full cross-product: reset only named property, retain four siblings, reveal next precedence value; UI General/normal/general/automatic/none versus Inherit |
| Mixed local provenance, uniform effective value | `test.ts` B C/R/K; `colourState` T/F C/R/K; delivered `projectionContract` adds N distinction and A | Model all five: absent/present same default and nondefault; number button remains mixed, appearance effective stays uniform |
| Uniform axis locals with effective cell exceptions | `test.ts` N column; `colourState` and `axisColours` T/F R/K; delivered late-exception contract all properties | Model R/K × five, exceptions outside endpoint opposite-axis slice; UI keep axis T/F swatch + mixed-effective description, N precision disabled |
| Row > column; cell masking is per property | Core `numberFormat.test.ts` N/B/T/F; `colourState` column T/F/B/A with conflicting rows | Model all five plus disjoint property patches; ensure a fill-only record cannot mask another property; C/R/K |
| All-covered versus uncovered default / mixed baseline regions | `colourState` / `axisColours` full T/F cell coverage; delivered `projectionContract` all-five complete/incomplete masking C/R/K | Dense/sparse differential tests: 0, 1, E−1, E cell property entries; differing axis histograms erased by cells; assert sum of positive counts equals E |
| Last-position exception / dense mixed adversary | Delivered late exception N/B/A/T/F C/R/K; cost evidence large blank counts | Model late exception after long uniform prefix; dense alternating values and unique colours; absent-property records do not imply coverage |
| Reversed, reordered, removed stable IDs; empty/invalid selection | `colourState` reversed R/K; `test.ts` missing row; `performance` removed column/sheet ID; `palette` invalid-selection closure | Model all modes: scalar-equivalent selection, reorder changes inclusive interior, removed endpoint, absent sheet/null, missing each endpoint ID, cross-sheet endpoints, empty axes; UI cleared selection cancels picker |
| Scope output, blank targets and single-property reset | `test.ts` rectangle/axis number writes, single cell fill; `axisColours` R/K T/F; application `numberFormats.test.ts` partial patches/inverse | Writer C/R/K × five set/reset; row-major ascending cell output, axis-only IDs, no effective-summary work or dummy properties |
| Palette invalidation and independent memo | `palette` built-in filtering/case/draft dedupe; `performance` overrides add custom colour | Hook selection/axes/content-only change causes zero palette scans; overrides outside region change palette, removals refresh sorted/deduped output; selection summary still invalidates on overrides |
| Frame/revision-only memo hit and latest callback | Existing `performance` 20×20 / latest number callback; `App.formattingPerformance` real drag/save | Hook C/R/K zero projection work on frame/revision/content-only changes; new equivalent selection same hit; latest number/appearance/keyboard dispatch after callback replacement |
| Accessibility, precision, cancellation and focus | `render`, `visuals`, `axisColours`, `palette`; `App.numberFormats` focus/persistence | Keep UI integration separate from model aggregation: names, descriptions, pressed/mixed/default markers, precision limits, Escape/outside/disabled cancellation, listener cleanup and modal focus ownership |

Test suites should stay cohesive: geometry/writer tests, dense/sparse summary differential tests,
memo orchestration tests, and accessible picker integration tests are separate responsibilities.
Do not duplicate the five-property precedence table in every UI test.

### Proposed deterministic budgets and scaling fixtures

- Validating geometry: one set of four endpoint searches per changed geometry; no target/key
  allocation, no effective-region traversal. Descriptor uses ranges, not selected slices.
- Dense summary: at most `E` keys/position visits, one five-property record resolution per
  visited position, at most `W` additional axis local reads; zero write objects and zero
  `E`/`W`-sized value arrays. Early mixed exits can lower visits, never hide an unresolved state.
- Sparse summary: `a+b` axis visits, one visit/decode per `Sₓ` own record, at most
  `sum(Kp)` corrections; zero Cartesian key construction and zero write objects. Count membership
  sets, histogram bins, decoded-key churn and any engine/explicit enumeration containers separately.
- Frame/revision/callback-only hits: zero bounds, summary, slice or palette work. Axes changes
  revalidate; override changes reaggregate and repalette. Plain content-value changes with the
  same axes and overrides must hit the proposed cache.
- Writer: exactly `W` outputs and patches, cell keys only for `W` cell writes; zero summary
  resolutions and no intermediate target-to-patch remap. Output-linear storage is intentional.

Repeat fixtures with `(R,C) = (20,20), (100,100), (10,000,100)` and reversed endpoint ranges:
single cell, 20×20 rectangle, full rectangle, two rows, and two columns. For each use `Sₓ=0`,
one last-position override, a fixed 10-entry sparse set, and dense coverage (alternate values
then unique colours). Separately hold `E` fixed above the cutoff while growing overrides **outside**
the region to expose unindexed `Sₓ` costs. Test all five properties present together and records
with only one property. Include row-only and column-only overrides, conflicting axes and
complete/partial cell masking. Maintain distinct metrics for `E`, `W`, `S`, relevant counts,
key/resolver/axis/record visits, allocation categories and positive histogram bins.

Use pure-function counters for deterministic CI assertions; spy retention must not contaminate
heap profiling. For optional browser profiling, report runtime/browser, fixture, warm/cold passes,
median/percentiles and GC/heap methodology separately, with uninstrumented timings. No universal
wall-clock threshold is proposed. Compare new summaries to the dense oracle, not to today's
redundant seven-pass allocation budget. End-to-end toolbar/keyboard tests verify semantics and
memo sharing, not model operation counts distorted by grid rendering.

## Reproduction and validation

From the repository root, reproduce the delivered evidence and current relevant regressions:

```bash
npm --prefix frontend test -- --run src/workspace/NumberFormatControls.costEvidence.test.ts src/workspace/NumberFormatControls.projectionContract.test.ts
npm --prefix frontend test -- --run src/workspace/NumberFormatControls.test.ts src/workspace/NumberFormatControls.colourState.test.ts src/workspace/NumberFormatControls.axisColours.test.tsx src/workspace/NumberFormatControls.performance.test.tsx src/workspace/NumberFormatControls.render.test.tsx src/workspace/NumberFormatControls.visuals.test.tsx src/workspace/NumberFormatControls.palette.test.tsx src/app/App.formattingPerformance.test.tsx src/workbook/core/numberFormat.test.ts
make -C frontend compile
```

The work-pass results and environment belong in the task's `ratchet advance` evidence. Tests
validate current counts/contracts, not the proposed algorithms. Root `make test` and `make compile`
are the full authoritative monorepo checks for eventual holistic assurance; frontend compilation
runs architecture tests, TypeScript and Vite. The neighboring
[virtualization measurement](workspace-grid-virtualization.md) records deterministic cardinality,
and [input validation](workspace-input-validation.md) distinguishes browser evidence from JSDOM
checks. This investigation makes the same distinction and claims no measured runtime improvement.
