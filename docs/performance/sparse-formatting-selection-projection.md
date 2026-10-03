# Sparse formatting selection projection

## Implemented decision and scope

Sheetspace now validates formatting selection geometry once, shares one five-property summary
between toolbar and keyboard consumers, and materializes writes only when an action occurs.
`summarizeFormatting` chooses streaming dense aggregation for effective coverage `E<=256` and
exact, unindexed sparse aggregation for larger selections. Both algorithms remain independently
callable and differential-tested. The cutoff is an initial engineering choice, not a measured
runtime optimum.

This work follows the investigation for open Bead `sheetspace-erh`, raised by
`compact-workspace-toolbar` / Devflow `01-assure-compact-workspace-ui`. The Bead remains open.
The implementation supports the [project vision's responsiveness principle](../plan/PROJECT_VISION.md)
without changing storage, backend/API behavior, picker interaction, or workspace layout.
There is no maintained spatial index, adaptive density cache, or compatibility layer.

**Evidence boundary:** the tests below measure deterministic operation counts and logical
container sizes. Source analysis describes allocation categories and asymptotic costs. Neither
is a browser latency, heap-byte, garbage-collection, or end-to-end rendering measurement.
Historical investigation counts appear separately at the end; they are not current budgets.
All frontend source paths below are relative to `frontend/src/`.

## Cost notation

| Symbol | Meaning |
| --- | --- |
| `R`, `C` | Total durable rows and columns in the sheet |
| `r`, `c` | Inclusive endpoint rectangle sizes after normalizing reversed endpoints |
| `a`, `b` | Effective coverage axes: cells `(r,c)`, rows `(r,C)`, columns `(R,c)` |
| `E = a*b` | Effective coverage size, including blank positions |
| `W` | Local targets / write output: cells `r*c`, rows `r`, columns `c` |
| `Sᵣ`, `S꜀`, `Sₓ`, `S` | Own override records in axis/cell maps; `S = Sᵣ+S꜀+Sₓ` |
| `L` | Relevant cell records whose decoded IDs belong to both effective coverage axes |
| `Kp` | Relevant cell records containing property `p`; `Kp<=L<=min(E,Sₓ)` |
| `Dp`, `U` | Distinct summary values for property `p`; distinct custom sheet colours |

Record cardinality differs from property cardinality: one cell record can contain all five
properties or only one. A row-local override is one write target but may cover `C` positions;
a column-local override similarly covers `R`. Content strings do not reduce coverage.
Keys use stable IDs from
[`workbook/core/cellIdentity.ts`](../../frontend/src/workbook/core/cellIdentity.ts), not A1 coordinates.

## Contract and ownership

| Owner | Responsibility |
| --- | --- |
| [`workbook/read/formattingSelection.ts`](../../frontend/src/workbook/read/formattingSelection.ts) | Pure validation and normalized stable-ID ranges; no keys or targets |
| [`workbook/read/formattingSummary.ts`](../../frontend/src/workbook/read/formattingSummary.ts) | Public summary exports and dense/sparse chooser |
| `workbook/read/formattingSummaryTypes.ts` | Five-property summary contract shared by both algorithms |
| `workbook/read/formattingSummaryDense.ts` | Streaming reference algorithm and small-selection path |
| `workbook/read/formattingSummarySparse.ts`, `formattingHistogram.ts` | Exact coverage/correction counts and serialized-value histograms |
| [`workbook/read/formattingWrites.ts`](../../frontend/src/workbook/read/formattingWrites.ts) | Direct single-property local write materialization |
| [`workspace/useFormattingSelection.ts`](../../frontend/src/workspace/useFormattingSelection.ts) | Current geometry, summary and independent palette memos shared with Workspace |
| `workspace/formattingControlState.ts`, `colourControlReadout.ts` | Number-format and appearance/readout UI adaptation |
| `workspace/formattingActions.ts` | Pure shared toolbar/keyboard action policy, precision validation and shortcut decoding |
| `workspace/NumberFormatControls.tsx`, `ColourPicker.tsx`, `FormatIcon.tsx` | Control event wiring, drafts, cancellation, focus, accessibility and rendering |
| `workspace/colourPalette.ts` | Sheet-level colour enumeration, normalization, filtering and sorting |
| [`workbook/core/numberFormat.ts`](../../frontend/src/workbook/core/numberFormat.ts) | Exported defaults and property-by-property precedence policy |

The pure read modules depend on core, not React. Frontend architecture tests enforce these
dependency directions. Workspace no longer imports model computations from the React controls.

### Geometry and local scope

`validateFormattingSelection(sheet, selection)` returns `{valid:false}` or a descriptor with
sheet ID, mode, references to immutable axes, normalized inclusive endpoint index ranges,
effective coverage ranges, `effectiveSize` (`E`) and `writeCount` (`W`). It stores neither selected
slices nor target objects. Validation performs four endpoint `indexOf` searches once per changed
geometry, with `O(R+C)` worst-case work.

All four endpoint IDs must belong to the supplied sheet, including the otherwise unused opposite
axis in row/column mode. Missing sheet, null/cross-sheet selection, missing endpoint or empty axis
is invalid. Controls adapt invalid summaries to null values, inherited/no-local state and disabled
controls; writes return `[]`. Reversed endpoints retain ascending row-major cell write order.
Reordering re-resolves stable endpoints against the new axes; removing an endpoint invalidates
selection rather than clamping it. Axis effective coverage includes the entire opposite axis.

### Five-property summary semantics

Each property exposes `effectiveValue` (common value or null for mixed), `localValue` (common
explicit value or null), `localOverrideState` (`inherited`, `explicit`, `mixed`) and
`hasLocalOverrides`. Local state concerns only the `W` selected-scope targets. Inherited means
every property is absent; explicit means every target has the same present value; mixed includes
absent/present mixtures. An explicit default is a local override, not absence.

| Property | Application default | Equality / UI rule |
| --- | --- | --- |
| `numberFormat` | `{kind:'general'}` | Serialized equality; controls require both effective and local homogeneity |
| `fontWeight` | `normal` | Exact value; toggle writes normal only for common effective bold, otherwise bold |
| `horizontalAlignment` | `general` | Exact value; General differs from absence |
| `textColor` | `automatic` | Exact string, including hex case |
| `fillColor` | `none` | Exact string; None differs from absence |

Defaults come from the exported core constants. Each property resolves independently:
cell > row > column > application default. Fill-only records do not mask weight or number format.
An explicit default masks lower scopes. A null write removes only that local property, retaining
siblings and constituent cell exceptions. Own-record lookup excludes inherited map entries,
including prototype-name IDs such as `toString` and `__proto__`.

Both algorithms preserve `JSON.stringify` equality, including number-format property insertion
order. `{kind:'number',precision:2}` and `{precision:2,kind:'number'}` remain distinct. Histograms
serialize observations without retaining a per-cell object cache. Palette normalization alone
is case-insensitive; summary equality is case-sensitive.

The number-format adaptor returns null if effective values or local provenance are mixed;
otherwise it returns the common local format when present, else the effective format. An explicit
General beside an inherited General therefore remains a mixed control despite uniform effective
formatting. Uniform axis locals with conflicting cell formats also remain mixed.

Axis colour controls show local settings or Inherit/Mixed, retaining mixed-effective accessible
descriptions even when their local swatch is uniform. Cell colour readouts consider effective and
local mixedness. Inherited uniform hex colours keep an inherited/reset marker. Weight/alignment
pressed state follows effective values; precision remains bounded to 0–10.

### Memoization and action safety

Geometry depends on sheet ID, immutable axis references, mode and endpoint scalar IDs; summary
also depends on immutable overrides. Content-value edits, frame, revision, dimensions, name,
callbacks and modal flags do not affect summaries. Equivalent newly allocated selections hit the
cache. In-place axis/override mutation is unsupported. Entries are bounded to current inputs,
not accumulated for historical selections.

The palette memo depends separately on sheet ID and overrides. Selection/axes/content-only changes
do not repalette. Override replacement anywhere reaggregates and repalettes, even when its cell
records lie outside selection. Palette derivation retains its whole-map scan, lowercasing,
built-in filtering, deduplication and hue/lexical sorting: `O(S+U log U)` work with `Object.values`
containers. That work is separate from summary counters.

Toolbar and keyboard receive the same descriptor/summary; caches hold data, not callbacks.
`formattingActions.ts` shares bold toggling and number-format kind/precision policy across those
consumers and decodes keyboard modifiers and physical shifted digits without rendering. Actions use
current commands and `onWrite`; direct writes use the descriptor without summary loops. Pure action
guards suppress keyboard writes while editing or in a modal, and Workspace retains native-input
event ownership and grid-focus restoration. Picker cancellation/listener cleanup and accessible
markers are unchanged. Preview input never writes; apply dispatches once; Escape
restores trigger focus; outside events cancel without stealing focus. Invalid/modal-disabled
controls retire drafts without background focus restoration. JSDOM does not validate physical
native colour dialogs or browser layout.

## Algorithms

### Streaming dense reference

The dense algorithm walks all `E` positions once, creates one cell key per position, loads
cell/row/column records and resolves all five properties with the core preloaded resolver.
Fixed-size effective accumulators stop comparing once mixed, but the current implementation still
visits every position. Cell locals are observed in the same pass; axis locals visit their `W`
records separately. This is `O(5E+5W)` work and constant accumulator memory after geometry.
It creates no write objects, selected-axis slices or `E`/`W`-sized value arrays. Uniform blank
regions and late exceptions cost exactly `E` keys, not five or seven keys per position.

### Exact sparse count aggregation

For property `p`, let `Hᵣ[v]` count effective rows with a present row property equal to `v`, and
`r₀ = a - sum(Hᵣ)`. Let `H꜀[v]` count the `b` effective columns, replacing absent column properties
with application default `d`. Before cell overrides, the effective histogram is:

```text
B[v] = b * Hᵣ[v] + r₀ * H꜀[v]
```

One pass over each effective axis builds five-property histograms and membership sets. Explicit
default rows count in `Hᵣ[d]`, masking columns; missing properties inherit independently. The
algorithm reads selected axis records directly, not all axis override maps or axis value products.

It then enumerates all `Sₓ` own cell records with `for…in` plus an own-property guard, decoding each
key once with `cellIdentityFromKey`. Malformed keys, dead IDs and outside-region records do not
affect summaries. Each present property of a relevant record corrects exactly one position:

```text
base = resolvePreloadedAppearanceProperty(undefined, row, column, p)
B[base] -= 1
B[cell[p]] += 1
```

There is no Cartesian key construction, cell-target materialization, or explicit `Object.keys` /
`Object.entries` container for the cell map. Baseline lookups use own axis records. Missing cell
properties do not correct anything; explicit cell defaults do. Axis selections include cell
exceptions beyond the endpoint rectangle on the opposite axis.

Local axis histograms are populated during their effective-axis pass. Cell-local histograms count
present values during the cell scan and then add a distinct absence bin of `W-Kp`. Axis cell
exceptions never enter axis-local summaries.

Zero-count bins are deleted. Classification occurs only after all corrections: baseline mixedness
is not a safe early exit because complete cell coverage may erase every baseline bin. For example,
`{red:1,default:3}` becomes `{default:4}` when the red position is explicitly default. Final bins
are positive, sum to `E` for each property, and are uniform only when exactly one remains.

After geometry, work is `O(5(a+b+Sₓ))`: exactly `a+b` axis visits, one cell visit/decode per own
record and exactly `sum(Kp)` corrections. Relevant records load row/column baseline records once
each; own-record checks are `a+L` for rows and `b+L` for columns. Histogram combination traverses
axis bins, not positions. Storage is `O(a+b+sum(Dp))` for membership and histogram bins.

### Allocation categories and limits

- Membership retains `a+b` stable-ID entries in two sets; it does not copy selected-axis arrays.
- There are 20 histogram maps: row, column, effective and local for each of five properties.
  Bin counts update in place; inserting a new nonzero bin allocates a bin record, and deletion /
  later reinsertion can allocate another. Metrics count peak **stored bins**, not cumulative
  allocations or Map backing-store bytes.
- Key decoding creates identity objects and substrings for decodable records (`O(Sₓ)` transient
  churn). Malformed keys can return before object allocation. Serialized number-format keys and
  iterator machinery also allocate; none are per-position target arrays.
- No explicit cell-map enumeration container is created, though engines can internally enumerate
  keys. Constant-size property groups and final summary records remain.
- Optional metrics additionally collect five totals/bin counts and traverse final bins to verify
  positivity and totals. Normal hook calls omit metrics.
- Dense/unique-colour cases can have `Dp=O(Sₓ+a+b)`. Sparse histograms then use linear memory while
  the dense reference retains constant accumulator memory; no asymptotic speedup is claimed.

### Worst cases and future indexing

Sparse aggregation avoids millions of implicit blank positions but still scans the **whole cell
map**, including irrelevant records. With `E` fixed above the cutoff and `Sₓ` huge, dense may be
faster. Both remain callable, but the default chooser deliberately uses only `E`; it does not
scan `Object.keys` to estimate density or maintain an uncharged cache. Tuning needs recorded
workload evidence beyond the initial cutoff.

A future cardinality cache would charge `O(Sₓ)` construction per immutable cell-map reference.
A stable-row adjacency index (optionally also by column) would similarly cost `O(Sₓ)` time/space
plus decoding and invalid-ID filtering. Queries must count selected buckets and entries rejected
by the opposite axis, not just relevant properties. Positional/2D indexes add sorting and
structural-order maintenance. Reorder preserves stable-ID adjacency but invalidates positional
order; removal must exclude dead IDs. Immutable format replacements rebuild indexes unless a
reliable changed-target stream supports reset/undo/reorder/removal. Weak/bounded caches must not
retain historical sheets. Add indexing only when repeated queries amortize its cost and measured
full-map scans dominate; it needs no storage/API change.

## Deterministic evidence

`formattingSummary.scaling.test.ts` repeats blank, one-late-record and ten-record workloads with
all five properties together and with fill alone. It uses reversed full rectangles, two-row
and two-column selections at each sheet size below. The million-position case is a pure summary
call, not a million-cell UI mount or million-record fixture.

| `R×C` | Scope | `E` | `W` | `a+b` sparse axis visits / membership entries | Default summary keys |
| --- | --- | ---: | ---: | ---: | ---: |
| 20×20 | Full rectangle | 400 | 400 | 40 | 0 |
| 20×20 | Two rows / two columns | 40 | 2 | 22 | 40 |
| 100×100 | Full rectangle | 10,000 | 10,000 | 200 | 0 |
| 100×100 | Two rows / two columns | 200 | 2 | 102 | 200 |
| 10,000×100 | Full rectangle | 1,000,000 | 1,000,000 | 10,100 | 0 |
| 10,000×100 | Two rows | 200 | 2 | 102 | 200 |
| 10,000×100 | Two columns | 20,000 | 2 | 10,002 | 0 |

The tests call sparse independently even where the chooser uses dense. For these fixtures
`Sᵣ=S꜀=0`, so `S=Sₓ=L` is 0, 1 or 10. Sparse record visits and decoder calls equal `Sₓ`;
corrections equal 0/5/50 for five-property records and 0/1/10 for fill-only records. Sparse summary
keys and summary writes are zero regardless of `E` or `W`. Every property's positive effective
counts sum to `E`. Blank cases retain 15 histogram bins; nonblank cases assert a conservative
peak bound of `15+10L`, separately from `a+b` membership entries. This bound is fixture-specific,
not a general guarantee for arbitrary axis overrides or colours.

The fixed-coverage test holds `E=W=400` and `a+b=40`, with one relevant fill record, two invalid/dead
records, and 0/10/1000 outside records. Thus `Sₓ=S` and decoder calls grow to 3/13/1003, while
`L=Kfill=1`, corrections remain 1 and peak histogram bins remain 17. It demonstrates the
unindexed full-map cost rather than pretending relevance-only work.

Boundary tests verify dense at 255/256 positions and sparse at 257. Writers produce exactly
`W` writes and patches, with `W` keys only for cell writes and no summary/decode work. Output-linear
storage is intentional: a million-cell write is not constant-space. Axis writes remain `r` or
`c` outputs. The pure `selectionAppearanceWrites` helper rejects empty/multi-property patches (`[]`);
rendered controls supply typed single-property writes. Core commands still accept valid
multi-property batches elsewhere.

`NumberFormatControls.costEvidence.test.ts` checks four endpoint searches, no slices, cutoff-aware
summary key counts and separate write output counts. The 20×20 toolbar performance test now
observes **zero initial summary keys**, one sparse projection, and no further summary work on
frame/revision/content-value/equivalent-selection/callback-only rerenders. Number and appearance
actions use the latest callback and each produce 400 writes/keys. `App.formattingPerformance`
retains real-drag range selection and verifies one shared summary refresh after writing; grid
rendering counts are not mixed into model evidence.

### Correctness coverage

`formattingSummary.differential.test.ts` compares the complete summary across all five properties
and all three scopes, including:

- 0, 1, `E-1` and `E` cell-property coverage; conflicting axes wholly/partly erased by cells;
  explicit-default masking; missing sibling properties; final positive counts and totals.
- Uniform effective values with mixed local provenance, late exceptions and axis-local scope.
- Malformed keys, dead/outside IDs, inherited map entries, prototype-name IDs and reversed/reordered
  ranges. Existing geometry tests retain invalid/removed endpoint characterization.
- Dense alternating values, unique colours, colour hex-case differences and number-format
  insertion-order distinctions on bounded 20×20 fixtures.
- Reproducible generated partial-property records using LCG seed `0x5eed`, including structural
  reorder. Independent bounded enumeration compares existing core property resolution with explicit
  cell/row/column/default precedence as well as the effective summary, so algorithm agreement alone
  cannot hide a shared precedence bug.

Geometry and writes are tested directly in `formattingSelection.test.ts`, including all four
endpoint failures in each scope, empty/missing axes, reversed order, explicit single-property writes
and resets. The summary, projection-contract and colour-state suites exercise calculation and
readout rules without rendering. `formattingActions.test.ts` covers the scope/format/action/reorder
matrix, mixed-effective versus mixed-local action policy, precision boundaries and editing/modal
guards. `formattingShortcuts.test.ts` independently covers modifier and physical-key decoding.

React memo dependencies and independent palette invalidation are exercised with `renderHook` in
`useFormattingSelection.memo.test.tsx` and `useFormattingSelection.palette.test.tsx`. Isolated control
suites cover presentation, actual input/click callbacks, accessible readouts, picker drafts,
cancellation and listener cleanup. Workspace suites retain shortcut-to-command wiring, current
commands/focus callbacks across a memo hit and reorder, invalid-selection wiring and native input
focus rather than repeating the functional scope matrices. App tests retain real range selection,
header drag and scope-specific gesture/focus restoration after immutable shortcut writes. These
integration assertions are distinct from pure policy and hook cache evidence. No million-record
adversary or browser speedup claim is needed to validate the aggregation math.

## Historical investigation baseline

At `ef3fac4a490b`, the toolbar independently computed number and appearance summaries, materialized
two dummy target lists and built local/effective arrays. Per valid memo miss it performed eight
validations (32 endpoint searches), `5E` effective resolutions and `2W+5E` keys for cells or `5E`
for axes. Source-derived selected-axis slices were 14 arrays / `7(r+c)` slots for cells, or nine
arrays / `7r+2c` row-mode slots / `2r+7c` column-mode slots. Target/write/patch churn was `2W` each;
local arrays held `5W` slots and effective arrays plus inner arrays allocated `10E` cumulative
reference slots. Peak reachable algorithmic temporary storage was `O(W+E+a+b)`, not the sum of all
sequential property arrays. Stringification/comparison could short-circuit only after enumeration.

The original investigation measured 28 keys / 20 resolutions for a 2×2 rectangle, 70,000 / 50,000
for a 100×100 rectangle, 1,000 / 1,000 for two rows on a 10,000×100 sheet, and 100,000 / 100,000
for two columns. The old 20×20 UI budget was 2,800 initial keys and zero on frame-only memo hits.
The intermediate unified dense implementation reduced initial keys to `E`; the current chooser
reduces the large blank rectangle's summary keys to zero. These are operation-count changes,
not measured runtime/heap speedups.

Historically content-object/equivalent-selection changes recomputed summaries and selection-only
changes repaletted. Appearance actions also remapped dummy General writes into new patches.
Current immutable scalar/axis dependencies, independent palette memo and direct writer remove
that work. Actual heap high-water marks still depend on engine backing stores, interning and GC;
spy argument retention is not production heap evidence.

## Reproduction and assurance

Run from the repository root:

```bash
npm --prefix frontend test -- --run src/workbook/read/formattingSelection.test.ts src/workbook/read/formattingSummary.test.ts src/workbook/read/formattingSummary.differential.test.ts src/workbook/read/formattingSummary.scaling.test.ts src/workbook/core/numberFormat.test.ts
npm --prefix frontend test -- --run src/workspace/NumberFormatControls.costEvidence.test.ts src/workspace/NumberFormatControls.projectionContract.test.ts src/workspace/NumberFormatControls.test.ts src/workspace/NumberFormatControls.colourState.test.ts src/workspace/NumberFormatControls.axisColours.test.tsx src/workspace/NumberFormatControls.performance.test.tsx src/workspace/NumberFormatControls.render.test.tsx src/workspace/NumberFormatControls.visuals.test.tsx src/workspace/NumberFormatControls.palette.test.tsx src/app/App.formattingPerformance.test.tsx
npm --prefix frontend test -- --run src/workspace/formattingActions.test.ts src/workspace/formattingShortcuts.test.ts src/workspace/useFormattingSelection.memo.test.tsx src/workspace/useFormattingSelection.palette.test.tsx src/app/Workspace.formattingActions.test.tsx src/app/Workspace.formattingGuards.test.tsx src/workspace/NumberFormatControls.popoverPosition.test.tsx src/workspace/WorkspaceToolbar.test.tsx
make test
make compile
```

Root checks are authoritative monorepo assurance; frontend compilation includes architecture tests,
TypeScript and Vite. The work-pass outcomes belong in `ratchet advance` evidence. For optional
browser profiling, report runtime/browser, fixture, warm/cold passes, median/percentiles and GC/heap
methodology separately, using uninstrumented timings. There is no universal wall-clock threshold.
See also [virtualization measurement](workspace-grid-virtualization.md) and
[input validation](workspace-input-validation.md) for the distinction between deterministic/JSDOM
evidence and browser measurements.
