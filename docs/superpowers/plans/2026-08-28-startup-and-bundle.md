# Startup, bundle, and retained-memory evidence

## Scope and comparison contract

This record compares the round-4 starting commit `064dd3cb79c8fb4c41fbc27fda80a96da034f5fe`
with the reviewed Phase 1 result. Evidence is retained outside the repository under
`/tmp/codevo-qa-round4/phase1/`; generated builds, logs, synthetic workspaces, app data, and
screenshots are not repository artifacts.

The startup metric is process launch to the first painted activity rail shell. At the first line
of Tauri `run`, Rust captures the `SystemTime` epoch in milliseconds. The renderer inserts the
shell synchronously, waits for two `requestAnimationFrame` callbacks, creates the
`codevo-startup-shell-painted` performance mark, and sends both its navigation elapsed time and
`performance.timeOrigin + mark.startTime` as `paintEpochMs`. Rust subtracts the two epochs and logs
the process-to-paint duration exactly once. Dynamic telemetry module loading and IPC receipt
latency therefore occur after the measured paint and are excluded. A new process is used for each
sample.

Commit `064dd3cb` predates this metric and its startup shell. The disposable baseline clone
therefore receives an evidence-only backport of the same shell and logger, plus a marker that
confirms all 130 synthetic threads were loaded. Because the production store intentionally caps
one root at 64 threads, the measurement patch also injects 130 unique, fully shaped threads into
the frontend state for one root after that root is opened. The exact uncommitted patch is
`/tmp/codevo-qa-round4/phase1/baseline-one-root-instrumentation.patch`. This makes the paint boundary
comparable, but it is not a measurement of the baseline's original blank window followed by its
full React rail. It can slightly improve the observed baseline because the evidence shell itself
is new. "Cold" below means a fresh application process; filesystem and dynamic-loader caches are
not purged.

## Environment

- macOS on Apple Silicon, Europe/Bratislava
- Node `v24.13.1`, npm `11.8.0`
- rustc `1.95.0 (59807616e 2026-04-14)`, cargo `1.95.0 (f2d3ce0bd 2026-03-21)`
- Dependencies installed in the disposable clone with `npm ci --offline`; no network calls
- Baseline clone: path recorded in `/tmp/codevo-qa-round4/phase1/baseline-dir.txt`
- Post-change clone at `380f91ad530f4dedcd276a8216e11a5bf0bb0fa8`: path recorded in
  `/tmp/codevo-qa-round4/phase1/post-dir.txt`
- Isolated identifiers: `dev.mockor.editor.phase1baseline` and
  `dev.mockor.editor.phase1post`

## Baseline bundle at `064dd3cb`

Command: `npm run build`

Raw output: `/tmp/codevo-qa-round4/phase1/baseline-npm-build.log` (exit code in the adjacent
`.exit` file). The build emits Vite's chunk-size warning. Every generated chunk over 500 kB is:

| Chunk                           | Minified size |
| ------------------------------- | ------------: |
| `html.worker-DHV2Gw4F.js`       |     721.07 kB |
| `css.worker-BMRYVGlr.js`        |   1,056.39 kB |
| `ts.worker-CAkdSciT.js`         |   5,937.04 kB |
| `monacoEnvironment-DxZiQojr.js` |   1,087.73 kB |
| `editor.api-CYLjCPvQ.js`        |   2,539.59 kB |
| `App-D6DN_gDT.js`               |   4,437.31 kB |

The large worker assets are reported separately from the startup graph because they execute in
workers. The baseline still has three non-worker chunks over the 500 kB requirement.

## Baseline startup

Five comparable epoch-subtraction fresh-process samples were 345.33, 346.65, 361.95, 364.39, and
367.59 ms. The median was **361.95 ms** and the mean was **357.18 ms**. Raw logs are
`/tmp/codevo-qa-round4/phase1/baseline-final-startup-{1..5}.log`; sorted values and the summary are
`baseline-final-startup-values-ms.txt` and `baseline-final-startup-summary.txt`.

