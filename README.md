# Codevo Editor

A native desktop IDE with an integrated agent workspace for **JavaScript,
TypeScript, Node.js, and Express** development.

Codevo brings together a Monaco-based editor, language tooling, a Node debugger,
and project-scoped conversations with Claude Code and Codex. Edit code yourself,
work with an agent in a local checkout or isolated Git worktree, then review and
commit the changes in the same app.

Built with **Tauri 2 · React · TypeScript · Rust · Monaco**.

[Download macOS beta](https://github.com/MatusMockor/codevo-editor/releases) ·
[Agent guide](docs/agent-mode.md) ·
[Remote runner setup](docs/remote-runner-editor.md) ·
[Changelog](CHANGELOG.md)

## What you can do

### Edit and navigate

- Work across multiple projects, editor tabs, and split groups, with unsaved-change
  tracking, local history, and session restore.
- Use JavaScript/TypeScript diagnostics, completion, hover, go to definition,
  references, rename, code actions, formatting, and symbols through the language
  server.
- Jump to files, commands, symbols, or `path:line:column` with Quick Open.
- Search across a workspace, including supported searches in unsaved documents.
- Use integrated terminals, Git diffs, Source Control, and repository history.

### Run, test, and debug

- Discover package scripts and work with package and monorepo structure.
- Run tasks and Jest/Vitest tests, inspect coverage, and navigate Problems.
- Debug Node.js with launch configurations, breakpoints, stepping, call stacks,
  scopes, variables, Watch, and the Debug Console.
- Explore Express routes alongside the code that implements them.

### Work with agents

- Run **Claude Code or Codex** in saved, project-scoped conversations.
- Choose the project's local checkout or an isolated Git worktree for a task.
- Review files, diffs, terminal output, and history from the agent workspace.
- Commit and push thread changes, then integrate completed worktrees into the main
  checkout.
- Pin, search, rename, and archive conversations, and inspect locally recorded
  usage metrics.
- Connect to an existing **Linux Codevo Runner over SSH** to run agent tasks on
  registered server projects and inspect their output and diffs.

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
runtime and tools your project needs before running its scripts, tests, or agents.

## Scope and current limits

The priority is practical everyday JavaScript/TypeScript and Node/Express work.
PHP and framework-specific tooling remain secondary capabilities.

- Language features depend on the running language server and its advertised
  capabilities.
- The Node debugger focuses on single-process workflows; arbitrary debug adapters
  and full VS Code debugger parity are outside the current scope.
- Codevo does not support the VS Code extension marketplace or claim full
  remote-development or container parity. Remote agent execution has its own
  [supported workflows and prerequisites](docs/remote-runner-editor.md).
- Large files, repositories, and result sets have explicit resource limits. Some
  features reduce their scope or report partial results to keep editing responsive.
- Agent usage is derived from conversations retained on this device; it is not an
  account billing or cost report.

The [IDE parity inventory](docs/IDE_PARITY.md) tracks editor capabilities and gaps
in more detail.

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
