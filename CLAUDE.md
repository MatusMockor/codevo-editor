# Codevo Editor — Project Instructions

These project rules take precedence over the global `~/.claude/CLAUDE.md` where they conflict.

## Code Review
- DO NOT use CodeRabbit in this project. Never run `coderabbit` / `cr` (e.g. `coderabbit review --agent --base main`). This intentionally OVERRIDES the global "always run coderabbit review" rule.
- After finishing a slice, delegate code review to a separate AI subagent (read-only) and address findings before committing.

## Workflow
- Work in small, isolated slices with a clear write-scope. Use TDD (failing test first), then an independent subagent review, then commit + push to `main` (project convention — direct commits to main are expected here).
- Commit messages: no `Co-Authored-By`, no AI/Anthropic/Claude attribution (per global rules).

## Architecture — per-project isolation is critical
- Everything must be isolated per open project/workspace tab. No runtime processes, LSP requests/responses/events, indexes, diagnostics, completions, file watchers, or terminals may leak between open project tabs.
- In any async flow, capture the requested workspace root up front and re-check the active root/session AFTER each `await` before mutating shared state (drop stale results). Preserve these guards in every change.

## Modes
- Light mode (JS/TS) targets VS Code parity; IDE mode (PHP/Laravel) targets PhpStorm parity. Generic PHP/PHP8 is delegated to the managed phpactor LSP; the TS domain layer handles Laravel "magic" + phpactor false-positive suppression.