The one-root memory run had earlier confirmed all 130 synthetic threads at 978 ms, but its 534 ms
paint value used the superseded IPC-receipt logger and is excluded from the startup comparison.
That raw log remains at `baseline-one-root-startup-1.log` for auditability.

## Baseline retained memory with 130 threads

One temporary workspace root is opened. An evidence-only frontend fixture then replaces its
loaded owner state with 130 unique threads, each containing four completed turns and eight unique
4,096-character assistant-text events in total. A native marker confirms the frontend retained
exactly 130 threads owned by that one root before RSS is sampled. This bypass is required only
because the production persisted store rejects or evicts above 64 threads per root; it does not
claim that 130 same-root threads are persistable in normal use. The fixture source is preserved in
`/tmp/codevo-qa-round4/phase1/baseline-one-root-instrumentation.patch`.

RSS is measured for the native application process and the launch-adjacent WebKit GPU, Networking,
and WebContent XPC processes. macOS reparents those XPC processes to launchd, so their adjacent
PIDs and launch timestamps are preserved in the raw process snapshots rather than relying on a
descendant-only total.

After the exact-130 marker, RSS was:

| Process accounting                   |  After load | After 1,841 s idle |          Idle change |
| ------------------------------------ | ----------: | -----------------: | -------------------: |
| Native Codevo process                | 138.500 MiB |        139.641 MiB |  +1.141 MiB (+0.82%) |
| Launch-adjacent WebKit XPC processes | 592.922 MiB |        604.625 MiB | +11.703 MiB (+1.97%) |
| Combined                             | 731.422 MiB |        744.266 MiB | +12.844 MiB (+1.76%) |

Raw values and the relevant process snapshot are
`/tmp/codevo-qa-round4/phase1/baseline-one-root-memory-after-load.txt` and
`/tmp/codevo-qa-round4/phase1/baseline-one-root-memory-after-load-processes.txt`. Idle values and
the corresponding process snapshot are in `baseline-one-root-memory-after-30-min-idle.txt` and
`baseline-one-root-memory-after-30-min-idle-processes.txt`. The isolated app data, synthetic
workspace, and rejected-fixture scratch store were moved to macOS Trash and verified absent; the
normal `dev.mockor.editor` application data was never read or modified. Cleanup proof is
`baseline-cleanup.txt`.

## Post-change evidence

### Bundle at `380f91ad`

`npm run build` passed without Vite's chunk-size warning. The pre-paint JavaScript closure is
**11.16 KiB across three assets**, below the 500 KiB requirement. No non-worker on-demand asset is
over 500 KiB. The only generated assets over 500 kB are the intentionally on-demand Monaco
language workers:

| Chunk                     | Minified size |
| ------------------------- | ------------: |
| `html.worker-DHV2Gw4F.js` |     721.07 kB |
| `css.worker-BMRYVGlr.js`  |   1,056.39 kB |
| `ts.worker-CAkdSciT.js`   |   5,937.04 kB |

Raw build output: `/tmp/codevo-qa-round4/phase1/post-npm-build.log`.

### Startup

The matched warm-cache fresh-process series was 337.03, 343.29, 350.42, 352.37, and 402.68 ms.
Its median was **350.42 ms**, 11.53 ms (3.19%) lower than baseline; its mean was **357.16 ms**,
effectively unchanged from the 357.18 ms baseline mean because of the 402.68 ms outlier. Raw logs
are `post-startup-{6..10}.log`; sorted values and the summary are
`post-final-startup-values-ms.txt` and `post-final-startup-summary.txt`.

The first five launches immediately after building the previously uncached disposable clone were
373.45, 408.81, 417.05, 417.31, and 450.32 ms after sorting (median 417.05 ms). They are retained as
`post-startup-{1..5}.log` and reported rather than hidden, but they are not the matched comparison:
the baseline comparison series also followed validation launches of its evidence binary. The
result supports a modest warm-cache median improvement, not a filesystem-cold startup claim.

