# Mockor Editor

A lightweight Fleet-like desktop code editor built with Tauri, React, TypeScript, Rust, and Monaco.

The project is designed around three intelligence layers:

- Editor Mode: local editing without project index or language-server services.
- Smart Index: workspace indexing, PHP tree, and indexed symbol navigation.
- IDE Mode: Smart Index plus language-server services for diagnostics and richer navigation.

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

Build debug macOS app and DMG bundles:

```sh
npm run tauri build -- --debug
```

Use `npm run tauri build -- --debug --bundles app` for a faster app-only bundle.

## Planning Docs

- [Project plan](docs/PROJECT_PLAN.md)
- [Implementation backlog](docs/IMPLEMENTATION_BACKLOG.md)
- [Architecture reviews](docs/ARCHITECTURE_REVIEWS.md)
- [Progress](docs/PROGRESS.md)
