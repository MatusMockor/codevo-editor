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

## Picking the right models for workflows and subagents

Rankings, higher = better. Cost reflects what I actually pay (OpenAI has really generous limits), not list price. Intelligence is how hard a problem you can hand the model unsupervised. Taste covers UI/UX, code quality, API design, and copy.

| model    | cost | intelligence | taste |
|----------|------|--------------|-------|
| gpt-5.5  | 9    | 8            | 5     |
| sonnet-5 | 5    | 5            | 7     |
| opus-4.8 | 4    | 7            | 8     |
| fable-5  | 2    | 9            | 9     |

How to apply:
- These are defaults, not limits. You have standing permission to override them: if a cheaper model's output doesn't meet the bar, rerun or redo the work with a smarter model without asking. Judge the output, not the price tag. Escalating costs less than shipping mediocre work.
- Cost is a tie-breaker only; when axes conflict for anything that ships, intelligence > taste > cost.
- Bulk/mechanical work (clear-spec implementation, test scaffolding, fixture generation, data analysis): gpt-5.5 - it's effectively free.
- Anything user-facing (UI/UX, palettes, popups, themes, copy) needs taste >= 7.
- PHP parser/refactor features, cross-file edits, and per-project isolation changes need intelligence >= 7 (corruption/leak risk) AND a mandatory independent adversarial review on a different agent than the implementer.
- Reviews of plans/implementations: fable-5 or opus-4.8, optionally gpt-5.5 (`codex review`) as an extra independent perspective. sonnet-5 reviews are acceptable for scoped slices but escalate when the slice touches parsers, async isolation, or process lifecycle.
- Never use Haiku.
- Mechanics: gpt-5.5 is only reachable through the Codex CLI - `codex exec` / `codex review` (or the codex plugin skills). Claude models (sonnet-5, opus-4.8, fable-5) run via the Agent/Workflow `model` parameter.
- Orchestrator pattern (this project's default): the main agent stays on fable-5 and only delegates - implementation, review, and fixes all run as subagents. Subagent prompts must forbid the subagent from invoking codex/coderabbit itself; model routing is the orchestrator's decision, made once per slice.

Using gpt-5.5 inside workflows and subagents (the `model` parameter only takes Claude models, so use a wrapper):
- Spawn a thin Claude wrapper agent with `model: 'sonnet', effort: 'low'` whose prompt instructs it to write a self-contained codex prompt, run `codex exec` via Bash, and return the result verbatim.

(SOLID, design patterns without over-engineering, guard clauses / no else-chains, small focused units, and "do not mock internal dependencies in tests" all still apply per the global instructions.)
