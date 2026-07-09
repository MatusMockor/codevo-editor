# Dev QA Harness

`scripts/qa-project-scenarios.mjs` is a small deterministic harness for real
project editor checks. It calls the dev-only `window.__codevoQa` bridge directly
and avoids pixel/token click automation.

## Current Scope

The harness runs deterministic checks against real project files. When the
dev-only bridge exposes `window.__codevoQa.openWorkspaceRoot(path)`, each
scenario switches to its `projectRoot` before opening the scenario file. When the
bridge also exposes `window.__codevoQa.openWorkspaceFile(path)`, each scenario
opens its target file before setting the cursor and calling provider APIs. Older
bridge builds are still supported: without `openWorkspaceRoot`, the harness keeps
the previous behavior and verifies that the current active workspace/project
matches the scenario before it opens the file. Without `openWorkspaceFile`, the
active editor tab still needs to match the scenario file. When the bridge exposes
`getWorkspaceRoot()`, the harness requires it to match the scenario
`projectRoot`; until then it verifies the active editor file is under that
project root.

Built-in project roots:

- `/Users/matusmockor/Developer/invoices`
- `/Users/matusmockor/Developer/Efabrica/boxes/ebox-crm`

List scenarios:

```sh
node ./scripts/qa-project-scenarios.mjs --list
```

Preflight selected scenarios before opening a live app/CDP session:

```sh
node ./scripts/qa-project-scenarios.mjs --all --preflight
```

The same preflight is available through npm:

```sh
npm run qa:projects:preflight
```

`--preflight` works with `--all` or repeated `--scenario <id>` flags. It checks
that each scenario's `projectRoot`, `activeFile`, cursor anchor, and exact
`expectActiveFile` definition target exist before the live bridge/snippet run.
Cursor anchors report their match count; zero matches fail, while multiple
matches warn because the live runner currently uses the first match.

## Running

### Manual macOS/Tauri flow

Use this lane when Tauri WebView DevTools are available but Chromium CDP is not:

```sh
npm run qa:projects:manual
```

The manual command runs the same preflight first, then prints a bounded
copy-paste snippet that can run all selected project roots on the new bridge.
It also prints grouped fallback snippets for older bridges that do not expose
`openWorkspaceRoot(path)`.

1. Start the QA app:

   ```sh
   npm run debug:qa
   ```

2. Open Tauri WebView DevTools for the app window.
3. Paste the all-project snippet into the DevTools Console. On bridges with
   `openWorkspaceRoot(path)`, the snippet switches roots before each file open.
4. If the bridge lacks `openWorkspaceRoot(path)`, open the matching project
   workspace in the Tauri app and paste the grouped fallback snippet for that
   project root. Repeat once per project root.

The snippets use the same `window.__codevoQa` bridge as the CDP runner. If
`window.__codevoQa` is missing, restart with `npm run debug:qa`; for an already
running dev app, set the DEV-only fallback in the console:

```js
localStorage.setItem("codevo.qaBridge", "1");
location.reload();
```

### CDP automation

Start the app with the bridge enabled:

```sh
npm run debug:qa
```

If the app is available through a Chrome DevTools Protocol endpoint, run:

```sh
node ./scripts/qa-project-scenarios.mjs \
  --cdp-url http://127.0.0.1:9222 \
  --target-url localhost:1420 \
  --all
```

The same CDP batch is available through the central smoke runner:

```sh
npm run smoke:projects
```

`smoke:projects` expects the app to already be running with `npm run debug:qa`
and a reachable CDP endpoint. It runs `--preflight` first so missing real
project files or cursor-anchor drift are reported before CDP connection issues.
Override the defaults when needed:

```sh
MOCKOR_EDITOR_QA_CDP_URL=http://127.0.0.1:9222 \
MOCKOR_EDITOR_QA_TARGET_URL=localhost:1420 \
npm run smoke:projects
```

When CDP is missing or unreachable, start the app with `npm run debug:qa`, set
`MOCKOR_EDITOR_QA_CDP_URL` if DevTools is listening somewhere other than
`http://127.0.0.1:9222`, or use `--print-snippet` and paste the generated code
into Tauri WebView DevTools. If the page is reachable but
`window.__codevoQa` is missing, restart with `npm run debug:qa`; for an already
running dev app, set the DEV-only fallback in the console:

```js
localStorage.setItem("codevo.qaBridge", "1");
location.reload();
```

`--all` runs every built-in scenario in order. To run a smaller deterministic
set, repeat `--scenario <id>`:

```sh
node ./scripts/qa-project-scenarios.mjs \
  --cdp-url http://127.0.0.1:9222 \
  --target-url localhost:1420 \
  --scenario invoices-php-request-completion \
  --scenario invoices-blade-route-definition
```

For a raw Tauri WebView DevTools snippet without the grouped manual guide, print
an in-page snippet and run it in the console:

```sh
node ./scripts/qa-project-scenarios.mjs \
  --all \
  --print-snippet
```

`--print-snippet` also accepts repeated `--scenario` flags for a subset. The
CLI intentionally requires either `--all` or at least one `--scenario` so real
project smoke checks are explicit.

Each scenario opens the expected root when `openWorkspaceRoot(path)` is
available, opens the expected file when `openWorkspaceFile(path)` is available,
guards the workspace/project context and active file, sets the cursor from an
anchor, then calls either `getCompletionItems()` or `triggerDefinition()`
through the bridge. Older bridges keep the manual active-workspace and
active-file checks so mismatch errors still tell you which project tab to open.

The CDP runner prints one block per scenario with:

- `PASS` or `FAIL`
- scenario action
- source active file
- expected labels or definition target
- actual labels or active file
- error detail when a scenario fails

The final summary reports passed and failed counts. Any failed scenario sets a
non-zero process exit code.
