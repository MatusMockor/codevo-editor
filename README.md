# Codevo Editor

Codevo Editor is a native desktop IDE built with Tauri, React, TypeScript, Rust, and
Monaco. Its active product direction is fast everyday JavaScript, TypeScript, Node.js,
and Express development. PHP and framework-specific tooling remain supported as a
secondary capability.

The project aims for practical VS Code-like editor workflows, responsiveness, and
keyboard-driven navigation. It does not claim 1:1 VS Code parity, extension-marketplace
compatibility, universal DAP support, or remote/container parity.

Current editor-core highlights:

- Monaco editing with workspace tabs, split groups, dirty state, save, history, and
  session restore.
- JavaScript/TypeScript language-server diagnostics, completion, hover, navigation,
  references, rename, code actions, formatting, symbols, and import actions, gated by
  the exact running workspace session and advertised capability.
- Quick Open with file search, `>` commands, `@` current-file symbols, `#` workspace
  symbols, seeded handoff, `path:line[:column]`, and explicit truncation.
- Docked workspace search backed by bounded Rust disk search plus a cancellable worker
  overlay for unsaved documents.
- Package and monorepo awareness, MRU editor switching, bounded model retention,
  watcher-driven refresh, and workspace-scoped persistence.
- Node/Express workflows including package scripts, tasks, Jest/Vitest, coverage,
  launch configurations, Express routes, and a substantial single-process debugger.

Large repositories and files are handled with explicit limits, cancellation,
virtualization, workers, Rust blocking work, and truthful degraded states. A partial or
truncated result must not be presented as complete.

## Development

Install dependencies:

```sh
npm install
```

Run the web workbench:

```sh
npm run dev
```

Run the Tauri desktop app:

```sh
npm run debug
```

## Checks

The complete gate set is defined in [`CLAUDE.md`](CLAUDE.md). Common frontend checks:

```sh
npm run check
npm run lint -- --max-warnings 0
npm run build
npm run size:hotspots
npm run format:check
npm run format:check:changed
npm test -- --run
```

Rust checks run from `src-tauri` with Cargo check, tests, formatting, and Clippy.

## Planning Docs

- [Current project plan](docs/PROJECT_PLAN.md)
- [Implementation backlog](docs/IMPLEMENTATION_BACKLOG.md)
- [IDE parity inventory](docs/IDE_PARITY.md)
- [Feature implementation notes](docs/FEATURES.md)
- [Progress](docs/PROGRESS.md)
- [Architecture reviews](docs/ARCHITECTURE_REVIEWS.md)