### Retained memory with 130 threads

The post-change clone used the same one-root frontend fixture and exact-130 native marker. The
post-change turn shape additionally carries the newly implemented truthful stream-byte metric,
which does not exist in the baseline schema. The marker fired at 837.17 ms in
`post-memory-run.log`.

| Process accounting | Baseline load |   Post load |           Load change | Baseline idle |   Post idle |            Idle change |
| ------------------ | ------------: | ----------: | --------------------: | ------------: | ----------: | ---------------------: |
| Native Codevo      |   138.500 MiB | 129.328 MiB |   -9.172 MiB (-6.62%) |   139.641 MiB | 128.047 MiB |   -11.594 MiB (-8.30%) |
| WebKit XPCs        |   592.922 MiB | 503.406 MiB | -89.516 MiB (-15.10%) |   604.625 MiB | 503.422 MiB | -101.203 MiB (-16.74%) |
| Combined           |   731.422 MiB | 632.734 MiB | -98.688 MiB (-13.49%) |   744.266 MiB | 631.469 MiB | -112.797 MiB (-15.16%) |

During the post-change 1,850-second idle interval, native RSS decreased 1.281 MiB (0.99%), WebKit
increased 0.016 MiB (0.003%), and combined RSS decreased 1.265 MiB (0.20%). Raw endpoints and
process snapshots are `post-one-root-memory-after-load*` and
`post-one-root-memory-after-30-min-idle*`. The exact disposable patch is
`post-one-root-instrumentation.patch`; hashes of the core evidence are in
`post-evidence-sha256.txt`.

The isolated post-change app data and workspace were moved to macOS Trash and verified absent;
the normal application data was untouched. Cleanup proof is `post-cleanup.txt`.

## Phase 2 parallel-test note

A current repository-wide search found no live `RUST_TEST_THREADS=1` recommendation. The only
single-thread references are historical PASS command transcripts using `--test-threads=1` in the
2026-06-20 plan. Those lines are retained as evidence history and were not rewritten. New Phase 2
proof runs `cargo test --lib` and `cargo test --tests` with the default thread count three times:

- `cargo test --lib --quiet` passed three consecutive runs, each with 2,941 passed, 0 failed,
  and 2 ignored; observed timings were 34.36 s, 34.56 s, and 35.85 s;
- `cargo test --tests --quiet` passed three consecutive full runs. Each run's library portion had
  2,941 passed, 0 failed, and 2 ignored, followed by integration binaries with 97, 122, 11, 16,
  12, 29, 17, 8, 35, 25, 40, 36, 38, 22, 17, and 86 passing tests respectively, all with zero
  failures. Library timings were 34.35 s, 35.03 s, and 33.84 s; the supervisor binary took 5.32 s
  in the prior observed run and 7.89 s in the third run.

## Limitations

- Fresh-process startup does not flush OS file caches and is not a powered-off cold boot.
- Startup is sensitive to OS cache state. Both primary comparison series followed validation
  launches, and the initial uncached post-build series is disclosed separately. The evidence does
  not prove an improvement from a purged filesystem cache.
- macOS may host WKWebView content in processes outside the app's descendant tree. Native RSS and
  identifiable WebKit RSS are therefore recorded separately and are not conflated.
- The 130-thread fixture exercises frontend thread retention and output-event data. It does not
  simulate live provider subprocesses, terminals, network traffic, or user secrets.
- Same-root production persistence remains capped at 64 threads. The 130-thread comparison is a
  deliberately documented in-memory stress fixture, not a supported persistence claim.
- An earlier three-root run is retained under the non-`one-root` evidence filenames but is
  superseded and excluded from the comparison because 64 + 44 + 22 threads across workspace tabs
  did not satisfy the stricter one-opened-root requirement.
