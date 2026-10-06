# @codevo/agent-events

Shared agent-output parsing, turn-event retention and merge policies, subagent
lifecycle, and remote transcript projection. Import public symbols from
`@codevo/agent-events`. The package has no runtime dependencies or bundled
polyfills. Editor thread state, persistence, presentation, and runner transport
remain outside the package.

## Host contract

The host must provide UTF-8 `TextEncoder` and `TextDecoder` constructors before
loading the package. The package uses `TextEncoder.encode(string)` and
`TextDecoder.decode(Uint8Array)`. Its ambient declarations describe these APIs;
they do not implement them.

Emitted JavaScript uses ES2019 syntax and requires ES2020 library capabilities:
`Map`, `Set`, `WeakMap`, `Object.entries`, `Array.prototype.flatMap`,
`String.prototype.matchAll`, ISO timestamp parsing through `Date.parse`, and
Unicode-aware regular expressions with the `u` flag and Unicode property escapes
such as `\p{Cc}`, `\p{L}`, and `\p{N}`. There is no dependency on DOM, Node,
React, React Native, Tauri, Monaco, timers, or `Intl`.

## Artifact consumption

From the editor repository root, build and pack the workspace:

```sh
npm run build -w @codevo/agent-events
npm pack -w @codevo/agent-events --pack-destination /tmp
```

Install the resulting tarball in the consuming repository:

```sh
npm install /path/to/codevo-agent-events-0.1.0.tgz
```

The artifact contains ESM JavaScript, TypeScript declarations, and source maps
under `dist/`. `exports`, `main`, and `types` point to that built entry point.
Relative specifiers include `.js` extensions, so the built artifact is consumable
by bundlers and by Node ESM.
The editor uses a TypeScript path mapping and Vite alias to consume workspace
source directly; a separate mobile repository consumes the built artifact.
Package versioning is independent of the editor. A distribution channel has not
been selected, and there is no publish workflow.

## Hermes integration smoke test

Hermes support for `TextEncoder`, `TextDecoder`, `matchAll`, and Unicode property
escapes has not been verified for the consuming app's runtime version. Test the
actual Hermes device or simulator before building features on this package.
Unsupported Unicode property escapes can fail when a module loads.

Copy `src/agentOutput/fixtures/claude-first-turn.jsonl` and
`src/agentOutput/fixtures/codex-first-turn.jsonl` from this workspace into the
mobile app's test assets. Fixtures are not included in the packed artifact.
For each fixture:

- Import the package after installing required host polyfills at app entry.
- Create parser state with `createAgentOutputParserState("claude")` or
  `createAgentOutputParserState("codex")`.
- Feed the fixture string through `feedAgentOutput(state, "stdout", chunk)`,
  carrying each returned state into the next call, then call `finishAgentOutput`.
- Compare the events and session IDs with the same fixture run on the editor.
  Repeat with multiple chunk boundaries, including within lines, to exercise
  incremental parsing and UTF-8 handling.

If `TextDecoder` or another required API is missing, the mobile app owns installing
a compatible polyfill before package import. The package remains polyfill-free.

## Workspace tests

Three layers enforce the package boundary:

- The compiler configuration rejects DOM and Node types.
- The ESLint block restricts a fixed list of imports and globals.
- The boundary test rejects any non-relative import, extra declaration files,
  triple-slash reference directives, and dynamic imports. It also requires `.js`
  extensions and verifies that relative imports resolve inside the package.

Run tests from the editor repository root:

```sh
npx vitest run packages/agent-events
```

`codexAppServer.test.ts` and `toolArgumentRedaction.test.ts` read shared Rust
fixtures under `src-tauri/tests/fixtures` relative to `process.cwd()`. The parser
fixture tests also resolve their workspace fixture directory from that working
directory. These tests therefore require the editor checkout and repository-root
working directory; they are not standalone artifact tests. Production code does
not access fixtures or the filesystem.
