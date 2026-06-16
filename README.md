# Mockor Editor

A lightweight Fleet-like desktop code editor built with Tauri, React, TypeScript, Rust, and Monaco.

The project is designed around three modes:

- Basic: local editing without project intelligence.
- Light Smart: language-server features for opened files.
- Full Smart: background indexing, PHP tree, workspace symbols, and richer project intelligence.

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
npm run tauri dev
```

## Checks

```sh
npm run check
npm test
npm run build
cd src-tauri && cargo test
```

Build a debug macOS app bundle:

```sh
npm run tauri build -- --debug --bundles app
```

Full DMG bundling is deferred to the packaging phase.

## Planning Docs

- [Project plan](docs/PROJECT_PLAN.md)
- [Implementation backlog](docs/IMPLEMENTATION_BACKLOG.md)
- [Architecture reviews](docs/ARCHITECTURE_REVIEWS.md)
- [Progress](docs/PROGRESS.md)
