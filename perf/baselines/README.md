# VS Code baseline capture

`node tools/vscode-baseline/run.mjs` drives two disposable VS Code Extension Development Host windows - one over `perf/fixtures/large-files`, one over `perf/fixtures/monorepo` - via `--disable-extensions --extensionDevelopmentPath=tools/vscode-baseline` against an isolated per-run `--user-data-dir`/`--extensions-dir` profile, and writes `perf/baselines/vscode.json`. The isolated profile is seeded with workspace trust disabled, updates and telemetry off, `workbench.startupEditor: none`, and `chat.disableAIFeatures: true`, so the first-run trust dialog and Copilot sign-in prompt never block the automation. `--disable-extensions` disables third-party extensions only; VS Code's built-in TypeScript language features stay active, which is exactly what makes the completion/definition/references/rename capture meaningful.

Scenario ids align with the Codevo harness, but identical ids never guarantee identical work. Every scenario records a `cutPoint` string, a `warmups` count, the ordered `targets`, and per-sample `{ ms, resultCount? }` objects, and the gap report is responsible for refusing to compare rows whose cut-points, warm-up counts, sample counts, or result counts do not line up.

## Status of the committed `vscode.json`

The current contract is `c7.7-production-v5`. A committed `perf/baselines/vscode.json` whose embedded
contract metadata differs is stale and must be recaptured; it is not valid C7.7 comparison evidence.
Treat the file itself as the source of truth for the numbers and protocol metadata it actually
contains, never for a newer protocol. This README deliberately does not duplicate millisecond values
in prose: quoted numbers drift out of sync with recaptures, so read them from the JSON.

## Sampling protocol

