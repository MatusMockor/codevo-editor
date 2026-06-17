# Modern UI redesign — „Calm" direction

**Date:** 2026-06-17
**Status:** Approved (visual direction & components validated via brainstorming companion)
**Scope:** Full visual modernization of the workbench chrome — visual language, typography & density, components, and motion. CSS-led, minimal JSX changes. No layout restructuring, no new dependencies.

> Note: per the user instruction "nič nekomituj", nothing in this effort is committed to git. This spec file is written but **not** committed.

## 1. Goal

Make the editor feel modern and premium while staying calm and distraction-free. The chosen aesthetic is **Calm**: low chroma, generous whitespace, flat surfaces separated by hairline dividers, a single muted accent per theme, and subtle motion. The change must read as a real structural refresh (shape, spacing, behavior) — not a recolor.

## 2. Validated decisions (from brainstorming)

- **Direction:** Calm — flat surfaces, hairline dividers, soft accent, lots of air.
- **Components approved:** editor tabs, activity bar, file rows, status bar (all four `before → after` mockups accepted).
- **Toggles:** keep the toggle metaphor (not segmented control). Use **Variant A** — label-left, compact pill, accent track + white knob when on.
- **Theme scope:** **retune all themes** (`dark`/`system`, `light`, `ayuMirage`, `materialDeepOcean`) toward the Calm aesthetic while preserving each theme's identity. Structural/shape/motion changes are theme-independent and apply to every theme automatically.

## 3. Architecture & boundaries

The work lives in two clearly separated layers:

1. **Token layer** (`:root` and per-theme `.app-shell[data-theme="…"]` blocks in `src/App.css`).
   - **Theme-independent tokens** (added once to `:root`): radius scale, motion durations/easing, elevation/shadows, and accent-derived soft tints expressed via `color-mix` so they work in every theme.
   - **Per-theme color tokens** (existing `--color-*` variables): retuned values per theme.
2. **Component layer** (component selectors in `src/App.css`, plus tiny JSX/markup tweaks where unavoidable). Each component consumes tokens only — no hard-coded colors or radii. This keeps components swappable and the themes centrally controlled.

This boundary means: changing the palette never requires touching component CSS, and changing a component's shape never requires touching a palette. Each can be understood and changed independently.

### New theme-independent tokens (in `:root`)

```
--radius-sm: 6px;      /* small controls, close buttons */
--radius-md: 9px;      /* tabs, tree rows, activity buttons, toggles */
--radius-lg: 12px;     /* modals, panels, palette */
--radius-pill: 999px;  /* toggle track */

--motion-fast: 120ms;
--motion-base: 180ms;
--ease-standard: cubic-bezier(0.4, 0, 0.2, 1);

--shadow-pop: 0 12px 40px rgba(0, 0, 0, 0.45);  /* modals/palette */

/* accent-derived, theme-agnostic */
--color-accent-soft: color-mix(in srgb, var(--color-accent) 14%, var(--color-panel));
--color-accent-bar:  var(--color-accent);
--focus-ring: 0 0 0 2px color-mix(in srgb, var(--color-accent) 55%, transparent);
```

## 4. Color retune — principles per theme

Apply the same Calm transformation to every theme, keeping identity intact:

- **Flatten surfaces:** reduce the lightness delta between `--color-app`, `--color-panel`, `--color-sidebar`, `--color-tabs`, `--color-status` so panels read as one calm field separated by hairline borders rather than stacked greys.
- **Hairline borders:** `--color-border` becomes a quiet divider; `--color-border-strong` only slightly stronger.
- **Soften the accent:** lower chroma of `--color-accent` so it guides rather than shouts. Identity preserved: `dark`/`system` → soft blue; `light` → clean muted teal/blue; `ayuMirage` → warm gold (slightly desaturated); `materialDeepOcean` → soft cyan.
- **Calmer active states:** active surfaces move to soft tints (`--color-accent-soft`) instead of hard fills; hover is a very subtle lift.

### Calm dark reference palette (validated in mockups)

```
--color-app: #16181d;          --color-panel: #16181d;
--color-panel-deep: #121419;   --color-sidebar: #16181d;
--color-tabs: #16181d;         --color-status: #16181d;
--color-modal: #1c1f26;        --color-surface: #1c1f26;   --color-control: #1c1f26;
--color-border: #23262e;       --color-border-strong: #2c303a;
--color-hover: #1d1f25;        --color-hover-strong: #20232b;
--color-accent: #8aa9c9;
--color-text-strong: #e7eaef;  --color-text: #c2c8d2;
--color-text-muted: #8b94a3;   --color-text-subtle: #5e6573;
--color-active: #1f2630;       --color-active-text: #eef1f5;   /* keep as 6-digit hex; contrast ≥ 4.5 */
--color-active-muted: #1c222b;
```

