# Codevo redesign - design brief (exploration phase)

Codevo is a native macOS desktop IDE (Tauri + React) whose home screen is the AGENT MODE: a
conversation with a coding agent (Claude Code / Codex) in the center; editor, diff, terminal,
files, git and scripts are panels around it. Priority workflow: everyday JavaScript/TypeScript,
Node.js and Express development with agents.

Goals chosen by the owner:
- Clean minimalism in the spirit of t3code (pingdotgg/t3code): calm, content-first, almost no
  chrome, controls revealed on hover/focus, one clear hierarchy.
- A distinctive own identity - it must NOT look like a generic shadcn/Tailwind/VS Code clone.
- Agent-first layout: the conversation is the hero.

Main screen content to show (use realistic data from a real JS/TS project, e.g. an Express API
repo "orders-api"):
- Left rail/sidebar: projects and threads grouped (Pinned / Active / Settled), each thread row
  with title, project, relative time, status (running / waiting for 2 agents / needs approval /
  done / unread), search, new thread.
- Center transcript of one thread:
  - user prompt bubble (one with an image attachment chip),
  - assistant turn head (provider + model + effort + time),
  - a collapsed work group "Ran 4 commands" with an expanded variant showing tool rows
    (command, read file, edit file with +/- counts) and an interleaved reasoning row
    ("Thought" with brain icon + one-line preview + chevron),
  - a subagent batch row "Kicked off 2 subagents" with member rows (role chip, status,
    duration · tokens, first activity line),
  - assistant markdown answer with inline code, a code block, and a local file link
    `src/routes/orders.ts:42`,
  - recorded turn changes card (3 files: added/modified with +/- counts, click opens diff),
  - an approval request card (command needing approval: Approve / Deny),
  - a "Waiting for 2 agents" state with the lead's final answer visible.
- Composer at bottom: multiline input, attachment chip, model picker (Claude Opus 5.5 / effort),
  access mode (Full access / Ask), environment (Local checkout / Worktree), send / queue,
  a queued message above it (Queued · 1 attachment, edit/send-now/remove), and a background
  banner "2 agents working · Stop".
- Right panel (collapsible) with tabs Files / Diff / Terminal / Git: show the Diff tab with a
  side-by-side or unified diff of `src/routes/orders.ts`.
- Top bar: breadcrumb project / thread title, run scripts, open, commit, panel toggles.
- Bottom status bar: minimal (branch, running threads, model, CLI version).

Hard requirements for the mockup file:
- ONE self-contained HTML file: inline CSS and JS only, no network, no external fonts/assets
  (use system font stacks: -apple-system/SF Pro, "SF Mono"/ui-monospace; icons as inline SVG).
- Desktop window framing ~1440x900 with macOS traffic-light title area.
- Dark AND light theme with a visible toggle (both must be designed, not inverted).
- A compact "design tokens" strip/section (colors, type scale, spacing, radius, motion) at the
  top or reachable via a tab, so the system is inspectable.
- Interactivity: expand/collapse the work group, thought row, subagent batch; switch right-panel
  tabs; toggle panel; hover states; theme toggle. Use CSS transitions sparingly and respect
  prefers-reduced-motion.
- Accessible contrast (WCAG AA for text), visible focus rings.
- Text in English (UI copy), realistic and concise.