- **Ordinary LSP scenarios** (`completion-bounded`, `completion-unbounded`, `definition-medium-2k`, `references-medium-2k`, and `rename-medium-2k`): 2 discarded warm-up invocations on `targets[0]` and `targets[1]`, then exactly 10 measured samples, one per target, in fixed canonical order, with no interleaving between scenarios.
- **20k explicit-interactive provider scenarios** (`completion-large-20k`, `definition-large-20k`, `references-large-20k`, and `rename-large-20k`): VS Code performs real provider commands on `large-20k.ts`; Codevo performs real explicit provider requests on the active 20k model after proving its `explicit-interactive` tier and readiness. Both sides record ten samples, but their provider boundaries are editor-specific, so the contract marks the rows `informational-asymmetric`, not cross-editor comparable.
- **100k capability scenarios** (`completion-large-100k`, `definition-large-100k`, `references-large-100k`, and `rename-large-100k`): zero-sample observations with neutral shared metadata (`cacheState: capability-observation`, `workScope: editor-specific-large-document-capability`). Codevo invokes no semantic provider and records that its 100k document remains editable under the effective `editing-only` / `full-sync-utf16-limit` tier. VS Code performs one bounded capability probe per provider. The rows expose that editor-scoped capability contrast and never measure provider latency.
- **Navigation targets**: the first 10 `export type <X>Kind = "a" | "b" | "c";` declarations in file order that also have a later `: <X>Kind;` field usage. Definition is invoked at the start of the identifier in that field usage; references and rename are invoked at the declaration name. Rename asks for `<X>KindRenamed` and the returned `WorkspaceEdit` is never applied, so the document is never mutated and no revert is needed. One declaration in `medium-2k.ts` (`EventModel6Kind`) has no usage anywhere in the fixture and is therefore skipped by target discovery; requiring a usage is what keeps the definition target well defined.
- **`completion-bounded`**: member completion immediately after the `.` of the first `input.` occurrence in the target file - a small, identical member list on both editors.
- **`completion-unbounded`**: global unfiltered completion at the first blank line. VS Code converts the entire ambient symbol table (tens of thousands of items) while Codevo's Rust projection caps its list, so this row is permanently non-comparable by result counts. It is retained because the absolute cost is real on both sides.
- **`typing-large-5k` / `-20k` / `-100k`**: 60 single-character `type` commands dispatched at the end of the file using the fixed probe text `const perfTypingProbe00 = "abcdefghijklmnopqrstuvwxyz0123456789";`. The first 10 keystrokes are warm-up and discarded; the remaining 50 are samples. The buffer is reverted with `workbench.action.files.revert` in a `finally`, so later scenarios always see clean fixture content. Each typing scenario is gated on the same language-service readiness check described below, so VS Code never types into a cold TypeScript service while Codevo waits for a running one; the scenario records `languageServerStatus: "running"` and says so in its `windowNote`.
- **`tab-switch-cycle`**: all five large files are opened once as warm-up, then 6 cycles x 5 files = 30 measured switches, so cycle 1 is warm like every other cycle.
- **`file-search-engine`**: the same 10 query strings the Codevo harness uses (`file-01`, `moduleA`, `pkg-3`, `index`, `moduleB`, `extra`, `file-05`, `pkg-4`, `large`, `tsconfig`), 2 discarded warm-ups then one measured sample per query, `maxResults` capped at 80 to match Codevo's `QUICK_OPEN_RESULT_LIMIT`. The strings and cap align; the matching work does not. Codevo finishes fuzzy-subsequence ranking, while VS Code resolves `workspace.findFiles` with a glob/substring query.
- **`quickopen-ui`**: Codevo-only UI evidence uses 2 discarded warm-ups followed by exactly 10 measured query targets. VS Code has no corresponding scriptable Quick Open UI row.
- **Exact count enforcement**: the contract requires warm-ups/samples/targets of `5/30/30` for tab switching, `10/50/50` for every typing and Codevo frame row, `2/10/10` for every measured provider, file-search, and Quick Open row, and `0/0/0` for capability and memory observations. Any count drift invalidates the capture. `timerQuantizationMs` must be finite, greater than zero, and at most 1,000 ms.
- **Language-service readiness**: before each typing scenario and measured LSP block the harness proves the TypeScript service is answering rather than timing a syntax-only or cold fallback. Codevo additionally requires the active 20k document's `explicit-interactive` tier and a non-empty completion readiness probe before its explicit provider batch. The 100k capability block does not pretend to warm or time providers: Codevo observes `editing-only` / `full-sync-utf16-limit`, while VS Code issues one bounded provider-capability probe per row. This is a capability contrast, not latency parity.

## Cut-points

| Scenario                                      | `cutPoint`                      | What the window actually contains                                                                                                                                                                                                                                   |
| --------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| completion / definition / references / rename | `provider-command-resolved`     | `vscode.commands.executeCommand("vscode.execute*Provider", ...)` dispatch until the promise resolves, which includes converting the provider payload into VS Code API objects. Codevo's corresponding cut point is `provider-ui-ready`; no VS Code widget is shown. |
| typing                                        | `typing-dispatch`               | `type` command dispatch until `workspace.onDidChangeTextDocument` fires for the same document.                                                                                                                                                                      |
| tab switch                                    | `tab-switch-open-resolved`      | `vscode.open` dispatch until the command resolves. `windowNote`: "awaits vscode.open resolution only; no frame settlement".                                                                                                                                         |
| file search                                   | `workspace-find-files-resolved` | `workspace.findFiles` dispatch until the result list resolves; Codevo's corresponding cut point is `fuzzy-subsequence-ranking-complete`.                                                                                                                            |

## Honest limitations

