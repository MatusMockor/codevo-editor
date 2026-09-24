# Codevo redesign v3 - per-screen mockups (shared brief)

Base: docs/redesign/v3-monolith-clean.html is the approved direction: t3code's layout and components,
Codevo's 6-palette token system (dark + light). Every new screen MUST:

- Copy the `<style id="codevo-base">` block and the `<script id="codevo-base-js">` block from
  v3-monolith-clean.html UNCHANGED (tokens, shared components, `window.Codevo.init({states,onState})`,
  palette/theme/state URL params, window fitting, switchers). Put screen-specific CSS in
  `<style id="screen-<name>">` and screen JS separately. If a truly shared component is missing,
  implement it in the screen block and list it in your report so it can be promoted to base.
- Use the same macOS window frame, sidebar and top bar as the base screen so screens feel like
  one app (the screen's own content replaces or overlays the relevant area).
- Be VERY close to t3code (pingdotgg/t3code). Study its real source before designing:
  /tmp/t3code-research-2/apps/web/src (components/, routes/, index.css). Reference screenshots of
  the running t3code are in /tmp/v3shots/t3-*.png. Do NOT start t3code yourself (other agents run
  in parallel; port conflicts). Mirror t3code's structure, spacing, sizes, copy tone and
  interaction patterns; where t3code has no equivalent, design it in the same language.
- Minimalism rules from docs/redesign/BRIEF-v2.md still apply (no decoration, metadata on hover,
  one clean default state, other states via the switcher outside the window).
- Realistic data: Express API repo "orders-api" plus a second project "web-dashboard".
- One self-contained HTML file, no network, system fonts, inline SVG icons (lucide-like).
- Self-review in a real browser (Playwright under /tmp, not in the repo): screenshot every state
  in palette 1 dark + light (and at least one other palette), compare against the t3code
  screenshots/source, fix anything busy, misaligned, wrapping or low-contrast (AA).
- Validate HTML parse and no external http(s) resources. Write ONLY your own file.
- Report: path, t3code files you mirrored, states included, anything promoted-to-base candidates,
  differences from t3code and why.