Other themes get analogous values derived from their existing palettes following the principles above. Exact hex values are chosen during implementation and validated against the contrast tests (§7).

## 5. Component specs

All components consume tokens, animate with `--motion-fast`/`--ease-standard`, and expose a keyboard `:focus-visible` ring (`--focus-ring`).

**5.1 Editor tabs** (`.editor-tabs`, `.editor-tab`, `.tab-main`, `.tab-close`, `.dirty-dot`)
- Strip: ~44px tall, `padding: 0 10px`, `gap: 5px`, items aligned to bottom, canvas background, single bottom hairline. Remove per-tab right borders.
- Tab: `border-radius: var(--radius-md) var(--radius-md) 0 0`, ~34px tall, transparent background, muted text.
- Hover: `--color-hover` background, text → `--color-text`.
- Active: `--color-accent-soft` background, `--color-text-strong`, accent underline via `box-shadow: inset 0 -2px 0 var(--color-accent)`.
- Close (`×`): `--radius-sm` ghost button, `opacity: 0` by default, revealed on tab hover and when active; dirty tabs show the warning dot and hide `×` until hover.
- Preview tabs keep italic label.

**5.2 Sidebar view tabs** (`.sidebar-tab`, Files/Git/PHP)
- Convert from bordered buttons to quiet underline tabs to match editor tabs: transparent, muted text; active = `--color-text-strong` + 2px accent underline. Removes the boxed look.

**5.3 File / Git / PHP tree rows** (`.tree-row`, and the `.git-changes`/`.php-tree` rows)
- Row height ~30–32px, inset with `margin: 1px 8px`, `border-radius: var(--radius-md)`.
- Hover: subtle `--color-hover`.
- Active: `--color-accent-soft` tint with `--color-active-text`, replacing the hard `--color-active` fill block. Indent guides stay; spacing gets a touch more air.

**5.4 Activity bar** (`.activity-bar`, buttons)
- Buttons → `--radius-md`, consistent 32–34px hit targets, refined hover (`--color-hover` + `--color-text-strong`). These are one-shot actions (Open / Commands / Settings), so **no persistent active indicator** — only hover/`:focus-visible`/pressed feedback.

**5.5 Toolbar toggles** (`.smart-mode-switch`, `.toolbar-toggle`, `.switch-track`, `.switch-thumb`) — **Variant A**
- Container: label-left pill, `--radius-md`, `--color-control` background, hairline border, muted label.
- Track: 34×19 rounded, `--color-border-strong` off → `--color-accent` on; knob 14px, `--color-text-muted` off → white on, slides with `--motion-fast`.
- "On"/"Off" `<strong>` text becomes optional/subtle; state is read primarily from the track. Achievable by restyling existing markup (track + thumb already exist) — no structural JSX change required.

**5.6 Status bar** (`.status-bar`, `.status-bar span`, `.status-message`)
- Height ~28px, canvas background, top hairline. Items become segments separated by hairline dividers (`border-right`), comfortable `padding`. Key state (branch) highlighted with `--color-accent`. Branch shown with a `⎇`-style affixed label.

**5.7 Command, file & structure palettes** (`.palette-backdrop`, `.command-palette`, `.quick-open`, `.text-search`, `.file-structure`, `.implementation-chooser`, `.settings-dialog`, `.language-server-setup`)
- **Container:** `--radius-lg`, `--shadow-pop`, hairline border, calmer backdrop (slightly higher blur/opacity).
- **Search input** (`.palette-search` / input): keep the comfortable ~46px field; hairline underline divider, accent text caret, label/placeholder in subtle text.
- **Result rows** (`.palette-command`, `.quick-open-result`, `.text-search-result`, `.implementation-choice`): `--radius-md`; hover = `--color-hover`; **active/selected = `--color-accent-soft` tint** (replacing the current hard `--color-hover-strong` fill) with `--color-text-strong` title. The existing leading icon (`FileCode2` in Quick Open, `ListTree` in Structure, etc.) in `--color-text-muted` (→ accent when active); secondary path / metadata in `--color-text-subtle`. Consistent vertical rhythm across all palette families.
- **Matched-character highlighting is NOT in scope here:** the app palettes render the whole label as `<strong>` and do not split the matched substring today. Adding per-character match highlighting would be behavior/logic work (excluded by §8). Match-accent applies only to the Monaco suggest widget (§5.8), where Monaco emits `.highlight` spans natively — styling them is pure CSS/theme.
- **Structure palette specifics** (`.file-structure`, `.file-structure-option`): the "Include inherited members" row stays as a single clean functional checkbox (accent `accent-color`, hairline divider). Member rows have **no leading checkbox/radio-style control** — just the member name + kind label (`property` / `method · Class:line`) in subtle text, using the same row treatment as quick-open.