- **No paint, no frame, no rendering is measured anywhere in this baseline.** A VS Code extension runs in the extension host process and has no access to the renderer's frame loop; there is no extension API equivalent of `requestAnimationFrame` over the workbench. Every number here stops before layout and paint. Codevo's separate `typing-*-frame` rows and its rendered tab-switch window include frame production, so those rows compare strictly different windows and must never be presented as parity. The three ordinary `typing-dispatch` rows use the shared document-change cut point and are nominally cross-editor, subject to the timer-quantization rule below.
- **`file-search-engine` is not Quick Open and is asymmetric.** VS Code measures no picker, typed input, fuzzy ranking, or list rendering; it resolves `workspace.findFiles` with a glob that implements contiguous substring matching on path segments. Codevo's row includes its bounded case-insensitive fuzzy-subsequence ranking over relative paths. `c7.7-production-v5` therefore declares the row `informational-asymmetric`; matching query strings, caps, or result counts cannot turn it into a parity ratio.
- **Two RAF callbacks are not a fixed floor.** Codevo's rendered tab-switch window includes two sequential `requestAnimationFrame` callbacks, while the VS Code extension observes only command resolution. Callback timing depends on the current frame phase; there is no truthful fixed 33 ms value to subtract. Any raw ratio is context across asymmetric cut points, never an adjusted parity result.
- **Production capture is available on both sides.** The current Codevo lane builds a one-run instrumented release artifact and records `bundleMode: "production"`, `captureFlavor: "production-instrumented"`, and a cold fresh profile. VS Code uses a stock production release. Earlier documentation about a dev-only Codevo comparison remains true only for those historical captures; it is superseded for new C7.7 evidence. Instrumentation and the editors' different observable boundaries still prohibit broad parity claims.
- **Clock resolution.** `environment.timerQuantizationMs` is the minimum positive `performance.now()` delta measured in the extension host at startup. VS Code reports microsecond resolution; Codevo runs in WKWebView, which clamps `performance.now()` to 1 ms. Any row whose median is within an order of magnitude of a side's quantization is a clock artifact, not a measurement. Consequence worth stating plainly: the aggregate marks a row `quantization-limited` when a side's median is below 10x its own quantization, and Codevo's typing-dispatch medians are a few milliseconds against a 1 ms clock, so the three nominally comparable `typing-dispatch` rows will in practice be unscoreable on macOS on essentially every run. Cross-editor typing parity is structurally unmeasurable here; treat both sides' typing numbers as absolute budgets, not as a ratio.
- **`p95` at n=10 is the maximum.** `sorted[Math.ceil(10 * 0.95) - 1]` is `sorted[9]`. Every provider "p95" in this file is a single worst observation, so a lone JIT or cold outlier becomes the published value. The p50 is the more meaningful statistic at this sample count.
- **Window size is not recorded** because the extension host cannot observe it, so `environment.windowSize` is omitted rather than guessed. Both editors' render cost scales with visible line count, so this remains an uncontrolled variable for typing and tab switching.
- **`percentilesFromSamples` is duplicated** between `tools/vscode-baseline/extension.js` and `scripts/perf/perfScenarios.mjs`. The extension cannot import repository modules, so the two copies are a permanent drift hazard on the one function that defines every published number.

## Result-bearing assertions

Every measured LSP repetition must individually return a non-empty result - a definition or reference array, a completion list, or a rename edit with entries. A single empty repetition turns the scenario into a `no-result` status with the offending target names, and `run.mjs` then refuses to write `perf/baselines/vscode.json` and exits non-zero. Only `status: "ok"` is accepted: `invalid`, `not-run`, `no-result`, `skipped`, `policy-disabled`, and `non-comparable` all fail the run lane. This proves the recorded VS Code work was non-empty; it does not prove Codevo performed the same work, which is why per-sample `resultCount` is recorded and the join enforces a count tolerance.

## Metadata

`perf/baselines/vscode.json` records:

- `fixtureVersion` - the hand-maintained `FIXTURE_VERSION` label imported from `scripts/perf/perfScenarios.mjs`.
- `fixtureHashes` - a content digest of the fixtures actually measured, so a label collision cannot pass unnoticed. `perf/fixtures/large-files` is hashed per file under `large-files/<relative path>` keys; `perf/fixtures/monorepo` holds 3,252 generated files, so it is collapsed into a single bounded `monorepo/` key whose value is a SHA-256 over the sorted `path:sha256` lines of `computeFixtureHashes(monorepoRoot)`. Both sides must use the same key scheme or the join has nothing shared to compare.
- `environment` - `editor`, `version`, `commit`, `arch` (the last two are the second and third lines of `code --version`, which an earlier revision of this file claimed were recorded when they were not), `bundleMode`, `timerQuantizationMs`, `platform` (`<process.platform>-<process.arch>-<os.release()>`), and `capturedAt`. The extension host's `vscode.version` is cross-checked against the `code --version` output and a mismatch fails the capture.

