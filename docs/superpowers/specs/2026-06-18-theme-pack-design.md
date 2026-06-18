# Theme pack — match Ayu/Deep Ocean + add five themes

**Date:** 2026-06-18
**Status:** Approved approach (visual selection done); spec for review.
**Scope:** Re-tune two existing themes to their canonical palettes and add five complete themes. Every theme must color **all** app surfaces — not just the editor. Data/registration only; no behavior or layout changes.

## 1. Goal

Make the editor's themes look authentic and complete. Two existing themes (Ayu Mirage, Material Deep Ocean) currently use coarse 7-token syntax and approximate chrome; bring them to the canonical **Material Theme / Ayu** palettes. Add five new themes — **One Dark Pro, Dracula, Catppuccin Mocha, Catppuccin Latte, One Light** — each fully themed across syntax and every UI surface.

## 2. Surfaces every theme must cover ("everything")

A theme is only done when all of these read correctly in it:

| Surface | Where its colors come from |
| --- | --- |
| Editor background, gutter, line numbers, selection, current line | Monaco theme `colors` |
| **Syntax** (keywords, types/classes, functions/methods, variables, params, properties, strings, numbers, comments, operators, namespaces, constants, regex) | Monaco theme `rules` — Monarch token types **and** LSP semantic token types |
| **Code-completion popup** (method/property proposals + icons), **hover** popup, **parameter hints** | Monaco `colors`: `editorSuggestWidget.*`, `editorHoverWidget.*`, `editorWidget.*`, `input.*`, `focusBorder` |
| **Git diff** preview (Monaco diff editor) | Monaco `colors`: `diffEditor.insertedTextBackground` / `removedTextBackground` / inserted/removed line backgrounds, aligned to `--change-*` |
| **Git panel** + git statuses in file tree (A/M/D badges) | App.css `--change-added/deleted/modified` (+ `-soft` / `-strong`) per theme |
| **Command palette, Quick Open, Structure palette, Text search, Implementation chooser, Settings dialog, Language-server setup** | App.css `--color-*` tokens (containers, rows, inputs, active row) |
| Activity bar, sidebar tabs, file/git/php tree, editor tabs, toolbar toggles, status bar, scrollbars, focus ring | App.css `--color-*` tokens |
| **Terminal** | `terminalThemeForAppTheme` ANSI palette per theme |

Because the overlays/git-panel/settings all consume `--color-*`, a **complete `--color-*` block per theme** covers them automatically. The Monaco-rendered surfaces (editor, popups, diff) need the Monaco theme. The terminal needs its ANSI palette.

## 3. Architecture — per-theme data contract

Each theme is data in four places, with one clear responsibility each:

1. **`src/App.css` → `.app-shell[data-theme="<id>"]`** — the full chrome token set: all `--color-*` (~28: app/panel/panel-deep/sidebar/status/modal/surface/control/tab/tab-active/tabs, border/border-strong, hover/hover-strong, active/active-text/active-muted, accent, text/text-muted/text-strong/text-subtle, disabled, error/success/warning, white, `color-scheme`) **and** the git `--change-added|deleted|modified` (+ `-soft`, `-strong`). Theme-independent tokens (radius/motion/shadow/accent-soft/focus-ring) stay in `:root` and are inherited.
2. **`src/components/monacoThemes.ts` → `defineTheme("<monaco-id>", …)`** — `colors` (editor chrome + suggest/hover/widget/input + diff editor) and `rules` (syntax, see §5).
3. **`src/domain/settings.ts` → `terminalThemeForAppTheme`** — a `TerminalTheme` branch: background, foreground, cursor, selectionBackground, and the 16 ANSI colors.
4. **Registration** — `appThemeOptions` (`{id,label}`), `MonacoAppTheme` union (+ `<monaco-id>`), `monacoThemeForAppTheme` mapping (app id → monaco id).

ID/label/monaco-id per theme:

| App id | Label | Monaco id |
| --- | --- | --- |
| `oneDarkPro` | One Dark Pro | `mockor-one-dark-pro` |
| `dracula` | Dracula | `mockor-dracula` |
| `catppuccinMocha` | Catppuccin Mocha | `mockor-catppuccin-mocha` |
| `catppuccinLatte` | Catppuccin Latte | `mockor-catppuccin-latte` |
| `oneLight` | One Light | `mockor-one-light` |
| `ayuMirage` (existing) | Ayu Mirage | `mockor-ayu-mirage` (retune) |
| `materialDeepOcean` (existing) | Material Deep Ocean | `mockor-material-deep-ocean` (retune) |

## 4. Palettes (canonical sources)

Exact full token lists are taken from the **authoritative sources** during implementation and verified against the contrast gate (§6). Core role colors:

**Ayu Mirage** (ayu) — bg `#1f2430`, fg `#cbccc6`, keyword `#ffa759`, function `#ffd580`, type/entity `#73d0ff`, string `#bae67e`, number/const `#d4bfff`, variable `#cbccc6`, operator `#f29e74`, comment `#5c6773` italic, accent `#ffcc66`.

