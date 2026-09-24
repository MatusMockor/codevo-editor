# Codevo redesign - brief v2 (t3code minimalism)

Round 1 failed: all three directions were too busy (every feature on one screen plus decorative
signature motifs). The owner wants **t3code as it is** - its structure, density, calmness and
restraint - with Codevo's own identity expressed ONLY through details (type, a single accent,
proportions, radius, motion), never through extra elements or decoration.

## Mandatory study first
Before designing, study t3code's real UI source in /tmp/t3code-research-2/apps/web/src
(clone with `git clone --depth 1 https://github.com/pingdotgg/t3code /tmp/t3code-research-2` if
missing): `index.css` (tokens, colors, radius, fonts), `components/Sidebar.tsx`,
`components/ChatView.tsx`, `components/chat/MessagesTimeline.tsx`, `components/chat/ChatComposer.tsx`,
`components/chat/ContextWindowMeter.tsx`, `components/DiffPanel.tsx`. Match its layout proportions,
spacing, font sizes, row heights, how little chrome it shows, how work rows/thought rows/agent rows
look, how the composer looks, how the sidebar looks. Extract concrete numbers and reuse them.

## Hard minimalism rules
- Default screen shows ONLY: left sidebar (projects + threads), the conversation, the composer.
  Right panel CLOSED by default. No status bar. No token/time readouts in the transcript.
- One thread with 2 normal turns: a user prompt, a collapsed work row ("Ran 3 commands"), a short
  assistant markdown answer with one code block and one file link, and a compact changes summary
  row ("3 files changed +42 -7", click opens the diff panel).
- Metadata (time, model, duration) appears only on hover.
- No decorative motifs, no gradients, no glows, no textures, no grids, no numbered sections,
  no marginalia, no pulse lines. Borders only where t3code has them.
- Every other state is shown ONLY via a small floating "States" switcher at the very bottom-right
  OUTSIDE the app window (part of the mockup page, not the app): Default / Running (live
  "Thinking" row + Stop) / Approval request / Background agents ("Waiting for 2 agents" + composer
  banner) / Queued message with attachment (edit) / Diff panel open / Empty new thread. Each state
  replaces only the relevant bit of the default screen.
- Dark theme is primary; light theme via a toggle placed next to the States switcher (outside the
  app window). Both themes designed properly.
- Realistic data: Express API repo "orders-api".

## Mockup file rules
- ONE self-contained HTML file, inline CSS/JS, no network, system fonts only
  (-apple-system / SF Pro, ui-monospace / SF Mono), inline SVG icons (lucide-like, 1.5px stroke,
  like t3code).
- macOS window framing ~1440x900 with traffic lights.
- WCAG AA text contrast, visible focus rings, prefers-reduced-motion respected.
- Before finishing: render it in a real browser (Playwright chromium or webkit installed under
  /tmp, not in the repo), screenshot default dark, default light and each state, look at the
  screenshots critically against the rules above and against t3code, and fix anything busy,
  misaligned or wrapping. Remove anything that is not strictly needed.