The fixtures themselves are gitignored (`perf/fixtures/`, `perf/results/`), so `fixtureHashes` is the only way a reviewer can confirm which bytes were measured. Regenerate them with `npm run perf:fixtures` before capturing.

## Capability rows

The four `*-large-100k` ids are zero-sample capability observations. Codevo records
`policy-disabled` only after observing the active document's effective `editing-only` tier and exact
`full-sync-utf16-limit` reason and invokes no semantic provider. VS Code performs one bounded
provider-capability probe for each row. Neither side records a latency sample. The four 20k ids are no
longer capability rows: they execute providers under each editor's explicit large-file path and
remain informational because their cut points differ.

## Fresh multirun sequence

Regenerate the fixtures once with `npm run perf:fixtures`, then capture three clean production runs
and one later confirmation run per editor without changing fixture bytes. Use
`npm run perf:production` for Codevo. Use `node tools/vscode-baseline/run.mjs` for VS Code and copy
`perf/baselines/vscode.json` to a new private absolute path immediately after every run because the
next run replaces it.

Aggregate the eight distinct raw files with the stable CLI below (all paths must be absolute):

```bash
node scripts/perf/aggregate-perf-runs.mjs \
  --codevo-clean /absolute/codevo-clean-1.json \
  --codevo-clean /absolute/codevo-clean-2.json \
  --codevo-clean /absolute/codevo-clean-3.json \
  --codevo-confirmation /absolute/codevo-confirmation.json \
  --vscode-clean /absolute/vscode-clean-1.json \
  --vscode-clean /absolute/vscode-clean-2.json \
  --vscode-clean /absolute/vscode-clean-3.json \
  --vscode-confirmation /absolute/vscode-confirmation.json \
  --output /absolute/c7.7-production-v5-aggregate.json
```

Omit `--output` to emit JSON on stdout. The aggregate is deliberately
`canonicalCapture: false`: it is a separate analysis artifact, keeps the confirmation runs outside
the median of the three clean runs, and never replaces or rewrites a raw capture. A clean Codevo run
must prove `windowMode: "focus-only"`; VS Code may truthfully retain `windowMode: "unknown"` because
its extension API cannot observe native focus. Rows below either side's ten-tick timer threshold are
preserved as quantization-limited and unscoreable rather than rejecting the full cohort.

## Provenance

An earlier capture round needed a manual `code` launch because the isolated `--user-data-dir` lived under a long `os.tmpdir()` path (`/var/folders/.../T/...`); the resulting IPC Unix-domain-socket path (`<user-data-dir>/1.<version>-main.sock`) exceeded macOS's ~103-character `AF_UNIX` limit, which made the freshly spawned VS Code process treat itself as a duplicate of a running instance and self-terminate (`Lifecycle#kill()` in its own verbose log) about a second after launch. It was not a crash and not a sandbox or process-tree constraint, as an earlier round had suspected. `ipcSafeTmpDir()` now derives the isolated profile directories from `/tmp` directly on non-Windows platforms, which keeps the socket path short enough to bind, and makes `run.mjs` a reproducible single-command entry point on macOS.

`large-files@v2` added a minimal `package.json`/`tsconfig.json` to `perf/fixtures/large-files` so the directory opens as a real project rather than in VS Code's inferred-project mode; `large-files@v3` added the seeded 2,000-line `medium-2k.ts`, the only realistic multi-construct fixture comfortably inside both large-document policy limits. Captures taken against different fixture versions are not comparable, which is what `fixtureVersion` plus `fixtureHashes` now enforce mechanically instead of by discipline.
