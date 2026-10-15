# Codevo Editor

A native desktop app for running coding agents against your projects.

Codevo runs project-scoped conversations with **Claude Code and Codex**. Start an
agent in a local checkout or an isolated Git worktree, follow its work as it
streams, then review the diff, commit, push, and integrate the changes in the same
app.

Built with **Tauri 2 · React · TypeScript · Rust**.

[Download macOS beta](https://github.com/MatusMockor/codevo-editor/releases) ·
[Agent guide](docs/agent-mode.md) ·
[Remote runner setup](docs/remote-runner-editor.md) ·
[Changelog](CHANGELOG.md)

## What you can do

### Work with agents

- Run **Claude Code or Codex** in saved, project-scoped conversations across
  multiple projects.
- Choose the project's local checkout or an isolated Git worktree for a task.
- Follow streaming transcripts, answer approvals and questions, and get notified
  when a thread finishes or needs input.
- Pin, search, rename, and archive conversations, and inspect locally recorded
  usage metrics.

### Review and ship

- Use the right panel next to a thread: terminal, a read-only Files viewer, diff,
  Git, package scripts, pull request, history, and agents.
- Commit and push thread changes, then integrate completed worktrees into the main
  checkout.

### Configure and connect

- Set up providers, sign-in, MCP servers, and settings from **Settings**.
- Connect to an existing **Linux Codevo Runner over SSH** to run agent tasks on
  registered server projects and inspect their output, files, and diffs.
- Receive app updates from the beta channel.

See the [Agent Mode guide](docs/agent-mode.md) for provider setup, permissions,
checkout choices, and the review workflow. Remote execution requires a separately
configured runner; follow the [remote runner guide](docs/remote-runner-editor.md).

## Install the beta

Codevo is under active development. Published desktop builds currently target
**macOS on Apple Silicon**; Windows and Linux desktop releases are not available.

1. Open [Releases](https://github.com/MatusMockor/codevo-editor/releases) and choose
   a versioned beta release.
2. Download its `.dmg`, open it, and copy **Codevo Editor.app** to Applications.
3. Launch Codevo and open a project folder.

Builds labelled **unsigned** are not Apple Developer ID signed or notarized, and
macOS Gatekeeper may block them. Check the release notes for the build's signing
status. The `beta` channel release contains updater metadata; use a versioned
release for the installer.

For agent workflows, install and authenticate the Claude Code or Codex CLI you
want to use. **Settings > Agents** discovers installed providers and offers sign-in
and setup guidance. Trust the project before starting an agent or running its code.

## Run from source

For desktop development on macOS, install:

- **Node.js 24 or 26** and npm, matching the versions used in CI.
- **Rust stable** and Cargo.
- **Xcode Command Line Tools** for the native build.
- **Git** for repository and worktree workflows.

```sh
git clone https://github.com/MatusMockor/codevo-editor.git
cd codevo-editor
npm ci
npm run debug
```

Useful development commands:

| Command                | Purpose                                                                 |
| ---------------------- | ----------------------------------------------------------------------- |
| `npm run debug`        | Build and launch the desktop app in debug mode.                         |
| `npm run dev`          | Start the frontend in a browser; native desktop services require Tauri. |
| `npm run build`        | Type-check and build the frontend, including its bundle-size check.     |
| `npm run debug:build`  | Build the desktop app in debug mode without an installer.               |
| `npm run debug:bundle` | Build a debug desktop bundle.                                           |

Agent CLIs and project-specific runtimes are separate dependencies. Install the
runtime and tools your project needs before running its scripts or agents.

## Scope and current limits

Codevo is an agent app, not an IDE. There is no code editor, language server
integration, Problems view, or test explorer; edit code through the agents or in
your own editor.

- There is no interactive debugger (no launch configurations, breakpoints, or
  Debug Console); debugging is done through the agents.
- Codevo does not claim remote-development or container support. Remote agent
  execution has its own
  [supported workflows and prerequisites](docs/remote-runner-editor.md).
- Large transcripts, files, diffs, repositories, and result sets have explicit
  resource limits. Some features reduce their scope or report partial results to
  keep the app responsive.
- Agent usage is derived from conversations retained on this device; it is not an
  account billing or cost report.

## Contributing and documentation

Read [`CLAUDE.md`](CLAUDE.md) before changing the repository. It defines the
architecture, workspace isolation rules, review process, and complete validation
gates. [`AGENTS.md`](AGENTS.md) points coding agents to those same instructions.

Common frontend checks:

```sh
npm run check
npm run lint -- --max-warnings 0
npm run lint:exhaustive-deps
npm run build
npm run size:hotspots
npm run format:check
npm run format:check:changed
npm test -- --run
```

The full gate set also includes Rust compilation, tests, formatting, and Clippy;
see [`CLAUDE.md`](CLAUDE.md) for the exact commands.

- [Agent Mode](docs/agent-mode.md) — conversations, providers, worktrees, and shipping.
- [Remote runner](docs/remote-runner-editor.md) — SSH setup and server workflows.
- [Development QA](docs/DEV_QA.md) — desktop checks and test scenarios.
- [Release process](docs/release.md) — packaging, signing, and updates.
- [Project plan](docs/PROJECT_PLAN.md) and [backlog](docs/IMPLEMENTATION_BACKLOG.md).
- [Feature implementation notes](docs/FEATURES.md) and [architecture reviews](docs/ARCHITECTURE_REVIEWS.md).