**5.8 Monaco widgets** — suggest / parameter hints / hover (`src/components/monacoThemes.ts`, optional `App.css`)
- The autocomplete popup is rendered by **Monaco itself**, not the app overlays, so it is themed through the Monaco `colors` map (currently no `editorSuggestWidget.*` keys are set, so it falls back to Monaco defaults that don't match the Calm chrome).
- Add per theme: `editorSuggestWidget.background` (Calm canvas), `.border` (hairline), `.foreground`, `.selectedBackground` (soft-tint, matching palette rows), `.selectedForeground`, `.highlightForeground` + `.focusHighlightForeground` (matched chars → accent); plus `editorWidget.background`/`editorWidget.border`, `editorHoverWidget.background`/`.border`, and `input.background`/`input.border`/`focusBorder` so the suggest, parameter-hint, and hover widgets all read as part of the same calm surface.
- Optional `App.css` override on `.monaco-editor .suggest-widget` for `--radius-md` + `--shadow-pop` to round the popup and align elevation. Verify Monaco honors it; fall back to defaults if it fights internal layout.

## 6. Motion & interactions

- Transition `background-color`, `color`, `box-shadow`, `transform` on interactive elements using `--motion-fast` / `--ease-standard`.
- Toggle knob/track transition on `--motion-fast`.
- Keyboard accessibility: `:focus-visible { box-shadow: var(--focus-ring); }` on tabs, rows, buttons, toggles, inputs.
- `@media (prefers-reduced-motion: reduce)`: disable/limit transitions globally.

## 7. Testing & verification

- **Existing tests must stay green.** In particular `src/domain/themeContrast.test.ts`:
  - `--color-active` vs `--color-active-text` ≥ 4.5 for `:root`, `light`, `system`, `ayuMirage`, `materialDeepOcean`. Keep both as 6-digit hex (the test parses hex from CSS). Where active states render as soft tints, set `--color-active` to the **effective composited** color so the guarantee and the test both hold.
  - Terminal ANSI palette (`terminalThemeForAppTheme`) text colors keep ≥ 4.5 vs background — retune terminal colors only if needed and re-validate.
- **Monaco alignment:** `src/components/monacoThemes.ts` editor backgrounds track the new per-theme canvas, and the new `editorSuggestWidget.*` / `editorWidget.*` / `editorHoverWidget.*` / `input.*` keys (§5.8) are added per theme so the completion/hover widgets match the chrome. Keep `monacoThemes.test.ts` green and extend it to assert the new widget keys exist per theme.
- **New assertions:** extend the contrast/token tests to cover the new active-tint colors and assert presence of the new core tokens (radius/motion/accent-soft) so the design system can't silently regress.
- **Gates:** `npm run check`, `npm test`, `npm run build` all pass.
- **Manual:** run the app (vite dev / `npm run tauri dev`) and visually confirm each theme across tabs, sidebar, tree, toolbar toggles, status bar, and an open Monaco file.

## 8. Out of scope (YAGNI)

- No new theme (we retune existing ones; no 5th "Calm" theme).
- No layout/grid restructuring (activity bar → sidebar → workbench → status bar stays).
- No Monaco syntax token recoloring beyond background/canvas alignment.
- No new dependencies or build changes.
- No feature/behavior changes — visual & interaction polish only.

## 9. Risks

- **Contrast regressions** when softening palettes — mitigated by the contrast test suite gating every theme.
- **Flat surfaces losing hierarchy** — mitigated by hairline borders and the soft-tint active states carrying the structure instead of background steps.
- **Theme identity drift** when retuning all four — mitigated by preserving each theme's hue/accent character and only lowering chroma / flattening deltas.
