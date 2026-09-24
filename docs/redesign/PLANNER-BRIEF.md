# Planner brief for redesign phases P3-P9 (shared)

You write ONE implementation plan (not code) for one phase of the Codevo redesign.

Read first:
- CLAUDE.md (repo rules), the spec `docs/superpowers/specs/2026-09-23-codevo-redesign-design.md`
  (scope §3, architecture §4, phases §5, testing §6, decisions §7).
- The approved mockups for your phase in `docs/redesign/` (v3-*.html) and `BRIEF-v3-screens.md`.
- Committed P0/P1 code: tokens `src/ui/tokens/**` (`--cv-*`), foundation components
  `src/ui/foundation/**`, appearance `src/domain/appearance.ts`.
- The P2 app-shell plan `docs/superpowers/plans/2026-09-24-redesign-p2-app-shell.md` once it exists
  (it is being written in parallel; poll for it, and assume the shell from the spec + mockups until
  then). Your phase renders INSIDE that shell; do not redesign the shell.
- t3code reference source `/tmp/t3code-research-2/apps/web/src` (clone with
  `git clone --depth 1 https://github.com/pingdotgg/t3code /tmp/t3code-research-2` if missing).

Format: follow the writing-plans skill exactly
(`/Users/matusmockor/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1/skills/writing-plans/SKILL.md`):
header with Global Constraints and Review Focus, File Structure, tasks with Files/Interfaces, bite-sized
TDD steps with REAL code and exact commands, no placeholders, self-review. Map the current code for your
surfaces first; plan extractions instead of growing hotspot files (`npm run size:hotspots`).

Parallel execution: phases P3-P6 will be implemented at the same time, P7-P9 after their dependencies.
Your plan MUST contain an "Ownership" section listing every file your phase creates or modifies.
Coordinate ownership with the sibling planners: use ListAgents to find them and SendMessage to agree who
owns a contested file (for example `AgentThreadSession.tsx`, `AgentModeView.tsx`,
`AgentWorkbenchScreen.tsx`, `useAgentThreads.ts`, `agentThread.ts`, `App.tsx`). Prefer one owner plus
small, well-defined hunks by others, or extracting a new module so both can work without collisions.
Record the agreements in your plan.

Wrap-up tasks in every plan: full gates (exact commands from CLAUDE.md), independent read-only Opus
review, QA build (`npx tauri build --debug --bundles app --config '{"identifier":"dev.mockor.editor.qa","productName":"Codevo QA"}'`,
then `open` it and `osascript -e 'tell application "Codevo QA" to activate'`), Codex computer-use QA via
`~/tmp/codevo-qa/qa_orchestrator_v2.py` with a concrete prompt (window frontmost before every screenshot,
ATTACH ONLY, never touch "Codevo Editor"), commit to main with no AI attribution, no push, no tag.

Read-only: write only your plan file; no git mutations; do not modify source files.
Report: plan path, current-code summary, key decisions, ownership agreements, task list, open risks.
