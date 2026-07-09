# Dev QA Harness

`scripts/qa-project-scenarios.mjs` is a small deterministic harness for real
project editor checks. It calls the dev-only `window.__codevoQa` bridge directly
and avoids pixel/token click automation.

## Current Scope

The harness runs deterministic checks against real project files. When the
dev-only bridge exposes `window.__codevoQa.openWorkspaceFile(path)`, each
scenario opens its target file before setting the cursor and calling provider
APIs. Older bridge builds are still supported: without `openWorkspaceFile`, the
harness keeps the previous behavior and verifies that the current active editor
tab already matches the scenario file. Run each scenario from the matching
workspace/project tab. When the bridge exposes `getWorkspaceRoot()`, the harness
requires it to match the scenario `projectRoot`; until then it verifies the
active editor file is under that project root.

Built-in project roots:

- `/Users/matusmockor/Developer/invoices`
- `/Users/matusmockor/Developer/Efabrica/boxes/ebox-crm`

List scenarios:

```sh
node ./scripts/qa-project-scenarios.mjs --list
```

## Running

Start the app with the bridge enabled:

```sh
npm run debug:qa
```

If the app is available through a Chrome DevTools Protocol endpoint, run:

```sh
node ./scripts/qa-project-scenarios.mjs \
  --cdp-url http://127.0.0.1:9222 \
  --target-url localhost:1420 \
  --scenario invoices-php-request-completion
```

For Tauri WebView DevTools, print an in-page snippet and run it in the console:

```sh
node ./scripts/qa-project-scenarios.mjs \
  --scenario ebox-crm-latte-link-completion \
  --print-snippet
```

Each scenario opens the expected file when `openWorkspaceFile(path)` is
available, guards the workspace/project context and active file, sets the cursor
from an anchor, then calls either `getCompletionItems()` or
`triggerDefinition()` through the bridge.
