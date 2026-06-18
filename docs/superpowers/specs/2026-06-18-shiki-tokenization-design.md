# Shiki tokenization & themes for the editor

**Date:** 2026-06-18
**Status:** Approved approach; spec for review.
**Scope:** Replace Monaco's coarse Monarch tokenizer with Shiki (TextMate grammars) for PHP + the web stack, so syntax highlighting matches VS Code even without a language server, and load real VS Code theme JSONs for the named themes. Tokenization + theme colors only; no change to LSP intelligence, chrome, or terminal.

> Not committed (commits at user's discretion, per session convention).

## 1. Problem & goal

With IDE Mode off, PHP files are colored **only** by Monaco's built-in Monarch tokenizer, which does not distinguish method calls (`->m()`), properties, class references, `$this`, or PHPDoc tags. VS Code (TextMate grammar) and PhpStorm (lexer) do. No PHP `DocumentSemanticTokensProvider` is registered, so even in IDE Mode the rich token rules added earlier are inert for PHP. Result: highlighting looks flat/different across **all** themes, regardless of palette.

**Goal:** VS-Code-grade base tokenization for PHP + the web stack via Shiki TextMate grammars (works without LSP), plus pixel-perfect themes for the bundled-VS-Code ones.

## 2. Approach

Use **`shiki`** + **`@shikijs/monaco`**. `shikiToMonaco(highlighter, monaco)` overrides Monaco's tokenizer for the highlighter's loaded languages and registers its themes; theme is applied with `monaco.editor.setTheme(<shikiThemeName>)`.

- **Regex engine:** JS engine (`@shikijs/engine-javascript`) — no WASM, simplest in Tauri/Vite; the chosen grammars are JS-engine compatible. Fallback: `@shikijs/engine-oniguruma` (WASM) only if a grammar misbehaves.
- **Local only:** fine-grained imports bundle the chosen grammars/themes into the app (no CDN; Tauri-offline-safe).

## 3. Languages (Shiki tokenization)

PHP + web stack: `php`, `blade`, `javascript`, `typescript`, `json`, `css`, `scss`, `html`, `yaml`, `markdown`, `sql`. Files in other languages keep Monaco's default tokenizer (acceptable; the app is PHP-focused).

## 4. Themes (hybrid)

`monacoThemeForAppTheme` returns Shiki theme names. The Shiki highlighter loads:

- **Bundled VS Code theme JSONs (Shiki built-ins) — pixel-perfect:** `dracula`, `one-dark-pro`, `catppuccin-mocha`, `catppuccin-latte`.
- **Custom TextMate theme JSONs generated from our palettes:** `ayu-mirage`, `material-deep-ocean`, `one-light`, `calm-dark`, `calm-light`.

App-theme → Shiki-theme map:

| App id | Shiki theme | Source |
| --- | --- | --- |
| `dark` / `system`(dark) | `calm-dark` | custom |
| `light` / `system`(light) | `calm-light` | custom |
| `ayuMirage` | `ayu-mirage` | custom |
| `materialDeepOcean` | `material-deep-ocean` | custom |
| `oneDarkPro` | `one-dark-pro` | bundled |
| `dracula` | `dracula` | bundled |
| `catppuccinMocha` | `catppuccin-mocha` | bundled |
| `catppuccinLatte` | `catppuccin-latte` | bundled |
| `oneLight` | `one-light` | custom |

**Custom theme generation:** add `buildShikiTheme(palette: ThemePalette): ThemeRegistration` — reuse the existing `ThemePalette` objects (in `monacoThemes.ts`) and emit a TextMate theme: `name`, `type` (dark/light), `colors` (editor.background = palette `bg`, foreground, selection, line highlight, gutter, suggest/widget/input, diffEditor — same keys as today's `buildMonacoTheme`), and `tokenColors` mapping TextMate scopes to palette roles:
- `comment` → comment (italic where set)
- `keyword`, `storage`, `keyword.control` → keyword
- `string`, `string.quoted` → string; `constant.character.escape`, `string.regexp` → regexp
- `constant.numeric` → number; `constant.language`, `constant.other` → constant
- `entity.name.function`, `support.function`, `meta.function-call` → func
- `entity.name.type`, `entity.name.class`, `support.class`, `storage.type` → type
- `variable`, `variable.other` → variable; `variable.parameter` → parameter; `variable.other.property`, `meta.property` → property
- `entity.name.namespace`, `support.other.namespace` → namespace
- `keyword.operator`, `punctuation` → operator

## 5. Integration

- **New file** `src/infrastructure/shikiHighlighter.ts`:
  - `createAppHighlighter(): Promise<Highlighter>` — `createHighlighterCore`/`createHighlighter` with the §3 langs, the 4 bundled themes, and the 5 custom themes from `buildShikiTheme`, JS engine. Singleton promise (created once at module load).
  - `setupShikiTokenization(monaco): Promise<void>` — awaits the highlighter, calls `shikiToMonaco(highlighter, monaco)`.
- **`src/components/EditorSurface.tsx`** (`beforeMount`, ~line 1262): replace `registerMonacoAppThemes(monaco)` with kicking off `setupShikiTokenization(monaco)`; on resolve, `monaco.editor.setTheme(currentShikiTheme)` (re-tokenizes existing models, avoiding a stale-Monarch flash).
- **`src/domain/settings.ts`:** `MonacoAppTheme` union and `monacoThemeForAppTheme` return Shiki theme names (table §4). `terminalThemeForAppTheme` unchanged.
- **`src/components/monacoThemes.ts`:** keep the `ThemePalette` type + the per-theme palette objects (now consumed by `buildShikiTheme`); `buildMonacoTheme` and `registerMonacoAppThemes` are removed (superseded by Shiki). The 4 bundled themes need no palette object.

## 6. Unchanged

- Chrome (`App.css --color-*`), terminal ANSI palettes, LSP providers (hover/completion/signature/code-actions/diagnostics, JS/TS semantic tokens), Monaco language workers (ts/css/html/json). Each theme's editor background equals its chrome `--color-app` (already aligned for custom; bundled themes' bg matches the chrome we derived from the same canonical bg).

## 7. Testing

- `buildShikiTheme` unit test: returns a theme with `type`, `colors["editor.background"]` = palette bg, and `tokenColors` containing the expected scopes (e.g. `entity.name.function`, `variable`, `keyword`) with the palette's hex.
- `monacoThemeForAppTheme` test updated to expect Shiki theme names per §4.
- Highlighter test: `createAppHighlighter()` resolves and exposes the loaded themes (§4 names) and languages (§3); `setupShikiTokenization` calls `shikiToMonaco`.
- Existing chrome contrast tests (`themeContrast.test.ts`) and terminal tests stay green (chrome/terminal unchanged). Remove/replace the `monacoThemes.test.ts` `defineTheme` assertions (no longer applicable).
- Gates: `npm run check`, `npm test`, `npm run build`. Manual: PHP file shows method/property/class/`$this`/PHPDoc distinctly with IDE Mode **off**; switch every theme; check a Blade/JS/TS/CSS file; confirm bundle still builds.

## 8. Out of scope

- No PHP semantic-token provider (separate future enhancement; Shiki base tokenization already closes most of the gap). 
- No layout/chrome/behavior changes. No change to which app themes exist.
- Languages outside §3 keep Monaco's default tokenizer.

## 9. Risks

- **Bundle growth** (grammars + themes): mitigate with fine-grained imports (only §3 langs, §4 themes) and the JS engine (no WASM).
- **Async init flash:** highlighter created eagerly at module load; `setTheme` after `shikiToMonaco` re-tokenizes — brief Monarch flash at worst.
- **JS-engine grammar incompatibility:** if PHP/Blade grammar emits oniguruma-only warnings/errors, switch that highlighter to the WASM oniguruma engine.
- **Semantic-token overlay (IDE Mode):** confirm JS/TS semantic tokens still overlay Shiki base tokenization; if Monaco drops them, keep Monaco tokenizer for ts/js or bridge — verify during implementation.