**Material Deep Ocean** (Material Theme) — bg `#0f111a`, fg `#a6accd`, keyword `#c792ea`, function `#82aaff`, type/class `#ffcb6b`, string `#c3e88d`, number `#f78c6c`, variable `#eeffff`, property `#f07178`, operator `#89ddff`, comment `#717cb4` italic, accent `#84ffff`.

**One Dark Pro** — bg `#282c34`, fg `#abb2bf`, keyword `#c678dd`, function `#61afef`, type/class `#e5c07b`, string `#98c379`, number/const `#d19a66`, variable `#e06c75`, property `#e06c75`, operator `#56b6c2`, comment `#7f848e` italic, accent `#61afef`.

**Dracula** — bg `#282a36`, fg `#f8f8f2`, keyword `#ff79c6`, function `#50fa7b`, type/class `#8be9fd` italic, string `#f1fa8c`, number/const `#bd93f9`, variable `#f8f8f2`, param `#ffb86c` italic, operator `#ff79c6`, comment `#6272a4`, accent `#bd93f9`.

**Catppuccin Mocha** — bg `#1e1e2e`, fg `#cdd6f4`, keyword `#cba6f7`, function `#89b4fa`, type/class `#f9e2af`, string `#a6e3a1`, number `#fab387`, variable `#cdd6f4`, param `#eba0ac`, operator `#89dceb`, comment `#6c7086` italic, accent `#cba6f7`.

**Catppuccin Latte** — bg `#eff1f5`, fg `#4c4f69`, keyword `#8839ef`, function `#1e66f5`, type/class `#df8e1d`, string `#40a02b`, number `#fe640b`, variable `#4c4f69`, param `#e64553`, operator `#04a5e5`, comment `#9ca0b0` italic, accent `#8839ef`.

**One Light** (Atom) — bg `#fafafa`, fg `#383a42`, keyword `#a626a4`, function `#4078f2`, type/class `#c18401`, string `#50a14f`, number/const `#986801`, variable `#383a42`, operator `#0184bc`, comment `#a0a1a7` italic, accent `#4078f2`.

Each theme's chrome (`--color-*`) is derived from its palette: panels = bg (flattened, hairline borders consistent with the Calm structure that all themes share), accent = the table's accent, active = an accent-tinted surface with ≥4.5 text contrast, `--change-*` from the palette's green/red/yellow.

## 5. Syntax mapping (Monarch + semantic)

Syntax color comes from two engines; both are themed via Monaco `rules`:

- **Monarch tokenizer** token types: `comment`, `string`, `string.escape`, `keyword`, `number`, `regexp`, `operator`, `delimiter`, `type`, `type.identifier`, `variable`, `variable.predefined`, `constant`, `tag`, `attribute.name`, `metatag` (PHP `<?php`), `annotation`.
- **LSP semantic token types** (from the legend): `namespace`, `type`, `class`, `enum`, `interface`, `struct`, `typeParameter`, `parameter`, `variable`, `property`, `enumMember`, `event`, `function`, `method`, `macro`, `keyword`, `modifier`, `comment`, `string`, `number`, `regexp`, `operator`.

Each theme maps these to its palette roles: keyword/modifier → keyword; function/method/macro → function; class/type/interface/enum/struct/typeParameter/type → type; variable/property/parameter/enumMember → variable (params may take the palette's param accent where defined); string → string; number/constant → number/const; comment → comment (italic where the theme uses it); operator/delimiter → operator; namespace → type or fg. This yields VS Code / PhpStorm-level differentiation rather than the current 7 buckets.

## 6. Testing & constraints

- Extend the three test files to cover every new theme:
  - `themeContrast.test.ts`: `--color-active` vs `--color-active-text` ≥ 4.5; the accent-soft active-tint contrast ≥ 4.5; **all 16 terminal ANSI colors + foreground** ≥ 4.5 vs terminal background. Light themes (Latte, One Light) need darkened ANSI colors to pass.
  - `monacoThemes.test.ts`: each new `mockor-*` theme is registered with the right `base` and carries `editorSuggestWidget.*` keys.
  - `settings.test.ts`: `monacoThemeForAppTheme` maps each app id → its monaco id; `terminalThemeForAppTheme` returns a palette for each.
- Keep `--color-active` / `--color-active-text` as 6-digit hex (the contrast test parses hex).
- Gates: `npm run check`, `npm test`, `npm run build` green.
- Manual: switch to each theme; verify editor + syntax, completion/hover popups, command palette, Quick Open, Structure, git panel + statuses + diff, settings, status bar, terminal.

## 7. Out of scope

- No layout/component changes; the Calm structural design stays.
- Default theme stays `dark` (Calm dark); new themes are opt-in via Settings → Appearance.
- No new dependencies. No changes to highlighting *mechanism* (only the color data it consumes).
- `system`, `mockor-calm-dark/light` palettes unchanged.

## 8. Risks

- **Terminal contrast on light themes** — canonical ANSI palettes are often too light on light backgrounds; darken per-channel until ≥ 4.5 while keeping hue identity.
- **Semantic vs Monarch overlap** — both engines run; ensure rules are consistent so a token doesn't flip color between the tokenizer and semantic pass.
- **Palette drift** — use canonical source values; don't eyeball. Verify against the contrast gate.
