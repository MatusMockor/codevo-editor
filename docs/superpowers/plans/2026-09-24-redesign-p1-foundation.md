# Redesign P1 - Tokens, Palettes, Appearance Setting and Base Components Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the design-token foundation of the Codevo redesign: 6 palettes x dark/light as `--cv-*` custom properties, a persisted Appearance setting (palette + System/Dark/Light + syntax theme with "Match palette" default), palette-driven Monaco and terminal themes, a temporary bridge that recolors every legacy surface from the new tokens, and a tested, accessible base component library that P2+ phases build on.

**Architecture:** Palette values are typed immutable data in `src/domain/appearancePaletteValues.ts` (generated once from the approved mockup) and mirrored by `src/ui/tokens/palettes.css`; sync tests keep the two identical and a contrast test enforces WCAG AA for every text/surface pair in all 12 combinations. The appearance is a closed-union setting stored in `AppSettings.appearance` (localStorage through `BrowserSettingsGateway`; Rust is not involved), applied as `data-cv-palette` / `data-cv-scheme` on `<html>` at startup and at runtime. `src/ui/tokens/legacyBridge.css` maps the legacy `--color-*` / `--change-*` variables onto `--cv-*` so every existing surface follows the palette until it is migrated (bridge removed in P10). Base components live in `src/ui/foundation/`, one small file per component, styled only through `--cv-*` tokens.

**Tech Stack:** React 19, TypeScript 5.8 (strict), Vite 8, Vitest 4 + jsdom 29, Monaco 0.53 + Shiki 4 (`buildShikiTheme`), xterm 6, lucide-react, plain CSS (no CSS modules).

**Spec:** `docs/superpowers/specs/2026-09-23-codevo-redesign-design.md` (§3.1 items 1-2, §4, §5 P1, §6, §7). Visual source of truth: `docs/redesign/v3-monolith-clean.html` (`<style id="codevo-base">`), `docs/redesign/direction-a-monolith-palettes.html`, and the screen blocks of `docs/redesign/v3-*.html` for promoted components.

## Global Constraints

- Palettes (spec §3.1.1): "6 palettes (Graphite · Teal default, Slate · Blue, Black · Violet, Ink · Mint, Zinc · Orange, Carbon · Lime), each dark + light, values taken from `v3-monolith-clean.html` / `direction-a-monolith-palettes.html`. All text pairs WCAG AA."
- Default palette (spec §7.2): Graphite · Teal.
- Appearance setting (spec §3.1.1): "palette + System/Dark/Light; editor syntax theme defaults to "Match palette"; existing classic editor themes remain selectable as syntax themes."
- Motion (spec §3.1.1): "`prefers-reduced-motion` respected everywhere."
- Base components (spec §3.1.2): "one owner module each, reused by every screen".
- Placement (spec §4): "Tokens and base components live in a dedicated UI foundation module (`src/ui/` or `src/components/foundation/`), consumed by feature components; no feature component defines its own colors." This plan uses `src/ui/tokens/` and `src/ui/foundation/`.
- Presentation only (spec §4): domain, application and Rust layers change only where a feature requires it. P1 needs no Rust code change (only the native window `backgroundColor` in the two Tauri JSON configs, Task 4): app settings persist in `localStorage` key `editor.settings.app` via `src/infrastructure/browserSettingsGateway.ts`.
- Hotspots (spec §4): `App.tsx`, `useWorkbenchController.ts`, `AgentThreadSession.tsx` must shrink or stay flat. `src/App.tsx` is tracked in `scripts/hotspot-size-baseline.json` at 1454 raw lines / 7199 structural tokens. New production files stay far below 2000 lines / 10000 tokens.
- Old styles (spec §4): "Old styles are removed as each surface is migrated; no long-lived dual styling." The legacy bridge and the legacy theme blocks in `src/App.css` are removed in P10.
- Agents (spec §7.1): implementation and review agents are Opus 5.5; UI QA is Codex with Computer Use via `codex app-server` against the QA bundle `dev.mockor.editor.qa`.
- Release (spec §7.3): "a single beta release at the end of the program (P10), not per phase." P1 has no release, no tag, no push.
- Git (CLAUDE.md): work directly on `main`; subagents never run mutating git commands; only the lead commits, once after review and full gates; commit messages carry no AI, Claude, Anthropic or co-author attribution.
- Review (CLAUDE.md): never run `coderabbit` or `cr`; review is a separate read-only AI agent.
- Code style (user rules): no code comments except bare tooling annotations; guard clauses, no `else`; closed unions with exhaustive handling; no `any`.
- Formatting (repo memory): run `npx prettier --write` only on files you created; for modified files run `npm run format:check:changed` and prettier-write only a file it lists. Never prettier a directory.
- Tests (user rules): real collaborators, no mocks of internal modules; React tests use `act`; tests never `throw`.
- Token scan: `src/domain/themeContrast.test.ts` treats every `var(--name` text in any file under `src` (tests included) as a use that must be declared in some stylesheet. Never write a literal `var(--...` for a name that no CSS declares, not even inside a test string; use a regex literal such as `/var\(--cv-motion-/` instead.

## Review Focus

- Settings written by older builds: legacy `theme` ids (including classic ones such as `catppuccinLatte`), a missing or partial `appearance`, prototype keys (`"constructor"`, `"__proto__"`, `"toString"`) and wrong types must migrate or fall back per field, never crash and never resolve through `Object.prototype`. Pinned in Task 1 (`normalizeAppearance`) and Task 4 (`resolveStartupAppearance`).
- The OS switching light/dark while the app runs with "System": `<html>` attributes, the Monaco theme and the terminal theme must follow without a settings change or reload, and a cold start in System+light must paint a light skeleton. Pinned in Task 5 (`useAppWorkbenchThemes` rerender test) and Task 4 (startup stamping test).
- Focus restoration for menus and dialogs: React runs child effects before parent effects, so a naive "remember `document.activeElement` in an effect" records the first menu item instead of the trigger. Focus must return to the trigger on every close path, and Escape inside a submenu closes only the submenu. Pinned in Task 7 (`useRestoreFocus` test) and Task 11 (menu and dialog tests).
- Popovers near the window edge or larger than the window (small windows, long menus): they flip to the opposite side when that fits and always clamp inside an 8px margin, never at negative coordinates. Pinned in Task 7 (`computePopoverPosition` tests).
- A classic syntax theme paired with the opposite chrome scheme (for example Dracula with Light) and the synchronous Monaco fallback: the pre-Shiki fallback must follow the syntax theme's darkness, and every palette light theme must fall back to `vs`. Pinned in Task 3 (`applyImmediateFallbackTheme` and `resolveEditorColorThemes` tests).

---

## File Structure

Created:

| Path | Responsibility |
|---|---|
| `src/domain/appearance.ts` | Closed unions (`PaletteId`, `ColorSchemePreference`, `ResolvedColorScheme`, `SyntaxThemeId`), labels, `AppearanceSettings`, validation, legacy migration, scheme resolution, document attribute names. |
| `src/domain/appearancePalettes.ts` | `PaletteTokens` / `PaletteDefinition` types, token name list, scheme surface roles, `paletteTokens`, `surfaceColor`, `cssTokenName`. |
| `src/domain/appearancePaletteValues.ts` | Generated immutable palette data (12 token sets). |
| `src/domain/cssColor.ts` | `cssColorToHex` for Monaco and xterm colour strings. |
| `src/domain/editorColorThemes.ts` | `MonacoAppTheme`, `TerminalTheme`, classic and palette Monaco/terminal mapping, `resolveEditorColorThemes`. |
| `src/infrastructure/paletteSyntaxThemes.ts` | Palette tokens to `ThemePalette` (Shiki/Monaco "Match palette" themes). |
| `src/ui/tokens/tokens.css` | Token entry point imported first by `App.css`. |
| `src/ui/tokens/palettes.css` | Generated `--cv-*` palette blocks keyed on `:root[data-cv-palette][data-cv-scheme]`. |
| `src/ui/tokens/semantic.css` | Scheme roles (canvas, side, raised, popover, tints, shadows, rings), scale (type, radius, spacing, motion, z-index), reduced motion. |
| `src/ui/tokens/legacyBridge.css` | Temporary `--color-*` / `--change-*` to `--cv-*` bridge (removed in P10). |
| `src/components/useDocumentAppearance.ts` | Stamps `data-cv-palette` / `data-cv-scheme` on `<html>`. |
| `src/components/settings/pages/AppearancePaletteSwatches.tsx` | Palette radiogroup for the Appearance page. |
| `src/ui/foundation/*` | Foundation helpers, hooks, components and their CSS (listed per task). |

Modified: `src/domain/settings.ts`, `src/domain/agentSettings.ts`, `src/domain/startupTheme.ts`, `src/startupTheme.ts`, `public/startup.css`, `src/infrastructure/shikiHighlighter.ts`, `src/components/useAppWorkbenchThemes.ts`, `src/App.tsx`, `src/App.css`, `src/components/WorkbenchShellFrame.tsx`, `src/components/remoteRunner/RemoteTerminalPanel.tsx`, `src/components/settings/pages/AppearanceSettingsPage.tsx`, `src/components/settings/settingsRegistryRows.ts`, `src/components/settings/settings.css`, `src/components/cssContractTestSupport.ts`, `src/components/agentMode/agentModeCssTestSupport.ts`, plus the tests named in each task.

Deleted: `src/components/agentMode/agentModeVariants.css`, `src/components/useDocumentStartupTheme.ts`, `src/components/useDocumentStartupTheme.test.tsx`, `src/components/settings/pages/ThemeSwatches.tsx`, `src/components/settings/pages/ThemeSwatches.test.tsx`.

## Execution Order and Ownership

- Stream A (theming, strictly sequential because Tasks 3-6 share `src/domain/settings.ts` and its tests): Task 1 -> Task 2 -> Task 3 -> Task 4 -> Task 5 -> Task 6.
- Stream B (foundation): Task 7 after Task 2; then Tasks 8, 9, 10, 11, 12 in parallel (disjoint files); Task 13 after Task 8 (Toast uses Button and IconButton).
- Stream A and Stream B never write the same file. `src/components/cssContractTestSupport.ts` is owned by Task 2 only.
- Wrap-up (lead): Task 14 gates -> Task 15 independent review -> Task 16 QA build and Codex QA -> Task 17 commit.
- Each implementer reports changed files and the exact test command output; the lead runs focused tests again before starting dependent tasks.

---

### Task 1: Appearance domain model

**Files:**
- Create: `src/domain/appearance.ts`
- Test: `src/domain/appearance.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `PALETTE_IDS`, `type PaletteId = "graphite-teal" | "slate-blue" | "black-violet" | "ink-mint" | "zinc-orange" | "carbon-lime"`
  - `COLOR_SCHEME_PREFERENCES`, `type ColorSchemePreference = "system" | "dark" | "light"`
  - `RESOLVED_COLOR_SCHEMES`, `type ResolvedColorScheme = "dark" | "light"`
  - `CLASSIC_SYNTAX_THEME_IDS`, `type ClassicSyntaxThemeId`, `MATCH_PALETTE_SYNTAX_THEME`, `type SyntaxThemeId`, `SYNTAX_THEME_IDS`
  - `interface AppearanceSettings { palette; colorScheme; syntaxTheme }`, `DEFAULT_APPEARANCE`
  - `PALETTE_LABELS`, `COLOR_SCHEME_LABELS`, `SYNTAX_THEME_LABELS`
  - `PALETTE_ATTRIBUTE = "data-cv-palette"`, `COLOR_SCHEME_ATTRIBUTE = "data-cv-scheme"`
  - `isPaletteId(value: unknown): value is PaletteId`, `isColorSchemePreference`, `isSyntaxThemeId`
  - `resolveColorScheme(preference: ColorSchemePreference, prefersLight: boolean): ResolvedColorScheme`
  - `normalizeAppearance(value: unknown, legacyTheme: unknown): AppearanceSettings`

- [ ] **Step 1: Write the failing test**

Create `src/domain/appearance.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  CLASSIC_SYNTAX_THEME_IDS,
  COLOR_SCHEME_ATTRIBUTE,
  COLOR_SCHEME_LABELS,
  COLOR_SCHEME_PREFERENCES,
  DEFAULT_APPEARANCE,
  PALETTE_ATTRIBUTE,
  PALETTE_IDS,
  PALETTE_LABELS,
  SYNTAX_THEME_IDS,
  SYNTAX_THEME_LABELS,
  isColorSchemePreference,
  isPaletteId,
  isSyntaxThemeId,
  normalizeAppearance,
  resolveColorScheme,
} from "./appearance";

describe("appearance ids", () => {
  it("defaults to Graphite · Teal, dark chrome and the palette syntax theme", () => {
    expect(DEFAULT_APPEARANCE).toEqual({
      palette: "graphite-teal",
      colorScheme: "dark",
      syntaxTheme: "matchPalette",
    });
    expect(PALETTE_LABELS[DEFAULT_APPEARANCE.palette]).toBe("Graphite · Teal");
  });

  it("lists the six approved palettes in order", () => {
    expect(PALETTE_IDS.map((id) => PALETTE_LABELS[id])).toEqual([
      "Graphite · Teal",
      "Slate · Blue",
      "Black · Violet",
      "Ink · Mint",
      "Zinc · Orange",
      "Carbon · Lime",
    ]);
  });

  it("labels every scheme and syntax theme exactly once", () => {
    expect(COLOR_SCHEME_PREFERENCES.map((id) => COLOR_SCHEME_LABELS[id])).toEqual([
      "System",
      "Dark",
      "Light",
    ]);
    expect(new Set(SYNTAX_THEME_IDS).size).toBe(CLASSIC_SYNTAX_THEME_IDS.length + 1);
    expect(SYNTAX_THEME_IDS[0]).toBe("matchPalette");
    expect(SYNTAX_THEME_LABELS.matchPalette).toBe("Match palette");
    expect(SYNTAX_THEME_IDS.every((id) => SYNTAX_THEME_LABELS[id].length > 0)).toBe(true);
  });

  it("names the document attributes the stylesheets key on", () => {
    expect(PALETTE_ATTRIBUTE).toBe("data-cv-palette");
    expect(COLOR_SCHEME_ATTRIBUTE).toBe("data-cv-scheme");
  });

  it("rejects values outside the closed unions", () => {
    expect(isPaletteId("graphite-teal")).toBe(true);
    expect(isColorSchemePreference("system")).toBe(true);
    expect(isSyntaxThemeId("dracula")).toBe(true);
    for (const value of ["Graphite", "graphite_teal", "", null, 1, "constructor", "__proto__"]) {
      expect(isPaletteId(value)).toBe(false);
      expect(isColorSchemePreference(value)).toBe(false);
      expect(isSyntaxThemeId(value)).toBe(false);
    }
  });
});

describe("resolveColorScheme", () => {
  it("resolves system from the platform preference and keeps explicit schemes", () => {
    expect(resolveColorScheme("system", true)).toBe("light");
    expect(resolveColorScheme("system", false)).toBe("dark");
    expect(resolveColorScheme("dark", true)).toBe("dark");
    expect(resolveColorScheme("light", false)).toBe("light");
  });
});

describe("normalizeAppearance", () => {
  it("keeps a valid persisted appearance", () => {
    const appearance = { palette: "ink-mint", colorScheme: "system", syntaxTheme: "oneLight" };

    expect(normalizeAppearance(appearance, undefined)).toEqual(appearance);
  });

  it("falls back per field instead of discarding the whole appearance", () => {
    expect(
      normalizeAppearance({ palette: "ink-mint", colorScheme: "sepia", syntaxTheme: 7 }, undefined),
    ).toEqual({ palette: "ink-mint", colorScheme: "dark", syntaxTheme: "matchPalette" });
  });

  it("prefers the persisted appearance over the legacy theme", () => {
    expect(
      normalizeAppearance(
        { palette: "slate-blue", colorScheme: "light", syntaxTheme: "matchPalette" },
        "dracula",
      ),
    ).toEqual({ palette: "slate-blue", colorScheme: "light", syntaxTheme: "matchPalette" });
  });

  it("migrates every legacy theme id to the default palette", () => {
    const cases = [
      ["dark", "dark", "matchPalette"],
      ["light", "light", "matchPalette"],
      ["system", "system", "matchPalette"],
      ["ayuMirage", "dark", "ayuMirage"],
      ["materialDeepOcean", "dark", "materialDeepOcean"],
      ["oneDarkPro", "dark", "oneDarkPro"],
      ["dracula", "dark", "dracula"],
      ["catppuccinMocha", "dark", "catppuccinMocha"],
      ["catppuccinLatte", "light", "catppuccinLatte"],
      ["oneLight", "light", "oneLight"],
      ["darkPlus", "dark", "darkPlus"],
    ] as const;

    for (const [legacy, colorScheme, syntaxTheme] of cases) {
      expect(normalizeAppearance(undefined, legacy), legacy).toEqual({
        palette: "graphite-teal",
        colorScheme,
        syntaxTheme,
      });
    }
  });

  it("falls back to the default for unknown, prototype and non-string legacy values", () => {
    for (const legacy of ["solarized", "constructor", "__proto__", "toString", 42, null, {}]) {
      expect(normalizeAppearance(undefined, legacy)).toEqual(DEFAULT_APPEARANCE);
    }
  });

  it("treats arrays, null and prototype-only records as a missing appearance", () => {
    expect(normalizeAppearance([], "light")).toEqual({
      palette: "graphite-teal",
      colorScheme: "light",
      syntaxTheme: "matchPalette",
    });
    expect(normalizeAppearance(null, undefined)).toEqual(DEFAULT_APPEARANCE);
    expect(
      normalizeAppearance(JSON.parse('{"__proto__":{"palette":"ink-mint"}}'), undefined),
    ).toEqual(DEFAULT_APPEARANCE);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/appearance.test.ts`
Expected: FAIL with `Failed to resolve import "./appearance"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/domain/appearance.ts`:

```ts
export const PALETTE_IDS = [
  "graphite-teal",
  "slate-blue",
  "black-violet",
  "ink-mint",
  "zinc-orange",
  "carbon-lime",
] as const;
export type PaletteId = (typeof PALETTE_IDS)[number];

export const COLOR_SCHEME_PREFERENCES = ["system", "dark", "light"] as const;
export type ColorSchemePreference = (typeof COLOR_SCHEME_PREFERENCES)[number];

export const RESOLVED_COLOR_SCHEMES = ["dark", "light"] as const;
export type ResolvedColorScheme = (typeof RESOLVED_COLOR_SCHEMES)[number];

export const CLASSIC_SYNTAX_THEME_IDS = [
  "classicDark",
  "classicLight",
  "ayuMirage",
  "materialDeepOcean",
  "oneDarkPro",
  "dracula",
  "catppuccinMocha",
  "catppuccinLatte",
  "oneLight",
  "darkPlus",
] as const;
export type ClassicSyntaxThemeId = (typeof CLASSIC_SYNTAX_THEME_IDS)[number];

export const MATCH_PALETTE_SYNTAX_THEME = "matchPalette";
export type SyntaxThemeId = typeof MATCH_PALETTE_SYNTAX_THEME | ClassicSyntaxThemeId;
export const SYNTAX_THEME_IDS: readonly SyntaxThemeId[] = [
  MATCH_PALETTE_SYNTAX_THEME,
  ...CLASSIC_SYNTAX_THEME_IDS,
];

export const PALETTE_ATTRIBUTE = "data-cv-palette";
export const COLOR_SCHEME_ATTRIBUTE = "data-cv-scheme";

export interface AppearanceSettings {
  readonly palette: PaletteId;
  readonly colorScheme: ColorSchemePreference;
  readonly syntaxTheme: SyntaxThemeId;
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  palette: "graphite-teal",
  colorScheme: "dark",
  syntaxTheme: MATCH_PALETTE_SYNTAX_THEME,
};

export const PALETTE_LABELS: Readonly<Record<PaletteId, string>> = {
  "graphite-teal": "Graphite · Teal",
  "slate-blue": "Slate · Blue",
  "black-violet": "Black · Violet",
  "ink-mint": "Ink · Mint",
  "zinc-orange": "Zinc · Orange",
  "carbon-lime": "Carbon · Lime",
};

export const COLOR_SCHEME_LABELS: Readonly<Record<ColorSchemePreference, string>> = {
  system: "System",
  dark: "Dark",
  light: "Light",
};

export const SYNTAX_THEME_LABELS: Readonly<Record<SyntaxThemeId, string>> = {
  matchPalette: "Match palette",
  classicDark: "Codevo Classic Dark",
  classicLight: "Codevo Classic Light",
  ayuMirage: "Ayu Mirage",
  materialDeepOcean: "Material Deep Ocean",
  oneDarkPro: "One Dark Pro",
  dracula: "Dracula",
  catppuccinMocha: "Catppuccin Mocha",
  catppuccinLatte: "Catppuccin Latte",
  oneLight: "One Light",
  darkPlus: "Dark Plus (VS Code)",
};

type SchemeAndSyntax = Pick<AppearanceSettings, "colorScheme" | "syntaxTheme">;

const LEGACY_THEME_APPEARANCE: ReadonlyMap<string, SchemeAndSyntax> = new Map<
  string,
  SchemeAndSyntax
>([
  ["dark", { colorScheme: "dark", syntaxTheme: MATCH_PALETTE_SYNTAX_THEME }],
  ["light", { colorScheme: "light", syntaxTheme: MATCH_PALETTE_SYNTAX_THEME }],
  ["system", { colorScheme: "system", syntaxTheme: MATCH_PALETTE_SYNTAX_THEME }],
  ["ayuMirage", { colorScheme: "dark", syntaxTheme: "ayuMirage" }],
  ["materialDeepOcean", { colorScheme: "dark", syntaxTheme: "materialDeepOcean" }],
  ["oneDarkPro", { colorScheme: "dark", syntaxTheme: "oneDarkPro" }],
  ["dracula", { colorScheme: "dark", syntaxTheme: "dracula" }],
  ["catppuccinMocha", { colorScheme: "dark", syntaxTheme: "catppuccinMocha" }],
  ["catppuccinLatte", { colorScheme: "light", syntaxTheme: "catppuccinLatte" }],
  ["oneLight", { colorScheme: "light", syntaxTheme: "oneLight" }],
  ["darkPlus", { colorScheme: "dark", syntaxTheme: "darkPlus" }],
]);

export function isPaletteId(value: unknown): value is PaletteId {
  return PALETTE_IDS.some((id) => id === value);
}

export function isColorSchemePreference(value: unknown): value is ColorSchemePreference {
  return COLOR_SCHEME_PREFERENCES.some((preference) => preference === value);
}

export function isSyntaxThemeId(value: unknown): value is SyntaxThemeId {
  return SYNTAX_THEME_IDS.some((id) => id === value);
}

export function resolveColorScheme(
  preference: ColorSchemePreference,
  prefersLight: boolean,
): ResolvedColorScheme {
  if (preference !== "system") return preference;
  if (prefersLight) return "light";
  return "dark";
}

export function normalizeAppearance(value: unknown, legacyTheme: unknown): AppearanceSettings {
  if (isPlainRecord(value)) return normalizeAppearanceRecord(value);
  return migrateLegacyTheme(legacyTheme);
}

function normalizeAppearanceRecord(record: Readonly<Record<string, unknown>>): AppearanceSettings {
  return {
    palette: isPaletteId(record.palette) ? record.palette : DEFAULT_APPEARANCE.palette,
    colorScheme: isColorSchemePreference(record.colorScheme)
      ? record.colorScheme
      : DEFAULT_APPEARANCE.colorScheme,
    syntaxTheme: isSyntaxThemeId(record.syntaxTheme)
      ? record.syntaxTheme
      : DEFAULT_APPEARANCE.syntaxTheme,
  };
}

function migrateLegacyTheme(legacyTheme: unknown): AppearanceSettings {
  if (typeof legacyTheme !== "string") return DEFAULT_APPEARANCE;
  const migrated = LEGACY_THEME_APPEARANCE.get(legacyTheme);
  if (migrated === undefined) return DEFAULT_APPEARANCE;
  return { palette: DEFAULT_APPEARANCE.palette, ...migrated };
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/appearance.test.ts && npx prettier --write src/domain/appearance.ts src/domain/appearance.test.ts && npx tsc --noEmit`
Expected: PASS (all tests in the file), prettier rewrites at most whitespace, `tsc` exits 0.

- [ ] **Step 5: Hand off (no commit)**

Report the two created files. Project rule: nothing is committed until Task 17.

---

### Task 2: Palette data, token stylesheets, sync and contrast gates

**Files:**
- Create: `src/domain/appearancePalettes.ts`
- Create (generated): `src/domain/appearancePaletteValues.ts`, `src/ui/tokens/palettes.css`
- Create: `src/ui/tokens/semantic.css`, `src/ui/tokens/tokens.css`
- Modify: `src/components/cssContractTestSupport.ts` (`SHADOW_TOKEN_ROOTS`, lines 185-191)
- Test: `src/ui/tokens/tokenCss.test.ts`, `src/ui/tokens/tokenContrast.test.ts`

**Interfaces:**
- Consumes: `PaletteId`, `ResolvedColorScheme`, `PALETTE_IDS`, `RESOLVED_COLOR_SCHEMES` from Task 1.
- Produces:
  - `interface PaletteTokens` (32 readonly string fields: `bgPage, s0, s1, s2, s3, s4, popBg, hair, hairStrong, fgStrong, fg, fgMuted, fgSubtle, accent, accentStrong, accentFill, onAccent, accentSoft, focus, selection, ok, danger, warn, warnSoft, addBg, addGutter, delBg, delGutter, synKw, synStr, synNum, synCom`)
  - `interface PaletteDefinition { readonly dark: PaletteTokens; readonly light: PaletteTokens }`, `type PaletteTokenName = keyof PaletteTokens`, `PALETTE_TOKEN_NAMES`
  - `type SurfaceStep = "s0" | "s1" | "s2" | "s3" | "s4" | "popBg"`, `type SurfaceRole = "canvas" | "side" | "raised" | "popover"`, `SCHEME_SURFACE_ROLES`
  - `PALETTE_VALUES: Readonly<Record<PaletteId, PaletteDefinition>>` (in `appearancePaletteValues.ts`)
  - `paletteTokens(palette, scheme): PaletteTokens`, `surfaceColor(palette, scheme, role): string`, `cssTokenName(name: PaletteTokenName): string` (`"accentFill"` -> `"--cv-accent-fill"`)
  - CSS custom properties: every `--cv-<kebab token>` per palette block; semantic tokens `--cv-canvas, --cv-side, --cv-raised, --cv-popover, --cv-tint-1..3, --cv-row-hover, --cv-row-active, --cv-overlay, --cv-scrim, --cv-fg-disabled, --cv-switch-track, --cv-switch-knob`; shadow roots `--cv-ring-hair, --cv-ring-hair-strong, --cv-ring-focus, --cv-ring-danger, --cv-ring-canvas, --cv-edge-top, --cv-edge-top-hair, --cv-edge-bottom-hair, --cv-lift, --cv-fill-edge, --cv-switch-edge, --cv-shadow-knob, --cv-shadow-pop, --cv-shadow-dialog, --cv-shadow-toast`; scale `--cv-font-ui, --cv-font-display, --cv-font-mono, --cv-t-2xs, --cv-t-xs, --cv-t-code, --cv-t-md, --cv-t-sm, --cv-t-lg, --cv-t-title, --cv-lh-xs, --cv-lh-sm, --cv-lh-prose, --cv-sidebar-w, --cv-topbar-h, --cv-column, --cv-panel-w, --cv-r-xs, --cv-r-sm, --cv-r-control, --cv-r-card, --cv-r-group, --cv-r-dialog, --cv-r-bubble, --cv-r-composer, --cv-r-pill, --cv-space-1..8, --cv-ease, --cv-motion-fast, --cv-motion-base, --cv-motion-slow, --cv-motion-spin, --cv-z-popover, --cv-z-dialog, --cv-z-toast`; editor extras `--cv-git-mod, --cv-breakpoint, --cv-match, --cv-match-current`.

- [ ] **Step 1: Write the failing tests**

Create `src/ui/tokens/tokenCss.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PALETTE_IDS, RESOLVED_COLOR_SCHEMES } from "../../domain/appearance";
import {
  PALETTE_TOKEN_NAMES,
  SCHEME_SURFACE_ROLES,
  cssTokenName,
  paletteTokens,
  type SurfaceRole,
} from "../../domain/appearancePalettes";
import {
  SHADOW_TOKEN_ROOTS,
  buildTokenTable,
  lastOf,
  parseAllStyleSheets,
  selectorParts,
  type CssRule,
} from "../../components/cssContractTestSupport";

const parsed = parseAllStyleSheets();
const PALETTE_SHEET = "ui/tokens/palettes.css";
const SEMANTIC_SHEET = "ui/tokens/semantic.css";
const REDUCED_MOTION = "@media (prefers-reduced-motion: reduce)";
const SURFACE_ROLES: readonly SurfaceRole[] = ["canvas", "side", "raised", "popover"];

function rulesFor(
  sheet: string,
  selector: string,
  context: readonly string[] = [],
): readonly CssRule[] {
  return parsed.rules.filter(
    (rule) =>
      rule.sheet === sheet &&
      rule.context.length === context.length &&
      rule.context.every((entry, index) => entry === context[index]) &&
      selectorParts(rule.selector).includes(selector),
  );
}

function declaredValues(rules: readonly CssRule[], prefix: string): Record<string, string> {
  return Object.fromEntries(
    [...buildTokenTable(rules, prefix).entries()].map(([name, values]) => [
      name,
      lastOf(values) ?? "",
    ]),
  );
}

function paletteSelector(palette: string, scheme: string): string {
  return `:root[data-cv-palette="${palette}"][data-cv-scheme="${scheme}"]`;
}

describe("palette token stylesheet", () => {
  it("parses every stylesheet cleanly", () => {
    expect(parsed.issues).toEqual([]);
  });

  it("declares every palette token exactly as the typed palette definitions", () => {
    for (const palette of PALETTE_IDS) {
      for (const scheme of RESOLVED_COLOR_SCHEMES) {
        const tokens = paletteTokens(palette, scheme);
        const expected = Object.fromEntries(
          PALETTE_TOKEN_NAMES.map((name) => [cssTokenName(name), tokens[name]]),
        );

        expect(
          declaredValues(rulesFor(PALETTE_SHEET, paletteSelector(palette, scheme)), "--cv-"),
          `${palette} ${scheme}`,
        ).toEqual(expected);
        expect(
          declaredValues(rulesFor(PALETTE_SHEET, paletteSelector(palette, scheme)), "color-scheme"),
        ).toEqual({ "color-scheme": scheme });
      }
    }
  });

  it("paints Graphite · Teal when the document carries no palette attribute", () => {
    expect(declaredValues(rulesFor(PALETTE_SHEET, ":root"), "--cv-")).toEqual(
      declaredValues(rulesFor(PALETTE_SHEET, paletteSelector("graphite-teal", "dark")), "--cv-"),
    );
    expect(declaredValues(rulesFor(PALETTE_SHEET, ':root[data-cv-scheme="light"]'), "--cv-")).toEqual(
      declaredValues(rulesFor(PALETTE_SHEET, paletteSelector("graphite-teal", "light")), "--cv-"),
    );
  });

  it("keeps the typed palettes complete and pinned to the approved mockup", () => {
    for (const palette of PALETTE_IDS) {
      for (const scheme of RESOLVED_COLOR_SCHEMES) {
        expect(Object.keys(paletteTokens(palette, scheme)).sort()).toEqual(
          [...PALETTE_TOKEN_NAMES].sort(),
        );
      }
    }
    expect(paletteTokens("graphite-teal", "dark").accent).toBe("#4FCDB3");
    expect(paletteTokens("slate-blue", "dark").accentFill).toBe("#2563EB");
    expect(paletteTokens("black-violet", "light").s2).toBe("#FFFFFF");
    expect(paletteTokens("zinc-orange", "dark").warn).toBe("#F2D049");
    expect(paletteTokens("carbon-lime", "light").onAccent).toBe("#162200");
    expect(paletteTokens("ink-mint", "light").hair).toBe("rgba(14, 20, 48, 0.085)");
  });

  it("derives kebab-case custom property names", () => {
    expect(cssTokenName("accentFill")).toBe("--cv-accent-fill");
    expect(cssTokenName("popBg")).toBe("--cv-pop-bg");
    expect(cssTokenName("s0")).toBe("--cv-s0");
    expect(cssTokenName("synKw")).toBe("--cv-syn-kw");
  });
});

describe("semantic token stylesheet", () => {
  it("maps surface roles to palette steps per scheme", () => {
    for (const scheme of RESOLVED_COLOR_SCHEMES) {
      const declared = declaredValues(
        rulesFor(SEMANTIC_SHEET, `:root[data-cv-scheme="${scheme}"]`),
        "--cv-",
      );
      for (const role of SURFACE_ROLES) {
        expect(declared[`--cv-${role}`], `${scheme} ${role}`).toBe(
          `var(${cssTokenName(SCHEME_SURFACE_ROLES[scheme][role])})`,
        );
      }
    }
  });

  it("declares every foundation shadow root the border contract allows", () => {
    const declared = new Set(
      parsed.rules
        .filter((rule) => rule.sheet === SEMANTIC_SHEET)
        .flatMap((rule) => rule.declarations.map((declaration) => declaration.property)),
    );
    const roots = SHADOW_TOKEN_ROOTS.filter((name) => name.startsWith("--cv-"));

    expect(roots).toHaveLength(15);
    expect(roots.filter((name) => !declared.has(name))).toEqual([]);
  });

  it("zeroes every motion duration under reduced motion", () => {
    const reduced = declaredValues(rulesFor(SEMANTIC_SHEET, ":root", [REDUCED_MOTION]), "--cv-");

    expect(reduced).toEqual({
      "--cv-motion-fast": "0ms",
      "--cv-motion-base": "0ms",
      "--cv-motion-slow": "0ms",
    });
  });
});
```

Create `src/ui/tokens/tokenContrast.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  PALETTE_IDS,
  RESOLVED_COLOR_SCHEMES,
  type PaletteId,
  type ResolvedColorScheme,
} from "../../domain/appearance";
import { paletteTokens, type PaletteTokenName } from "../../domain/appearancePalettes";
import { contrastRatio } from "../../domain/themeContrast";

const AA_TEXT = 4.5;
const TEXT_TOKENS: readonly PaletteTokenName[] = [
  "fgStrong",
  "fg",
  "fgMuted",
  "fgSubtle",
  "accent",
  "ok",
  "danger",
  "warn",
];
const TEXT_SURFACES: readonly PaletteTokenName[] = ["s0", "s1", "s2", "s3", "popBg"];
const SYNTAX_TOKENS: readonly PaletteTokenName[] = ["synKw", "synStr", "synNum", "synCom"];
const SYNTAX_SURFACES: readonly PaletteTokenName[] = ["s0", "s1", "s2"];
const LEGACY_ON_ACCENT: Readonly<Record<ResolvedColorScheme, (palette: PaletteId) => string>> = {
  dark: (palette) => paletteTokens(palette, "dark").s0,
  light: () => "#FFFFFF",
};

interface ContrastPair {
  readonly pair: string;
  readonly foreground: string;
  readonly background: string;
}

function pairsFor(palette: PaletteId, scheme: ResolvedColorScheme): readonly ContrastPair[] {
  const tokens = paletteTokens(palette, scheme);
  const onSurfaces = (
    foregrounds: readonly PaletteTokenName[],
    backgrounds: readonly PaletteTokenName[],
  ): ContrastPair[] =>
    foregrounds.flatMap((foreground) =>
      backgrounds.map((background) => ({
        pair: `${foreground} on ${background}`,
        foreground: tokens[foreground],
        background: tokens[background],
      })),
    );

  return [
    ...onSurfaces(TEXT_TOKENS, TEXT_SURFACES),
    ...onSurfaces(SYNTAX_TOKENS, SYNTAX_SURFACES),
    { pair: "onAccent on accentFill", foreground: tokens.onAccent, background: tokens.accentFill },
    {
      pair: "legacy on-accent on accent",
      foreground: LEGACY_ON_ACCENT[scheme](palette),
      background: tokens.accent,
    },
  ];
}

describe("palette contrast gate", () => {
  it("checks all twelve palette and scheme combinations", () => {
    expect(PALETTE_IDS.length * RESOLVED_COLOR_SCHEMES.length).toBe(12);
  });

  it("keeps every text, syntax and accent pair at WCAG AA or better", () => {
    const failures = PALETTE_IDS.flatMap((palette) =>
      RESOLVED_COLOR_SCHEMES.flatMap((scheme) =>
        pairsFor(palette, scheme)
          .map((entry) => ({
            combination: `${palette} ${scheme}`,
            pair: entry.pair,
            ratio: contrastRatio(entry.foreground, entry.background),
          }))
          .filter((entry) => entry.ratio < AA_TEXT)
          .map((entry) => `${entry.combination}: ${entry.pair} = ${entry.ratio.toFixed(2)}`),
      ),
    );

    expect(failures).toEqual([]);
  });

  it("detects a pair below AA so the gate cannot pass vacuously", () => {
    expect(contrastRatio("#777777", "#888888")).toBeLessThan(AA_TEXT);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/tokens`
Expected: FAIL with `Failed to resolve import "../../domain/appearancePalettes"`.

- [ ] **Step 3: Write the palette types module**

Create `src/domain/appearancePalettes.ts`:

```ts
import type { PaletteId, ResolvedColorScheme } from "./appearance";
import { PALETTE_VALUES } from "./appearancePaletteValues";

export interface PaletteTokens {
  readonly bgPage: string;
  readonly s0: string;
  readonly s1: string;
  readonly s2: string;
  readonly s3: string;
  readonly s4: string;
  readonly popBg: string;
  readonly hair: string;
  readonly hairStrong: string;
  readonly fgStrong: string;
  readonly fg: string;
  readonly fgMuted: string;
  readonly fgSubtle: string;
  readonly accent: string;
  readonly accentStrong: string;
  readonly accentFill: string;
  readonly onAccent: string;
  readonly accentSoft: string;
  readonly focus: string;
  readonly selection: string;
  readonly ok: string;
  readonly danger: string;
  readonly warn: string;
  readonly warnSoft: string;
  readonly addBg: string;
  readonly addGutter: string;
  readonly delBg: string;
  readonly delGutter: string;
  readonly synKw: string;
  readonly synStr: string;
  readonly synNum: string;
  readonly synCom: string;
}

export interface PaletteDefinition {
  readonly dark: PaletteTokens;
  readonly light: PaletteTokens;
}

export type PaletteTokenName = keyof PaletteTokens;

export const PALETTE_TOKEN_NAMES: readonly PaletteTokenName[] = [
  "bgPage",
  "s0",
  "s1",
  "s2",
  "s3",
  "s4",
  "popBg",
  "hair",
  "hairStrong",
  "fgStrong",
  "fg",
  "fgMuted",
  "fgSubtle",
  "accent",
  "accentStrong",
  "accentFill",
  "onAccent",
  "accentSoft",
  "focus",
  "selection",
  "ok",
  "danger",
  "warn",
  "warnSoft",
  "addBg",
  "addGutter",
  "delBg",
  "delGutter",
  "synKw",
  "synStr",
  "synNum",
  "synCom",
];

export type SurfaceStep = "s0" | "s1" | "s2" | "s3" | "s4" | "popBg";
export type SurfaceRole = "canvas" | "side" | "raised" | "popover";

export const SCHEME_SURFACE_ROLES: Readonly<
  Record<ResolvedColorScheme, Readonly<Record<SurfaceRole, SurfaceStep>>>
> = {
  dark: { canvas: "s0", side: "s1", raised: "s2", popover: "popBg" },
  light: { canvas: "s1", side: "s0", raised: "s2", popover: "popBg" },
};

export function paletteTokens(palette: PaletteId, scheme: ResolvedColorScheme): PaletteTokens {
  return PALETTE_VALUES[palette][scheme];
}

export function surfaceColor(
  palette: PaletteId,
  scheme: ResolvedColorScheme,
  role: SurfaceRole,
): string {
  return paletteTokens(palette, scheme)[SCHEME_SURFACE_ROLES[scheme][role]];
}

export function cssTokenName(name: PaletteTokenName): string {
  return `--cv-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}
```

- [ ] **Step 4: Generate the palette data and the palette stylesheet from the approved mockup**

Run this one-off generator exactly (it is not committed; it reads the 12 `html[data-palette][data-theme]` blocks of the approved mockup verbatim):

```bash
mkdir -p src/ui/tokens && node --input-type=module - "$PWD" <<'GEN'
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.argv[2];
const mockup = readFileSync(resolve(root, "docs/redesign/v3-monolith-clean.html"), "utf8");
const ids = { 1: "graphite-teal", 2: "slate-blue", 3: "black-violet", 4: "ink-mint", 5: "zinc-orange", 6: "carbon-lime" };
const blockPattern = /html\[data-palette="(\d)"\]\[data-theme="(dark|light)"\]\s*\{([^}]*)\}/g;
const blocks = new Map();
for (const match of mockup.matchAll(blockPattern)) {
  const declarations = match[3]
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("--"))
    .map((part) => {
      const colon = part.indexOf(":");
      return [part.slice(2, colon).trim(), part.slice(colon + 1).trim()];
    });
  blocks.set(`${match[1]}:${match[2]}`, declarations);
}
if (blocks.size !== 12) throw new Error(`expected 12 palette blocks, found ${blocks.size}`);

const camel = (name) => name.replace(/-([a-z0-9])/g, (_, next) => next.toUpperCase());
let css = "";
let ts =
  'import type { PaletteId } from "./appearance";\n' +
  'import type { PaletteDefinition } from "./appearancePalettes";\n\n' +
  "export const PALETTE_VALUES: Readonly<Record<PaletteId, PaletteDefinition>> = {\n";
for (const number of [1, 2, 3, 4, 5, 6]) {
  ts += `  "${ids[number]}": {\n`;
  for (const scheme of ["dark", "light"]) {
    const declarations = blocks.get(`${number}:${scheme}`);
    const selectors = [];
    if (number === 1 && scheme === "dark") selectors.push(":root");
    if (number === 1 && scheme === "light") selectors.push(':root[data-cv-scheme="light"]');
    selectors.push(`:root[data-cv-palette="${ids[number]}"][data-cv-scheme="${scheme}"]`);
    css += `${selectors.join(",\n")} {\n  color-scheme: ${scheme};\n`;
    css += declarations.map(([name, value]) => `  --cv-${name}: ${value};`).join("\n");
    css += "\n}\n\n";
    ts += `    ${scheme}: {\n`;
    ts += declarations.map(([name, value]) => `      ${camel(name)}: "${value}",`).join("\n");
    ts += "\n    },\n";
  }
  ts += "  },\n";
}
ts += "};\n";
writeFileSync(resolve(root, "src/ui/tokens/palettes.css"), css.trimEnd() + "\n");
writeFileSync(resolve(root, "src/domain/appearancePaletteValues.ts"), ts);
GEN
```

Expected: no output, exit 0. `src/ui/tokens/palettes.css` is 433 lines and starts with:

```css
:root,
:root[data-cv-palette="graphite-teal"][data-cv-scheme="dark"] {
  color-scheme: dark;
  --cv-bg-page: #060607;
  --cv-s0: #0E0F10;
```

`src/domain/appearancePaletteValues.ts` is 425 lines and each scheme object has the 32 keys of `PaletteTokens` in mockup order. Then run `npx prettier --check src/domain/appearancePaletteValues.ts` (expected: "All matched files use Prettier code style!").

- [ ] **Step 5: Write the semantic token stylesheet and the token entry point**

Create `src/ui/tokens/semantic.css`:

```css
:root {
  --cv-font-ui: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
  --cv-font-display: -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif;
  --cv-font-mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
  --cv-t-2xs: 11px;
  --cv-t-xs: 12px;
  --cv-t-code: 12.5px;
  --cv-t-md: 13px;
  --cv-t-sm: 14px;
  --cv-t-lg: 15px;
  --cv-t-title: 20px;
  --cv-lh-xs: 16px;
  --cv-lh-sm: 20px;
  --cv-lh-prose: 1.625;
  --cv-sidebar-w: 256px;
  --cv-topbar-h: 52px;
  --cv-column: 768px;
  --cv-panel-w: 540px;
  --cv-r-xs: 4px;
  --cv-r-sm: 6px;
  --cv-r-control: 8px;
  --cv-r-card: 10px;
  --cv-r-group: 12px;
  --cv-r-dialog: 16px;
  --cv-r-bubble: 18px;
  --cv-r-composer: 22px;
  --cv-r-pill: 999px;
  --cv-space-1: 2px;
  --cv-space-2: 4px;
  --cv-space-3: 6px;
  --cv-space-4: 8px;
  --cv-space-5: 12px;
  --cv-space-6: 16px;
  --cv-space-7: 24px;
  --cv-space-8: 32px;
  --cv-ease: cubic-bezier(0.2, 0.8, 0.2, 1);
  --cv-motion-fast: 120ms;
  --cv-motion-base: 150ms;
  --cv-motion-slow: 250ms;
  --cv-motion-spin: 900ms;
  --cv-z-popover: 30;
  --cv-z-dialog: 40;
  --cv-z-toast: 60;
  --cv-ring-hair: inset 0 0 0 1px var(--cv-hair);
  --cv-ring-hair-strong: inset 0 0 0 1px var(--cv-hair-strong);
  --cv-ring-focus: inset 0 0 0 1px var(--cv-focus), 0 0 0 3px var(--cv-accent-soft);
  --cv-ring-danger: inset 0 0 0 1px var(--cv-danger);
  --cv-ring-canvas: 0 0 0 1.5px var(--cv-canvas);
  --cv-edge-top-hair: inset 0 1px 0 var(--cv-hair);
  --cv-edge-bottom-hair: inset 0 -1px 0 var(--cv-hair);
  --cv-shadow-knob: 0 1px 2px rgba(0, 0, 0, 0.3);
  --cv-fg-disabled: color-mix(in srgb, var(--cv-fg-subtle) 55%, transparent);
  --cv-switch-knob: #ffffff;
}

:root,
:root[data-cv-scheme="dark"] {
  --cv-canvas: var(--cv-s0);
  --cv-side: var(--cv-s1);
  --cv-raised: var(--cv-s2);
  --cv-popover: var(--cv-pop-bg);
  --cv-tint-1: rgba(255, 255, 255, 0.03);
  --cv-tint-2: rgba(255, 255, 255, 0.05);
  --cv-tint-3: rgba(255, 255, 255, 0.09);
  --cv-row-hover: var(--cv-tint-2);
  --cv-row-active: var(--cv-tint-3);
  --cv-edge-top: inset 0 1px 0 rgba(255, 255, 255, 0.03);
  --cv-lift: 0 0 0 transparent;
  --cv-fill-edge: 0 0 0 transparent;
  --cv-switch-edge: 0 0 0 transparent;
  --cv-switch-track: var(--cv-s4);
  --cv-scrim: rgba(0, 0, 0, 0.75);
  --cv-overlay: color-mix(in srgb, var(--cv-canvas) 62%, transparent);
  --cv-shadow-pop: 0 0 0 1px var(--cv-hair-strong), 0 18px 40px -14px rgba(0, 0, 0, 0.55);
  --cv-shadow-dialog: 0 0 0 1px var(--cv-hair-strong), 0 28px 70px -24px rgba(0, 0, 0, 0.65);
  --cv-shadow-toast: 0 0 0 1px var(--cv-hair-strong), 0 12px 32px -16px rgba(0, 0, 0, 0.5);
  --cv-git-mod: #6aa8f7;
  --cv-breakpoint: #e5534b;
  --cv-match: rgba(237, 187, 78, 0.16);
  --cv-match-current: rgba(237, 187, 78, 0.38);
}

:root[data-cv-scheme="light"] {
  --cv-canvas: var(--cv-s1);
  --cv-side: var(--cv-s0);
  --cv-raised: var(--cv-s2);
  --cv-popover: var(--cv-pop-bg);
  --cv-tint-1: rgba(20, 24, 30, 0.035);
  --cv-tint-2: rgba(20, 24, 30, 0.055);
  --cv-tint-3: rgba(20, 24, 30, 0.09);
  --cv-row-hover: var(--cv-canvas);
  --cv-row-active: var(--cv-raised);
  --cv-edge-top: inset 0 1px 0 rgba(255, 255, 255, 0.9);
  --cv-lift: 0 12px 28px -18px rgba(20, 24, 30, 0.4);
  --cv-fill-edge: inset 0 0 0 1px rgba(20, 24, 30, 0.1);
  --cv-switch-edge: inset 0 0 0 1px var(--cv-hair);
  --cv-switch-track: var(--cv-s4);
  --cv-scrim: rgba(0, 0, 0, 0.75);
  --cv-overlay: color-mix(in srgb, var(--cv-canvas) 62%, transparent);
  --cv-shadow-pop: 0 0 0 1px var(--cv-hair-strong), 0 16px 40px -18px rgba(20, 24, 30, 0.45);
  --cv-shadow-dialog: 0 0 0 1px var(--cv-hair-strong), 0 28px 70px -28px rgba(20, 24, 30, 0.35);
  --cv-shadow-toast: 0 0 0 1px var(--cv-hair-strong), 0 12px 32px -16px rgba(20, 24, 30, 0.3);
  --cv-git-mod: #2f6bd1;
  --cv-breakpoint: #d1242f;
  --cv-match: rgba(180, 120, 0, 0.14);
  --cv-match-current: rgba(180, 120, 0, 0.32);
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --cv-motion-fast: 0ms;
    --cv-motion-base: 0ms;
    --cv-motion-slow: 0ms;
  }
}
```

Create `src/ui/tokens/tokens.css`:

```css
@import "./palettes.css";
@import "./semantic.css";
```

(`legacyBridge.css` is added to this file in Task 6.)

- [ ] **Step 6: Allow the foundation shadow roots in the border contract**

In `src/components/cssContractTestSupport.ts` replace the `SHADOW_TOKEN_ROOTS` constant (lines 185-191) with:

```ts
export const SHADOW_TOKEN_ROOTS = [
  "--codevo-shadow-card",
  "--codevo-shadow-float",
  "--codevo-shadow-window",
  "--codevo-focus-ring",
  "--codevo-separator-inset",
  "--cv-ring-hair",
  "--cv-ring-hair-strong",
  "--cv-ring-focus",
  "--cv-ring-danger",
  "--cv-ring-canvas",
  "--cv-edge-top",
  "--cv-edge-top-hair",
  "--cv-edge-bottom-hair",
  "--cv-lift",
  "--cv-fill-edge",
  "--cv-switch-edge",
  "--cv-shadow-knob",
  "--cv-shadow-pop",
  "--cv-shadow-dialog",
  "--cv-shadow-toast",
] as const;
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/ui/tokens src/components/cssBorderContract.test.ts src/components/cssTokenContract.test.ts src/domain/themeContrast.test.ts`
Expected: PASS. `tokenContrast.test.ts` reports no failures (measured minimum across the gated pairs is 4.59, Zinc · Orange light `synCom` on `s0`; `s4` is intentionally excluded because it is the switch track, not a text surface).

- [ ] **Step 8: Format and type-check**

Run: `npx prettier --write src/domain/appearancePalettes.ts src/ui/tokens/tokenCss.test.ts src/ui/tokens/tokenContrast.test.ts && npm run format:check:changed && npx tsc --noEmit`
Expected: all exit 0.

- [ ] **Step 9: Hand off (no commit)**

---

### Task 3: Editor colour themes (Monaco "Match palette" and terminal)

**Files:**
- Create: `src/domain/cssColor.ts`, `src/domain/editorColorThemes.ts`, `src/infrastructure/paletteSyntaxThemes.ts`
- Modify: `src/domain/settings.ts` (lines 72-82 `MonacoAppTheme`, lines 1041-1062 `TerminalTheme`, lines 1076-1364 `monacoThemeForAppTheme` / `terminalThemeForAppTheme`)
- Modify: `src/infrastructure/shikiHighlighter.ts` (imports, `APP_SHIKI_THEMES` line 325, `createAppHighlighter` themes list line 381-396, `LIGHT_APP_THEMES` line 677-681)
- Test: `src/domain/cssColor.test.ts`, `src/domain/editorColorThemes.test.ts`, `src/infrastructure/paletteSyntaxThemes.test.ts`, `src/infrastructure/shikiHighlighter.test.ts` (append)

**Interfaces:**
- Consumes: Task 1 (`AppearanceSettings`, `ClassicSyntaxThemeId`, `CLASSIC_SYNTAX_THEME_IDS`, `PaletteId`, `ResolvedColorScheme`, `PALETTE_IDS`, `RESOLVED_COLOR_SCHEMES`, `resolveColorScheme`); Task 2 (`paletteTokens`, `surfaceColor`, `SCHEME_SURFACE_ROLES`); existing `ThemePalette` and `buildShikiTheme`.
- Produces:
  - `cssColorToHex(value: string): string` (`#RRGGBB` passthrough, `rgba()` -> `#rrggbbaa`)
  - `type ClassicMonacoTheme`, ``type PaletteMonacoTheme = `cv-${PaletteId}-${ResolvedColorScheme}` ``, `type MonacoAppTheme = ClassicMonacoTheme | PaletteMonacoTheme`
  - `interface TerminalTheme` (moved unchanged from `settings.ts`)
  - `interface EditorColorThemes { readonly colorScheme: ResolvedColorScheme; readonly monacoTheme: MonacoAppTheme; readonly terminalTheme: TerminalTheme }`
  - `paletteMonacoTheme(palette, scheme): PaletteMonacoTheme`, `classicMonacoTheme(id): ClassicMonacoTheme`, `classicTerminalTheme(id): TerminalTheme`, `paletteTerminalTheme(palette, scheme): TerminalTheme`, `resolveEditorColorThemes(appearance: AppearanceSettings, prefersLight: boolean): EditorColorThemes`
  - `paletteSyntaxTheme(palette, scheme): ThemePalette`, `PALETTE_SYNTAX_THEMES: readonly ThemePalette[]` (12 entries, palette-major, dark before light)
  - `settings.ts` keeps exporting `MonacoAppTheme` and `TerminalTheme` (re-export) so the 15 existing importers compile unchanged; `monacoThemeForAppTheme` / `terminalThemeForAppTheme` keep their behaviour by delegating (they are deleted in Task 5).

- [ ] **Step 1: Write the failing tests**

Create `src/domain/cssColor.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cssColorToHex } from "./cssColor";

describe("cssColorToHex", () => {
  it("passes six digit hex colours through", () => {
    expect(cssColorToHex("#4FCDB3")).toBe("#4FCDB3");
    expect(cssColorToHex(" #0e0f10 ")).toBe("#0e0f10");
  });

  it("converts rgba colours to eight digit hex with rounded alpha", () => {
    expect(cssColorToHex("rgba(79, 205, 179, 0.13)")).toBe("#4fcdb321");
    expect(cssColorToHex("rgba(255, 255, 255, 0.07)")).toBe("#ffffff12");
    expect(cssColorToHex("rgba(0,0,0,1)")).toBe("#000000ff");
    expect(cssColorToHex("rgba(20, 24, 30, .09)")).toBe("#14181e17");
  });

  it("rejects colour syntaxes the palettes never use", () => {
    expect(() => cssColorToHex("hsl(0 0% 0%)")).toThrow("Unsupported colour value");
    expect(() => cssColorToHex("#fff")).toThrow("Unsupported colour value");
    expect(() => cssColorToHex("rgba(300, 0, 0, 0.5)")).toThrow("Unsupported colour value");
  });
});
```

Create `src/domain/editorColorThemes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  CLASSIC_SYNTAX_THEME_IDS,
  PALETTE_IDS,
  RESOLVED_COLOR_SCHEMES,
} from "./appearance";
import { surfaceColor } from "./appearancePalettes";
import {
  classicMonacoTheme,
  classicTerminalTheme,
  paletteMonacoTheme,
  paletteTerminalTheme,
  resolveEditorColorThemes,
  type TerminalTheme,
} from "./editorColorThemes";
import { contrastRatio } from "./themeContrast";

const TERMINAL_TEXT_KEYS = [
  "black",
  "blue",
  "brightBlack",
  "brightBlue",
  "brightCyan",
  "brightGreen",
  "brightMagenta",
  "brightRed",
  "brightWhite",
  "brightYellow",
  "cyan",
  "foreground",
  "green",
  "magenta",
  "red",
  "white",
  "yellow",
] as const satisfies readonly (keyof TerminalTheme)[];

describe("resolveEditorColorThemes", () => {
  it("follows the palette and the resolved scheme for Match palette", () => {
    const system = { palette: "ink-mint", colorScheme: "system", syntaxTheme: "matchPalette" } as const;

    expect(resolveEditorColorThemes(system, true)).toMatchObject({
      colorScheme: "light",
      monacoTheme: "cv-ink-mint-light",
    });
    expect(resolveEditorColorThemes(system, false)).toMatchObject({
      colorScheme: "dark",
      monacoTheme: "cv-ink-mint-dark",
    });
    expect(resolveEditorColorThemes(system, false).terminalTheme).toEqual(
      paletteTerminalTheme("ink-mint", "dark"),
    );
  });

  it("keeps a classic syntax theme independent of the chrome scheme", () => {
    const themes = resolveEditorColorThemes(
      { palette: "slate-blue", colorScheme: "light", syntaxTheme: "dracula" },
      false,
    );

    expect(themes.colorScheme).toBe("light");
    expect(themes.monacoTheme).toBe("dracula");
    expect(themes.terminalTheme).toEqual(classicTerminalTheme("dracula"));
  });
});

describe("classic editor themes", () => {
  it("maps every classic syntax theme to its registered Monaco theme", () => {
    expect(CLASSIC_SYNTAX_THEME_IDS.map(classicMonacoTheme)).toEqual([
      "calm-dark",
      "calm-light",
      "ayu-mirage",
      "material-deep-ocean",
      "one-dark-pro",
      "dracula",
      "catppuccin-mocha",
      "catppuccin-latte",
      "one-light",
      "dark-plus",
    ]);
  });

  it("keeps the terminal palettes that shipped before the redesign", () => {
    expect(classicTerminalTheme("classicDark").background).toBe("#111418");
    expect(classicTerminalTheme("classicDark").foreground).toBe("#d8dee9");
    expect(classicTerminalTheme("classicLight").background).toBe("#f4f6f8");
    expect(classicTerminalTheme("classicLight").foreground).toBe("#263240");
    expect(classicTerminalTheme("ayuMirage").background).toBe("#1f2430");
    expect(classicTerminalTheme("materialDeepOcean").background).toBe("#0f111a");
    expect(classicTerminalTheme("darkPlus")).toMatchObject({
      background: "#1e1e1e",
      foreground: "#cccccc",
    });
  });
});

describe("palette editor themes", () => {
  it("names one Monaco theme per palette and scheme", () => {
    expect(paletteMonacoTheme("carbon-lime", "light")).toBe("cv-carbon-lime-light");
  });

  it("paints the terminal on the palette canvas", () => {
    for (const palette of PALETTE_IDS) {
      for (const scheme of RESOLVED_COLOR_SCHEMES) {
        expect(paletteTerminalTheme(palette, scheme).background).toBe(
          surfaceColor(palette, scheme, "canvas"),
        );
      }
    }
  });

  it("keeps every palette terminal and the AA-checked classic terminals readable", () => {
    const themes = [
      ...CLASSIC_SYNTAX_THEME_IDS.filter((theme) => theme !== "darkPlus").map(classicTerminalTheme),
      ...PALETTE_IDS.flatMap((palette) =>
        RESOLVED_COLOR_SCHEMES.map((scheme) => paletteTerminalTheme(palette, scheme)),
      ),
    ];
    const failures = themes.flatMap((theme) =>
      TERMINAL_TEXT_KEYS.filter((key) => contrastRatio(theme[key], theme.background) < 4.5).map(
        (key) => `${key} ${theme[key]} on ${theme.background}`,
      ),
    );

    expect(failures).toEqual([]);
  });
});
```

Create `src/infrastructure/paletteSyntaxThemes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PALETTE_IDS, RESOLVED_COLOR_SCHEMES } from "../domain/appearance";
import { surfaceColor } from "../domain/appearancePalettes";
import { paletteMonacoTheme } from "../domain/editorColorThemes";
import { contrastRatio } from "../domain/themeContrast";
import type { ThemePalette } from "../components/themePalettes";
import { PALETTE_SYNTAX_THEMES, paletteSyntaxTheme } from "./paletteSyntaxThemes";

const READABLE_KEYS = [
  "fg",
  "keyword",
  "func",
  "type",
  "string",
  "number",
  "variable",
  "parameter",
  "property",
  "constant",
  "operator",
  "comment",
  "namespace",
  "regexp",
  "decorator",
] as const satisfies readonly (keyof ThemePalette)[];

describe("palette syntax themes", () => {
  it("registers one theme per palette and scheme", () => {
    expect(PALETTE_SYNTAX_THEMES.map((theme) => theme.name)).toEqual(
      PALETTE_IDS.flatMap((palette) =>
        RESOLVED_COLOR_SCHEMES.map((scheme) => paletteMonacoTheme(palette, scheme)),
      ),
    );
  });

  it("paints the editor on the palette canvas with the matching Monaco base", () => {
    for (const palette of PALETTE_IDS) {
      for (const scheme of RESOLVED_COLOR_SCHEMES) {
        const theme = paletteSyntaxTheme(palette, scheme);
        expect(theme.bg).toBe(surfaceColor(palette, scheme, "canvas"));
        expect(theme.base).toBe(scheme === "dark" ? "vs-dark" : "vs");
      }
    }
  });

  it("uses only hex colours Monaco can parse", () => {
    for (const theme of PALETTE_SYNTAX_THEMES) {
      for (const [key, value] of Object.entries(theme)) {
        if (key === "name" || key === "base" || typeof value !== "string") continue;
        expect(value, `${theme.name} ${key}`).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i);
      }
    }
  });

  it("keeps every syntax colour readable on the editor background", () => {
    const failures = PALETTE_SYNTAX_THEMES.flatMap((theme) =>
      READABLE_KEYS.filter((key) => contrastRatio(theme[key], theme.bg) < 4.5).map(
        (key) => `${theme.name} ${key}`,
      ),
    );

    expect(failures).toEqual([]);
  });
});
```

Append to `src/infrastructure/shikiHighlighter.test.ts`, inside `describe("applyImmediateFallbackTheme", ...)` after the existing two `it` blocks:

```ts
  it("follows the darkness of every palette theme", () => {
    for (const [theme, fallback] of [
      ["cv-graphite-teal-dark", "vs-dark"],
      ["cv-slate-blue-light", "vs"],
      ["cv-carbon-lime-light", "vs"],
      ["cv-zinc-orange-dark", "vs-dark"],
    ] as const) {
      const setTheme = vi.fn();
      applyImmediateFallbackTheme({ editor: { setTheme } }, theme);
      expect(setTheme).toHaveBeenCalledWith(fallback);
    }
  });
```

and inside `describe("APP_SHIKI_THEMES", ...)`:

```ts
  it("includes a Match palette theme for every palette and scheme", () => {
    expect(APP_SHIKI_THEMES).toContain("cv-graphite-teal-dark");
    expect(APP_SHIKI_THEMES).toContain("cv-carbon-lime-light");
    expect(APP_SHIKI_THEMES.filter((theme) => theme.startsWith("cv-"))).toHaveLength(12);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/domain/cssColor.test.ts src/domain/editorColorThemes.test.ts src/infrastructure/paletteSyntaxThemes.test.ts src/infrastructure/shikiHighlighter.test.ts`
Expected: FAIL with unresolved imports `./cssColor`, `./editorColorThemes`, `./paletteSyntaxThemes`, and the two new shiki assertions failing.

- [ ] **Step 3: Implement `cssColor.ts`**

Create `src/domain/cssColor.ts`:

```ts
const HEX6 = /^#[0-9a-f]{6}$/i;
const RGBA = /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0|1|0?\.\d+)\s*\)$/i;

export function cssColorToHex(value: string): string {
  const trimmed = value.trim();
  if (HEX6.test(trimmed)) return trimmed;
  const match = RGBA.exec(trimmed);
  if (match === null) throw new Error(`Unsupported colour value: ${value}`);
  const channels = [match[1], match[2], match[3]].map((channel) => Number(channel ?? "0"));
  if (channels.some((channel) => channel > 255)) {
    throw new Error(`Unsupported colour value: ${value}`);
  }
  const alpha = Math.round(Number(match[4] ?? "1") * 255);
  return `#${[...channels, alpha].map(channelHex).join("")}`;
}

function channelHex(channel: number): string {
  return channel.toString(16).padStart(2, "0");
}
```

- [ ] **Step 4: Implement `editorColorThemes.ts` (move the terminal palettes out of `settings.ts`)**

Create `src/domain/editorColorThemes.ts` with the content below. The ten `TerminalTheme` literals in `CLASSIC_TERMINAL_THEMES` are the exact objects currently returned by `terminalThemeForAppTheme` in `src/domain/settings.ts` (branch at line 1117 -> `ayuMirage`, 1142 -> `materialDeepOcean`, 1167 -> `oneDarkPro`, 1192 -> `dracula`, 1217 -> `catppuccinMocha`, 1242 -> `catppuccinLatte`, 1267 -> `oneLight`, 1292 -> `darkPlus`, the `resolveAppTheme(...) === "light"` branch at 1317 -> `classicLight`, the final return at 1342 -> `classicDark`); they are reproduced below so the move is byte-for-byte checkable.

```ts
import {
  resolveColorScheme,
  type AppearanceSettings,
  type ClassicSyntaxThemeId,
  type PaletteId,
  type ResolvedColorScheme,
} from "./appearance";
import { paletteTokens, surfaceColor } from "./appearancePalettes";
import { cssColorToHex } from "./cssColor";

export type ClassicMonacoTheme =
  | "calm-dark"
  | "calm-light"
  | "ayu-mirage"
  | "material-deep-ocean"
  | "one-dark-pro"
  | "dracula"
  | "catppuccin-mocha"
  | "catppuccin-latte"
  | "one-light"
  | "dark-plus";
export type PaletteMonacoTheme = `cv-${PaletteId}-${ResolvedColorScheme}`;
export type MonacoAppTheme = ClassicMonacoTheme | PaletteMonacoTheme;

export interface TerminalTheme {
  background: string;
  black: string;
  blue: string;
  brightBlack: string;
  brightBlue: string;
  brightCyan: string;
  brightGreen: string;
  brightMagenta: string;
  brightRed: string;
  brightWhite: string;
  brightYellow: string;
  cursor: string;
  cyan: string;
  foreground: string;
  green: string;
  magenta: string;
  red: string;
  selectionBackground: string;
  white: string;
  yellow: string;
}

export interface EditorColorThemes {
  readonly colorScheme: ResolvedColorScheme;
  readonly monacoTheme: MonacoAppTheme;
  readonly terminalTheme: TerminalTheme;
}

const CLASSIC_MONACO_THEMES: Readonly<Record<ClassicSyntaxThemeId, ClassicMonacoTheme>> = {
  classicDark: "calm-dark",
  classicLight: "calm-light",
  ayuMirage: "ayu-mirage",
  materialDeepOcean: "material-deep-ocean",
  oneDarkPro: "one-dark-pro",
  dracula: "dracula",
  catppuccinMocha: "catppuccin-mocha",
  catppuccinLatte: "catppuccin-latte",
  oneLight: "one-light",
  darkPlus: "dark-plus",
};

const CLASSIC_TERMINAL_THEMES: Readonly<Record<ClassicSyntaxThemeId, TerminalTheme>> = {
  ayuMirage: {
    background: "#1f2430",
    black: "#9aa5b7",
    blue: "#73d0ff",
    brightBlack: "#c0cad8",
    brightBlue: "#9fdcff",
    brightCyan: "#b8f4e6",
    brightGreen: "#d5ff80",
    brightMagenta: "#ffb8f0",
    brightRed: "#ffc0b8",
    brightWhite: "#f8f4e3",
    brightYellow: "#ffe6a3",
    cursor: "#ffcc66",
    cyan: "#95e6cb",
    foreground: "#cbccc6",
    green: "#bae67e",
    magenta: "#d4bfff",
    red: "#f28779",
    selectionBackground: "#33415e",
    white: "#d9dee8",
    yellow: "#ffd580",
  },
  materialDeepOcean: {
    background: "#0f111a",
    black: "#8a90b5",
    blue: "#82aaff",
    brightBlack: "#b4b9d4",
    brightBlue: "#9fc1ff",
    brightCyan: "#a3f7f7",
    brightGreen: "#d3f59a",
    brightMagenta: "#e2b6ff",
    brightRed: "#ff9aa0",
    brightWhite: "#ffffff",
    brightYellow: "#ffe0a3",
    cursor: "#84ffff",
    cyan: "#89ddff",
    foreground: "#a6accd",
    green: "#c3e88d",
    magenta: "#c792ea",
    red: "#f07178",
    selectionBackground: "#1f2233",
    white: "#d7dbe8",
    yellow: "#ffcb6b",
  },
  oneDarkPro: {
    background: "#282c34",
    black: "#969cab",
    blue: "#61afef",
    brightBlack: "#abb2bf",
    brightBlue: "#8fc4f5",
    brightCyan: "#7fd4de",
    brightGreen: "#b6e09a",
    brightMagenta: "#dba6e8",
    brightRed: "#f4929a",
    brightWhite: "#ffffff",
    brightYellow: "#f0d29a",
    cursor: "#61afef",
    cyan: "#56b6c2",
    foreground: "#abb2bf",
    green: "#98c379",
    magenta: "#c678dd",
    red: "#e88a91",
    selectionBackground: "#3e4451",
    white: "#cdd3de",
    yellow: "#e5c07b",
  },
  dracula: {
    background: "#282a36",
    black: "#8b93b8",
    blue: "#bd93f9",
    brightBlack: "#b3bbe0",
    brightBlue: "#d6b8ff",
    brightCyan: "#a4ffff",
    brightGreen: "#74ffa0",
    brightMagenta: "#ff92e0",
    brightRed: "#ff8080",
    brightWhite: "#ffffff",
    brightYellow: "#ffffa5",
    cursor: "#f8f8f2",
    cyan: "#8be9fd",
    foreground: "#f8f8f2",
    green: "#50fa7b",
    magenta: "#ff79c6",
    red: "#ff5555",
    selectionBackground: "#44475a",
    white: "#e8e8e3",
    yellow: "#f1fa8c",
  },
  catppuccinMocha: {
    background: "#1e1e2e",
    black: "#9399b2",
    blue: "#89b4fa",
    brightBlack: "#a6adc8",
    brightBlue: "#a6c8ff",
    brightCyan: "#a0eaf0",
    brightGreen: "#c2f0bd",
    brightMagenta: "#f0abdc",
    brightRed: "#f8aec2",
    brightWhite: "#ffffff",
    brightYellow: "#fceec6",
    cursor: "#f5e0dc",
    cyan: "#94e2d5",
    foreground: "#cdd6f4",
    green: "#a6e3a1",
    magenta: "#f5c2e7",
    red: "#f38ba8",
    selectionBackground: "#363a4f",
    white: "#dce0f0",
    yellow: "#f9e2af",
  },
  catppuccinLatte: {
    background: "#eff1f5",
    black: "#4c4f69",
    blue: "#1e5fd6",
    brightBlack: "#383a4f",
    brightBlue: "#1a52c0",
    brightCyan: "#0a6270",
    brightGreen: "#266b1b",
    brightMagenta: "#8c1a9b",
    brightRed: "#b00d2f",
    brightWhite: "#45485c",
    brightYellow: "#7a5200",
    cursor: "#dc8a78",
    cyan: "#0a7080",
    foreground: "#4c4f69",
    green: "#2e7d20",
    magenta: "#a01fb0",
    red: "#d20f39",
    selectionBackground: "#bcc0cc",
    white: "#5c5f77",
    yellow: "#8a5e00",
  },
  oneLight: {
    background: "#fafafa",
    black: "#383a42",
    blue: "#274fb0",
    brightBlack: "#2b2d34",
    brightBlue: "#1f4499",
    brightCyan: "#0a5f6c",
    brightGreen: "#2a6029",
    brightMagenta: "#841d92",
    brightRed: "#b32a1e",
    brightWhite: "#1c1d22",
    brightYellow: "#6a4f00",
    cursor: "#526fff",
    cyan: "#0a6e7a",
    foreground: "#383a42",
    green: "#2f6b2e",
    magenta: "#9020a0",
    red: "#c4331f",
    selectionBackground: "#cfcfcf",
    white: "#4f525e",
    yellow: "#7a5800",
  },
  darkPlus: {
    background: "#1e1e1e",
    black: "#000000",
    blue: "#2472c8",
    brightBlack: "#666666",
    brightBlue: "#3b8eea",
    brightCyan: "#29b8db",
    brightGreen: "#23d18b",
    brightMagenta: "#d670d6",
    brightRed: "#f14c4c",
    brightWhite: "#e5e5e5",
    brightYellow: "#f5f543",
    cursor: "#ffffff",
    cyan: "#11a8cd",
    foreground: "#cccccc",
    green: "#0dbc79",
    magenta: "#bc3fbc",
    red: "#cd3131",
    selectionBackground: "#264f78",
    white: "#e5e5e5",
    yellow: "#e5e510",
  },
  classicLight: {
    background: "#f4f6f8",
    black: "#18212b",
    blue: "#2563eb",
    brightBlack: "#526173",
    brightBlue: "#2563eb",
    brightCyan: "#0f766e",
    brightGreen: "#15803d",
    brightMagenta: "#9333ea",
    brightRed: "#b91c1c",
    brightWhite: "#18212b",
    brightYellow: "#b45309",
    cursor: "#263240",
    cyan: "#0f766e",
    foreground: "#263240",
    green: "#15803d",
    magenta: "#7e22ce",
    red: "#b91c1c",
    selectionBackground: "#d5e8e5",
    white: "#526173",
    yellow: "#a16207",
  },
  classicDark: {
    background: "#111418",
    black: "#7f8b9a",
    blue: "#7aa2f7",
    brightBlack: "#aeb7c3",
    brightBlue: "#9bbcff",
    brightCyan: "#9ed0c5",
    brightGreen: "#a7d08c",
    brightMagenta: "#d6a5dd",
    brightRed: "#f2a6a6",
    brightWhite: "#f3f6f8",
    brightYellow: "#e6c27a",
    cursor: "#d8dee9",
    cyan: "#7dc5bc",
    foreground: "#d8dee9",
    green: "#8fcb7f",
    magenta: "#c49ad4",
    red: "#e58b8b",
    selectionBackground: "#33414f",
    white: "#d8dee9",
    yellow: "#d7b56d",
  },
};

const SCHEME_BASE_TERMINAL: Readonly<Record<ResolvedColorScheme, ClassicSyntaxThemeId>> = {
  dark: "classicDark",
  light: "classicLight",
};

export function paletteMonacoTheme(
  palette: PaletteId,
  scheme: ResolvedColorScheme,
): PaletteMonacoTheme {
  return `cv-${palette}-${scheme}`;
}

export function classicMonacoTheme(theme: ClassicSyntaxThemeId): ClassicMonacoTheme {
  return CLASSIC_MONACO_THEMES[theme];
}

export function classicTerminalTheme(theme: ClassicSyntaxThemeId): TerminalTheme {
  return CLASSIC_TERMINAL_THEMES[theme];
}

export function paletteTerminalTheme(
  palette: PaletteId,
  scheme: ResolvedColorScheme,
): TerminalTheme {
  const tokens = paletteTokens(palette, scheme);
  return {
    ...CLASSIC_TERMINAL_THEMES[SCHEME_BASE_TERMINAL[scheme]],
    background: surfaceColor(palette, scheme, "canvas"),
    black: tokens.fgSubtle,
    brightBlack: tokens.fgMuted,
    brightGreen: tokens.ok,
    brightRed: tokens.danger,
    brightWhite: tokens.fgStrong,
    brightYellow: tokens.warn,
    cursor: tokens.accent,
    foreground: tokens.fg,
    green: tokens.ok,
    red: tokens.danger,
    selectionBackground: cssColorToHex(tokens.selection),
    white: tokens.fg,
    yellow: tokens.warn,
  };
}

export function resolveEditorColorThemes(
  appearance: AppearanceSettings,
  prefersLight: boolean,
): EditorColorThemes {
  const colorScheme = resolveColorScheme(appearance.colorScheme, prefersLight);
  if (appearance.syntaxTheme === "matchPalette") {
    return {
      colorScheme,
      monacoTheme: paletteMonacoTheme(appearance.palette, colorScheme),
      terminalTheme: paletteTerminalTheme(appearance.palette, colorScheme),
    };
  }
  return {
    colorScheme,
    monacoTheme: classicMonacoTheme(appearance.syntaxTheme),
    terminalTheme: classicTerminalTheme(appearance.syntaxTheme),
  };
}
```

- [ ] **Step 5: Make `settings.ts` delegate to the new module**

In `src/domain/settings.ts`:

1. Delete the `export type MonacoAppTheme = ...` union (lines 72-82).
2. Delete `export interface TerminalTheme { ... }` (lines 1041-1062).
3. Add after the last existing import:

```ts
import type { ClassicSyntaxThemeId } from "./appearance";
import {
  classicMonacoTheme,
  classicTerminalTheme,
  type MonacoAppTheme,
  type TerminalTheme,
} from "./editorColorThemes";

export type { MonacoAppTheme, TerminalTheme } from "./editorColorThemes";
```

4. Replace the whole body range of `monacoThemeForAppTheme` and `terminalThemeForAppTheme` (from `export function monacoThemeForAppTheme` at line 1076 through the closing brace of `terminalThemeForAppTheme`, the line before `function isRecord`) with:

```ts
export function monacoThemeForAppTheme(theme: AppTheme, prefersLight = false): MonacoAppTheme {
  return classicMonacoTheme(classicSyntaxThemeForAppTheme(theme, prefersLight));
}

export function terminalThemeForAppTheme(theme: AppTheme, prefersLight = false): TerminalTheme {
  return classicTerminalTheme(classicSyntaxThemeForAppTheme(theme, prefersLight));
}

function classicSyntaxThemeForAppTheme(theme: AppTheme, prefersLight: boolean): ClassicSyntaxThemeId {
  if (theme !== "dark" && theme !== "light" && theme !== "system") return theme;
  if (resolveAppTheme(theme, prefersLight) === "light") return "classicLight";
  return "classicDark";
}
```

The existing `settings.test.ts` blocks `monacoThemeForAppTheme`, `terminalThemeForAppTheme` and `src/domain/themeContrast.test.ts` "keeps terminal text colors readable in app themes" must still pass unchanged: this is the behaviour-preservation check for the move.

- [ ] **Step 6: Implement the palette syntax themes**

Create `src/infrastructure/paletteSyntaxThemes.ts`:

```ts
import {
  PALETTE_IDS,
  RESOLVED_COLOR_SCHEMES,
  type PaletteId,
  type ResolvedColorScheme,
} from "../domain/appearance";
import { paletteTokens, surfaceColor } from "../domain/appearancePalettes";
import { cssColorToHex } from "../domain/cssColor";
import { paletteMonacoTheme } from "../domain/editorColorThemes";
import type { ThemePalette } from "../components/themePalettes";

export function paletteSyntaxTheme(palette: PaletteId, scheme: ResolvedColorScheme): ThemePalette {
  const tokens = paletteTokens(palette, scheme);
  const side = surfaceColor(palette, scheme, "side");
  return {
    name: paletteMonacoTheme(palette, scheme),
    base: scheme === "dark" ? "vs-dark" : "vs",
    bg: surfaceColor(palette, scheme, "canvas"),
    fg: tokens.fg,
    lineHighlight: side,
    selection: cssColorToHex(tokens.selection),
    cursor: tokens.accent,
    lineNumber: tokens.fgSubtle,
    lineNumberActive: tokens.fgMuted,
    whitespace: tokens.s4,
    widgetBg: tokens.popBg,
    border: cssColorToHex(tokens.hairStrong),
    selectedBg: tokens.s3,
    selectedFg: tokens.fgStrong,
    accent: tokens.accent,
    inputBg: side,
    diffInserted: cssColorToHex(tokens.addBg),
    diffRemoved: cssColorToHex(tokens.delBg),
    keyword: tokens.synKw,
    func: tokens.accent,
    type: tokens.warn,
    string: tokens.synStr,
    number: tokens.synNum,
    variable: tokens.fg,
    parameter: tokens.fg,
    property: tokens.fg,
    constant: tokens.synNum,
    operator: tokens.fgMuted,
    comment: tokens.synCom,
    commentItalic: true,
    namespace: tokens.fgMuted,
    regexp: tokens.synStr,
    decorator: tokens.synKw,
  };
}

export const PALETTE_SYNTAX_THEMES: readonly ThemePalette[] = PALETTE_IDS.flatMap((palette) =>
  RESOLVED_COLOR_SCHEMES.map((scheme) => paletteSyntaxTheme(palette, scheme)),
);
```

- [ ] **Step 7: Register the palette themes with Shiki/Monaco**

In `src/infrastructure/shikiHighlighter.ts`:

1. Add after the `../components/themePalettes` import: `import { PALETTE_SYNTAX_THEMES } from "./paletteSyntaxThemes";`
2. In `APP_SHIKI_THEMES` add as the last element: `...PALETTE_SYNTAX_THEMES.map((palette) => palette.name),`
3. In `createAppHighlighter`, in the `themes: [...]` array, add after `...customPalettes.map((palette) => buildShikiTheme(palette)),`: `...PALETTE_SYNTAX_THEMES.map((palette) => buildShikiTheme(palette)),`
4. Replace `LIGHT_APP_THEMES` with:

```ts
const LIGHT_APP_THEMES = new Set([
  "calm-light",
  "one-light",
  "catppuccin-latte",
  ...PALETTE_SYNTAX_THEMES.filter((palette) => palette.base === "vs").map((palette) => palette.name),
]);
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/domain/cssColor.test.ts src/domain/editorColorThemes.test.ts src/infrastructure/paletteSyntaxThemes.test.ts src/infrastructure/shikiHighlighter.test.ts src/domain/settings.test.ts src/domain/themeContrast.test.ts src/components/agentMode/shikiAgentCodeColorizer.test.ts`
Expected: PASS (the `createAppHighlighter` "loads all app themes" test now also loads the 12 palette themes).

- [ ] **Step 9: Format and type-check**

Run: `npx prettier --write src/domain/cssColor.ts src/domain/cssColor.test.ts src/domain/editorColorThemes.ts src/domain/editorColorThemes.test.ts src/infrastructure/paletteSyntaxThemes.ts src/infrastructure/paletteSyntaxThemes.test.ts && npm run format:check:changed && npx tsc --noEmit`
Expected: exit 0. If `format:check:changed` lists `src/domain/settings.ts` or `src/infrastructure/shikiHighlighter.ts`, run `npx prettier --write` on that one file only.

- [ ] **Step 10: Hand off (no commit)**

---

### Task 4: Startup appearance (pre-React paint)

**Files:**
- Modify: `src/domain/startupTheme.ts` (add the appearance API; the old theme API stays until Task 5)
- Modify: `src/startupTheme.ts` (full rewrite)
- Modify: `public/startup.css` (lines 1-119: root tones and theme blocks)
- Modify: `src-tauri/tauri.conf.json` (line 17) and `src-tauri/tauri.macos.conf.json` (line 8): native window `backgroundColor` (JSON config only, no Rust code)
- Test: `src/domain/startupTheme.test.ts` (append), `src/startupTheme.test.ts` (full rewrite), `src/startupDocument.test.ts` (tone tests)

**Interfaces:**
- Consumes: Task 1 (`normalizeAppearance`, `resolveColorScheme`, `DEFAULT_APPEARANCE`, `PALETTE_ATTRIBUTE`, `COLOR_SCHEME_ATTRIBUTE`, `PALETTE_IDS`, `RESOLVED_COLOR_SCHEMES`), Task 2 (`paletteTokens`, `surfaceColor`).
- Produces:
  - `interface DocumentAppearance { readonly palette: PaletteId; readonly colorScheme: ResolvedColorScheme }`
  - `readPersistedAppearance(rawSettings: string | null): AppearanceSettings`
  - `resolveStartupAppearance(rawSettings: string | null, prefersLight: boolean): DocumentAppearance`
  - `interface StartupThemeEnvironment { prefersLight(): boolean; readSetting(key: string): string | null; setDocumentAttribute(name: string, value: string): void }`, `applyStartupTheme(environment)`, `applyBrowserStartupTheme()`, `browserStartupThemeEnvironment()`
  - `public/startup.css`: `--startup-*` tones keyed on `:root[data-cv-palette][data-cv-scheme]`; bare `:root` carries Graphite · Teal dark.

- [ ] **Step 1: Write the failing tests**

Append to `src/domain/startupTheme.test.ts` (keep the existing blocks; add the imports `readPersistedAppearance, resolveStartupAppearance` to the existing `./startupTheme` import and `import { DEFAULT_APPEARANCE } from "./appearance";`):

```ts
describe("resolveStartupAppearance", () => {
  function raw(value: unknown): string {
    return JSON.stringify({ editorFontSize: 13, ...(value as object) });
  }

  it("stamps the persisted palette and resolves the chrome scheme", () => {
    const settings = raw({
      appearance: { palette: "zinc-orange", colorScheme: "system", syntaxTheme: "dracula" },
    });

    expect(resolveStartupAppearance(settings, true)).toEqual({
      palette: "zinc-orange",
      colorScheme: "light",
    });
    expect(resolveStartupAppearance(settings, false)).toEqual({
      palette: "zinc-orange",
      colorScheme: "dark",
    });
  });

  it("migrates a legacy light theme before the app has saved an appearance", () => {
    expect(resolveStartupAppearance(raw({ theme: "catppuccinLatte" }), false)).toEqual({
      palette: "graphite-teal",
      colorScheme: "light",
    });
  });

  it("falls closed to the default appearance for missing, oversized and malformed settings", () => {
    expect(readPersistedAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(readPersistedAppearance("{")).toEqual(DEFAULT_APPEARANCE);
    expect(readPersistedAppearance("[]")).toEqual(DEFAULT_APPEARANCE);
    expect(readPersistedAppearance(`"${"x".repeat(MAX_STARTUP_SETTINGS_LENGTH)}"`)).toEqual(
      DEFAULT_APPEARANCE,
    );
    expect(resolveStartupAppearance(null, true)).toEqual({
      palette: "graphite-teal",
      colorScheme: "dark",
    });
  });
});
```

Replace the whole content of `src/startupTheme.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { COLOR_SCHEME_ATTRIBUTE, PALETTE_ATTRIBUTE } from "./domain/appearance";
import { STARTUP_APP_SETTINGS_KEY } from "./domain/startupTheme";
import { APP_SETTINGS_KEY } from "./infrastructure/browserSettingsGateway";
import { applyStartupTheme, type StartupThemeEnvironment } from "./startupTheme";

interface Applied {
  readonly attributes: Record<string, string>;
  readonly requestedKeys: readonly string[];
}

function apply(environment: Partial<StartupThemeEnvironment>): Applied {
  const attributes: Record<string, string> = {};
  const requestedKeys: string[] = [];
  applyStartupTheme({
    prefersLight: () => false,
    readSetting: (key) => {
      requestedKeys.push(key);
      return null;
    },
    setDocumentAttribute: (name, value) => {
      attributes[name] = value;
    },
    ...environment,
  });
  return { attributes, requestedKeys };
}

const DEFAULT_ATTRIBUTES = {
  [PALETTE_ATTRIBUTE]: "graphite-teal",
  [COLOR_SCHEME_ATTRIBUTE]: "dark",
};

describe("applyStartupTheme", () => {
  it("reads the same storage key the settings gateway persists", () => {
    expect(STARTUP_APP_SETTINGS_KEY).toBe(APP_SETTINGS_KEY);
    expect(apply({}).requestedKeys).toEqual([STARTUP_APP_SETTINGS_KEY]);
  });

  it("stamps the persisted palette and scheme on the document element", () => {
    const applied = apply({
      readSetting: () =>
        JSON.stringify({
          appearance: { palette: "ink-mint", colorScheme: "light", syntaxTheme: "matchPalette" },
        }),
    });

    expect(applied.attributes).toEqual({
      [PALETTE_ATTRIBUTE]: "ink-mint",
      [COLOR_SCHEME_ATTRIBUTE]: "light",
    });
  });

  it("resolves the system scheme through the reported colour scheme", () => {
    const raw = JSON.stringify({
      appearance: { palette: "slate-blue", colorScheme: "system", syntaxTheme: "matchPalette" },
    });

    expect(apply({ prefersLight: () => true, readSetting: () => raw }).attributes).toEqual({
      [PALETTE_ATTRIBUTE]: "slate-blue",
      [COLOR_SCHEME_ATTRIBUTE]: "light",
    });
    expect(apply({ prefersLight: () => false, readSetting: () => raw }).attributes).toEqual({
      [PALETTE_ATTRIBUTE]: "slate-blue",
      [COLOR_SCHEME_ATTRIBUTE]: "dark",
    });
  });

  it("falls closed to Graphite · Teal dark when storage throws", () => {
    const applied = apply({
      readSetting: () => {
        throw new Error("storage disabled");
      },
    });

    expect(applied.attributes).toEqual(DEFAULT_ATTRIBUTES);
  });

  it("falls closed to dark when the colour-scheme query throws", () => {
    const applied = apply({
      prefersLight: () => {
        throw new Error("matchMedia unavailable");
      },
      readSetting: () => JSON.stringify({ theme: "system" }),
    });

    expect(applied.attributes).toEqual(DEFAULT_ATTRIBUTES);
  });

  it("falls closed when storage returns a non-string", () => {
    const applied = apply({ readSetting: () => ({}) as unknown as string });

    expect(applied.attributes).toEqual(DEFAULT_ATTRIBUTES);
  });
});
```

In `src/startupDocument.test.ts`:

1. Replace `import { STARTUP_THEME_IDS } from "./domain/startupTheme";` with:

```ts
import {
  PALETTE_IDS,
  RESOLVED_COLOR_SCHEMES,
  type PaletteId,
  type ResolvedColorScheme,
} from "./domain/appearance";
import { paletteTokens, surfaceColor } from "./domain/appearancePalettes";
```

2. Replace the `APP_TOKEN_FOR_TONE` constant and the `TONE_KEYS` line (lines 26-35) with:

```ts
const TONE_KEYS = [
  "--startup-side",
  "--startup-canvas",
  "--startup-well",
  "--startup-accent",
  "--startup-text",
  "--startup-text-muted",
  "--startup-danger",
] as const;
type StartupTone = (typeof TONE_KEYS)[number];
const STARTUP_WELL_STEP = { dark: "s2", light: "s3" } as const;
```

3. Replace the `startupTone` function and delete the `appTone` function (lines 135-162) with:

```ts
function startupTone(
  palette: PaletteId,
  scheme: ResolvedColorScheme,
  tone: StartupTone,
): string | undefined {
  const selector = `:root[data-cv-palette="${palette}"][data-cv-scheme="${scheme}"]`;
  const themed = lastOf(buildTokenTable(startupRules(selector)).get(tone));
  if (themed !== undefined) {
    return themed;
  }

  return lastOf(buildTokenTable(startupRules(":root")).get(tone));
}

function expectedStartupTone(
  palette: PaletteId,
  scheme: ResolvedColorScheme,
  tone: StartupTone,
): string {
  const tokens = paletteTokens(palette, scheme);
  switch (tone) {
    case "--startup-side":
      return surfaceColor(palette, scheme, "side");
    case "--startup-canvas":
      return surfaceColor(palette, scheme, "canvas");
    case "--startup-well":
      return tokens[STARTUP_WELL_STEP[scheme]];
    case "--startup-accent":
      return tokens.accent;
    case "--startup-text":
      return tokens.fgStrong;
    case "--startup-text-muted":
      return tokens.fgMuted;
    case "--startup-danger":
      return tokens.danger;
  }
}
```

4. Delete the `it("keeps the resolved system theme in step with the light theme block", ...)` block (System is resolved in JavaScript before paint now; `src/startupTheme.test.ts` pins it) and remove the now-unused `SYSTEM_LIGHT_CONTEXT` and `SYSTEM_THEME_SELECTOR` names from the `./components/cssContractTestSupport` import (`noUnusedLocals` is on).

5. Replace the `it("tones every theme from the same values the real theme declares", ...)` and `it("never paints a white surface in any theme", ...)` blocks with:

```ts
  it("tones every palette from the same values the real palette declares", () => {
    for (const palette of PALETTE_IDS) {
      for (const scheme of RESOLVED_COLOR_SCHEMES) {
        for (const tone of TONE_KEYS) {
          expect(startupTone(palette, scheme, tone), `${palette} ${scheme} ${tone}`).toBe(
            expectedStartupTone(palette, scheme, tone),
          );
        }
      }
    }
  });

  it("never paints a white surface in any palette", () => {
    for (const palette of PALETTE_IDS) {
      for (const scheme of RESOLVED_COLOR_SCHEMES) {
        for (const tone of SURFACE_TONE_KEYS) {
          const value = startupTone(palette, scheme, tone) ?? "";
          expect(value, `${palette} ${scheme} ${tone}`).toMatch(HEX_TONE);
          expect(isPureWhite(value), `${palette} ${scheme} ${tone}`).toBe(false);
        }
      }
    }
  });
```

6. In `describe("native window background", ...)` replace `const darkSide = startupTone("dark", "--startup-side");` with `const darkSide = startupTone("graphite-teal", "dark", "--startup-side");`. The test pins the native Tauri window background to the default palette's dark side tone, so Step 5 also updates the two Tauri configs.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/domain/startupTheme.test.ts src/startupTheme.test.ts src/startupDocument.test.ts`
Expected: FAIL (`resolveStartupAppearance` not exported, `setDocumentAttribute` not called, startup tones mismatch).

- [ ] **Step 3: Add the appearance API to `src/domain/startupTheme.ts`**

Add at the top:

```ts
import {
  DEFAULT_APPEARANCE,
  normalizeAppearance,
  resolveColorScheme,
  type AppearanceSettings,
  type PaletteId,
  type ResolvedColorScheme,
} from "./appearance";
```

Append at the end of the file:

```ts
export interface DocumentAppearance {
  readonly palette: PaletteId;
  readonly colorScheme: ResolvedColorScheme;
}

export function readPersistedAppearance(rawSettings: string | null): AppearanceSettings {
  if (rawSettings === null) return DEFAULT_APPEARANCE;
  if (rawSettings.length > MAX_STARTUP_SETTINGS_LENGTH) return DEFAULT_APPEARANCE;
  const parsed = parseStartupSettings(rawSettings);
  if (parsed === null) return DEFAULT_APPEARANCE;
  return normalizeAppearance(parsed.appearance, parsed.theme);
}

export function resolveStartupAppearance(
  rawSettings: string | null,
  prefersLight: boolean,
): DocumentAppearance {
  const appearance = readPersistedAppearance(rawSettings);
  return {
    palette: appearance.palette,
    colorScheme: resolveColorScheme(appearance.colorScheme, prefersLight),
  };
}
```

- [ ] **Step 4: Rewrite `src/startupTheme.ts`**

```ts
import { COLOR_SCHEME_ATTRIBUTE, PALETTE_ATTRIBUTE } from "./domain/appearance";
import { resolveStartupAppearance, STARTUP_APP_SETTINGS_KEY } from "./domain/startupTheme";

export interface StartupThemeEnvironment {
  readonly prefersLight: () => boolean;
  readonly readSetting: (key: string) => string | null;
  readonly setDocumentAttribute: (name: string, value: string) => void;
}

export function applyStartupTheme(environment: StartupThemeEnvironment): void {
  const appearance = resolveStartupAppearance(
    readSettingSafely(environment),
    prefersLightSafely(environment),
  );
  environment.setDocumentAttribute(PALETTE_ATTRIBUTE, appearance.palette);
  environment.setDocumentAttribute(COLOR_SCHEME_ATTRIBUTE, appearance.colorScheme);
}

export function applyBrowserStartupTheme(): void {
  try {
    applyStartupTheme(browserStartupThemeEnvironment());
  } catch {
    return;
  }
}

export function browserStartupThemeEnvironment(): StartupThemeEnvironment {
  return {
    prefersLight: () => window.matchMedia("(prefers-color-scheme: light)").matches,
    readSetting: (key) => localStorage.getItem(key),
    setDocumentAttribute: (name, value) => document.documentElement.setAttribute(name, value),
  };
}

function readSettingSafely(environment: StartupThemeEnvironment): string | null {
  try {
    const value = environment.readSetting(STARTUP_APP_SETTINGS_KEY);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

function prefersLightSafely(environment: StartupThemeEnvironment): boolean {
  try {
    return environment.prefersLight() === true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Rewrite the startup tones in `public/startup.css`**

In the `:root` block (lines 1-19) replace the seven tone declarations with:

```css
  --startup-side: #151616;
  --startup-canvas: #0E0F10;
  --startup-accent: #4FCDB3;
  --startup-text: #F3F3F5;
  --startup-text-muted: #B0B1B2;
  --startup-danger: #F48A80;
  --startup-well: #1C1C1D;
```

Delete the ten `:root[data-startup-theme="..."]` blocks (lines 21-119) and insert in their place:

```css
:root[data-cv-palette="graphite-teal"][data-cv-scheme="light"] {
  --startup-side: #EDEEEF;
  --startup-canvas: #F6F7F8;
  --startup-accent: #0A7461;
  --startup-text: #151617;
  --startup-text-muted: #4C4D4E;
  --startup-danger: #BC3328;
  --startup-well: #E9EAEB;
  color-scheme: light;
}

:root[data-cv-palette="slate-blue"][data-cv-scheme="dark"] {
  --startup-side: #10161F;
  --startup-canvas: #090F18;
  --startup-accent: #62A6FF;
  --startup-text: #EEF4FC;
  --startup-text-muted: #ACB1B9;
  --startup-danger: #FF8A8F;
  --startup-well: #161D26;
  color-scheme: dark;
}

:root[data-cv-palette="slate-blue"][data-cv-scheme="light"] {
  --startup-side: #E9EEF5;
  --startup-canvas: #F2F7FE;
  --startup-accent: #1D5ED4;
  --startup-text: #10161F;
  --startup-text-muted: #464E58;
  --startup-danger: #BA2A38;
  --startup-well: #E5EAF1;
  color-scheme: light;
}

:root[data-cv-palette="black-violet"][data-cv-scheme="dark"] {
  --startup-side: #0C0C0C;
  --startup-canvas: #060606;
  --startup-accent: #A98BFF;
  --startup-text: #F5F5F5;
  --startup-text-muted: #AFAFAF;
  --startup-danger: #FF7A8E;
  --startup-well: #141414;
  color-scheme: dark;
}

:root[data-cv-palette="black-violet"][data-cv-scheme="light"] {
  --startup-side: #F0F0F0;
  --startup-canvas: #F8F8F8;
  --startup-accent: #6D28D9;
  --startup-text: #121212;
  --startup-text-muted: #4D4D4D;
  --startup-danger: #BE123C;
  --startup-well: #EBEBEB;
  color-scheme: light;
}

:root[data-cv-palette="ink-mint"][data-cv-scheme="dark"] {
  --startup-side: #0F1526;
  --startup-canvas: #090F1E;
  --startup-accent: #5EEAAE;
  --startup-text: #EFF3FD;
  --startup-text-muted: #ADB1BA;
  --startup-danger: #FF8E96;
  --startup-well: #161D2E;
  color-scheme: dark;
}

:root[data-cv-palette="ink-mint"][data-cv-scheme="light"] {
  --startup-side: #E9EEF6;
  --startup-canvas: #F2F7FF;
  --startup-accent: #066F48;
  --startup-text: #0E1624;
  --startup-text-muted: #444D5E;
  --startup-danger: #B92C3B;
  --startup-well: #E5EAF2;
  color-scheme: light;
}

:root[data-cv-palette="zinc-orange"][data-cv-scheme="dark"] {
  --startup-side: #151518;
  --startup-canvas: #0F0F12;
  --startup-accent: #FF8A3D;
  --startup-text: #F3F3F7;
  --startup-text-muted: #B1B1B4;
  --startup-danger: #FF6F8A;
  --startup-well: #1C1C1F;
  color-scheme: dark;
}

:root[data-cv-palette="zinc-orange"][data-cv-scheme="light"] {
  --startup-side: #EDEDF1;
  --startup-canvas: #F6F6FA;
  --startup-accent: #B73E00;
  --startup-text: #161619;
  --startup-text-muted: #4D4D50;
  --startup-danger: #C41E4E;
  --startup-well: #E9E9ED;
  color-scheme: light;
}

:root[data-cv-palette="carbon-lime"][data-cv-scheme="dark"] {
  --startup-side: #0F1112;
  --startup-canvas: #090B0C;
  --startup-accent: #C6F13F;
  --startup-text: #F2F4F5;
  --startup-text-muted: #B0B1B3;
  --startup-danger: #FF7B7B;
  --startup-well: #161819;
  color-scheme: dark;
}

:root[data-cv-palette="carbon-lime"][data-cv-scheme="light"] {
  --startup-side: #ECEEF0;
  --startup-canvas: #F5F7F9;
  --startup-accent: #436E00;
  --startup-text: #151618;
  --startup-text-muted: #4B4D4F;
  --startup-danger: #C42B2B;
  --startup-well: #E8EAEC;
  color-scheme: light;
}
```

Leave everything from `*,` (the box-sizing reset) to the end of the file unchanged. `wc -c public/startup.css` must stay below 12000 (expected about 6300).

In `src-tauri/tauri.conf.json` (line 17) and `src-tauri/tauri.macos.conf.json` (line 8) replace `"backgroundColor": "#0c0d10",` with `"backgroundColor": "#151616",` (Graphite · Teal dark `side`, the colour the startup skeleton paints first).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/domain/startupTheme.test.ts src/startupTheme.test.ts src/startupDocument.test.ts src/startupMount.test.tsx src/startupShell.test.ts`
Expected: PASS. The old `resolveStartupTheme` / `STARTUP_THEME_IDS` tests in `src/domain/startupTheme.test.ts` still pass because the old API is still present.

- [ ] **Step 7: Format and type-check**

Run: `npx prettier --write src/startupTheme.ts src/startupTheme.test.ts && npm run format:check:changed && npx tsc --noEmit`
Expected: exit 0 (prettier-write `src/domain/startupTheme.ts`, `src/domain/startupTheme.test.ts` or `src/startupDocument.test.ts` only if the changed-format gate lists them).

- [ ] **Step 8: Hand off (no commit)**

---

### Task 5: `AppSettings.appearance` replaces `theme`; runtime application; Appearance page

**Files:**
- Modify: `src/domain/settings.ts`, `src/domain/agentSettings.ts`, `src/domain/startupTheme.ts`
- Modify: `src/components/useAppWorkbenchThemes.ts`, `src/App.tsx` (lines 637-640, 1040, 1065), `src/components/WorkbenchShellFrame.tsx` (lines 2-5, 36, 48, 96), `src/components/remoteRunner/RemoteTerminalPanel.tsx` (lines 12, 16)
- Modify: `src/components/settings/pages/AppearanceSettingsPage.tsx`, `src/components/settings/settingsRegistryRows.ts` (lines 132-145), `src/components/settings/settings.css` (`.settings-theme` rule, lines 501-506)
- Create: `src/components/useDocumentAppearance.ts`, `src/components/settings/pages/AppearancePaletteSwatches.tsx`
- Delete: `src/components/useDocumentStartupTheme.ts`, `src/components/useDocumentStartupTheme.test.tsx`, `src/components/settings/pages/ThemeSwatches.tsx`, `src/components/settings/pages/ThemeSwatches.test.tsx`
- Test (create): `src/components/useAppWorkbenchThemes.test.tsx`, `src/components/settings/pages/AppearancePaletteSwatches.test.tsx`
- Test (modify): `src/App.commandRouting.test.tsx`, `src/App.gitDiffBoundary.test.tsx`, `src/App.gitDiffClick.test.tsx`, `src/components/settings/settingsSearch.test.ts`, `src/application/useDockedTextSearch.test.ts`, `src/components/TerminalPanel.test.tsx`, `src/components/TerminalTabsPanel.test.tsx`, `src/components/BottomPanel.test.tsx`, `src/components/agentMode/AgentWorkbenchScreen.test.tsx`, `src/domain/settings.test.ts`, `src/domain/agentSettings.test.ts`, `src/domain/startupTheme.test.ts`, `src/domain/themeContrast.test.ts`, `src/infrastructure/browserSettingsGateway.test.ts`, `src/components/settings/settingsDraftPersistence.test.ts`, `src/components/settings/settingsRegistry.test.ts`, `src/components/settings/pages/AppearanceSettingsPage.test.tsx`, `src/components/WorkbenchShellFrame.test.tsx`, `src/application/useAgentProviderManagement.test.tsx`, `src/application/workbenchController/useWorkbenchSettingsPersistence.test.tsx`, `src/application/useWorkbenchWorkspaceTabCloseCoordinator.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`AppearanceSettings`, `DEFAULT_APPEARANCE`, `normalizeAppearance`, labels, guards, attribute names), Task 2 (`paletteTokens`), Task 3 (`resolveEditorColorThemes`, `classicTerminalTheme`, `MonacoAppTheme`, `TerminalTheme`), Task 4 (`resolveStartupAppearance` stays the only startup API).
- Produces:
  - `AppSettings.appearance: AppearanceSettings` (replaces `theme: AppTheme`); `AppSettings.agentAppearanceVariant` removed; `normalizeAppSettings` migrates the legacy `theme` field once.
  - `useDocumentAppearance(palette: PaletteId, colorScheme: ResolvedColorScheme): void`
  - `useAppWorkbenchThemes(appearance: AppearanceSettings, prefersLightTheme: boolean): AppWorkbenchThemes` where `interface AppWorkbenchThemes { readonly colorScheme: ResolvedColorScheme; readonly monacoTheme: MonacoAppTheme; readonly terminalTheme: TerminalTheme }`
  - `.app-shell[data-theme]` now carries the resolved scheme (`"dark" | "light"`), so every existing `.app-shell[data-theme="light"]` rule keeps working.
  - Settings rows `appearance.palette`, `appearance.colorScheme`, `appearance.syntaxTheme` (replace `appearance.theme`, `appearance.agentAppearance`).
  - Removed exports: `appThemeOptions`, `AppTheme`, `ResolvedAppTheme`, `resolveAppTheme`, `monacoThemeForAppTheme`, `terminalThemeForAppTheme` (settings.ts); `AGENT_APPEARANCE_VARIANTS`, `AgentAppearanceVariant`, `DEFAULT_AGENT_APPEARANCE_VARIANT`, `normalizeAgentAppearanceVariant` (agentSettings.ts); `STARTUP_THEME_ATTRIBUTE`, `STARTUP_THEME_IDS`, `StartupThemeId`, `StartupSurfaceTheme`, `FALLBACK_STARTUP_THEME`, `resolveStartupTheme`, `startupThemeFor`, `readPersistedStartupTheme` (startupTheme.ts).

- [ ] **Step 1: Write the new failing tests**

Create `src/components/useAppWorkbenchThemes.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  COLOR_SCHEME_ATTRIBUTE,
  PALETTE_ATTRIBUTE,
  type AppearanceSettings,
} from "../domain/appearance";
import { useAppWorkbenchThemes, type AppWorkbenchThemes } from "./useAppWorkbenchThemes";

let host: HTMLElement | null = null;
let latest: AppWorkbenchThemes | null = null;

afterEach(() => {
  host?.remove();
  host = null;
  latest = null;
  document.documentElement.removeAttribute(PALETTE_ATTRIBUTE);
  document.documentElement.removeAttribute(COLOR_SCHEME_ATTRIBUTE);
});

function Probe({
  appearance,
  prefersLight,
}: {
  readonly appearance: AppearanceSettings;
  readonly prefersLight: boolean;
}) {
  latest = useAppWorkbenchThemes(appearance, prefersLight);
  return null;
}

function mount(appearance: AppearanceSettings, prefersLight: boolean) {
  const container = document.createElement("div");
  document.body.append(container);
  host = container;
  const root = createRoot(container);
  const render = (nextAppearance: AppearanceSettings, nextPrefersLight: boolean) => {
    act(() => {
      root.render(<Probe appearance={nextAppearance} prefersLight={nextPrefersLight} />);
    });
  };
  render(appearance, prefersLight);
  return render;
}

function stamped() {
  return {
    palette: document.documentElement.getAttribute(PALETTE_ATTRIBUTE),
    scheme: document.documentElement.getAttribute(COLOR_SCHEME_ATTRIBUTE),
  };
}

describe("useAppWorkbenchThemes", () => {
  it("stamps the palette and the resolved scheme on the document element", () => {
    mount({ palette: "zinc-orange", colorScheme: "light", syntaxTheme: "matchPalette" }, false);

    expect(stamped()).toEqual({ palette: "zinc-orange", scheme: "light" });
    expect(latest?.colorScheme).toBe("light");
    expect(latest?.monacoTheme).toBe("cv-zinc-orange-light");
  });

  it("follows a live system scheme flip without a settings change", () => {
    const system = {
      palette: "slate-blue",
      colorScheme: "system",
      syntaxTheme: "matchPalette",
    } as const;
    const render = mount(system, false);
    expect(stamped().scheme).toBe("dark");
    expect(latest?.monacoTheme).toBe("cv-slate-blue-dark");

    render(system, true);

    expect(stamped().scheme).toBe("light");
    expect(latest?.monacoTheme).toBe("cv-slate-blue-light");
  });

  it("replaces a stale boot palette and keeps a classic syntax theme", () => {
    document.documentElement.setAttribute(PALETTE_ATTRIBUTE, "graphite-teal");
    const render = mount(
      { palette: "graphite-teal", colorScheme: "dark", syntaxTheme: "matchPalette" },
      false,
    );

    render({ palette: "carbon-lime", colorScheme: "dark", syntaxTheme: "dracula" }, false);

    expect(stamped().palette).toBe("carbon-lime");
    expect(latest?.monacoTheme).toBe("dracula");
  });
});
```

Create `src/components/settings/pages/AppearancePaletteSwatches.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaletteId } from "../../../domain/appearance";
import { AppearancePaletteSwatches } from "./AppearancePaletteSwatches";

describe("AppearancePaletteSwatches", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(value: PaletteId, onChange: (palette: PaletteId) => void): void {
    act(() => root.render(<AppearancePaletteSwatches onChange={onChange} value={value} />));
  }

  function swatches(): HTMLButtonElement[] {
    return [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  }

  it("offers the six palettes as a labelled radiogroup with one tab stop", () => {
    render("ink-mint", () => undefined);

    expect(host.querySelector('[role="radiogroup"]')?.getAttribute("aria-label")).toBe("Palette");
    expect(swatches().map((swatch) => swatch.getAttribute("aria-label"))).toEqual([
      "Graphite · Teal",
      "Slate · Blue",
      "Black · Violet",
      "Ink · Mint",
      "Zinc · Orange",
      "Carbon · Lime",
    ]);
    expect(swatches().map((swatch) => swatch.getAttribute("aria-checked"))).toEqual([
      "false",
      "false",
      "false",
      "true",
      "false",
      "false",
    ]);
    expect(swatches().filter((swatch) => swatch.tabIndex === 0)).toHaveLength(1);
  });

  it("selects a palette by click", () => {
    const onChange = vi.fn();
    render("graphite-teal", onChange);

    act(() => swatches()[4]?.click());

    expect(onChange).toHaveBeenCalledWith("zinc-orange");
  });

  it("wraps arrow navigation and supports Home and End", () => {
    const onChange = vi.fn();
    render("graphite-teal", onChange);
    const press = (key: string): void => {
      act(() => {
        swatches()[0]?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
      });
    };

    press("ArrowLeft");
    press("End");
    press("ArrowRight");

    expect(onChange.mock.calls.map((call) => call[0])).toEqual([
      "carbon-lime",
      "carbon-lime",
      "slate-blue",
    ]);
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run src/components/useAppWorkbenchThemes.test.tsx src/components/settings/pages/AppearancePaletteSwatches.test.tsx`
Expected: FAIL (`useAppWorkbenchThemes` still takes an `AppTheme`; `./AppearancePaletteSwatches` does not exist).

- [ ] **Step 3: Switch the settings model**

In `src/domain/settings.ts`:

1. Remove `normalizeAgentAppearanceVariant,` and `type AgentAppearanceVariant,` from the `./agentSettings` import.
2. Replace the Task 3 import `import type { ClassicSyntaxThemeId } from "./appearance";` and the `classicMonacoTheme, classicTerminalTheme` value import with:

```ts
import { DEFAULT_APPEARANCE, normalizeAppearance, type AppearanceSettings } from "./appearance";
import type { MonacoAppTheme, TerminalTheme } from "./editorColorThemes";
```

   and keep `export type { MonacoAppTheme, TerminalTheme } from "./editorColorThemes";`.
3. Delete `appThemeOptions` and `export type AppTheme` (lines 57-71).
4. In `interface AppSettings` delete `agentAppearanceVariant: AgentAppearanceVariant;` and replace `theme: AppTheme;` with `appearance: AppearanceSettings;`.
5. In `defaultAppSettings()` replace `theme: "dark",` with `appearance: DEFAULT_APPEARANCE,`.
6. In `normalizeAppSettings` delete `const theme = isAppTheme(value.theme) ? value.theme : defaults.theme;`, delete `agentAppearanceVariant: normalizeAgentAppearanceVariant(value.agentAppearanceVariant),`, and replace `theme,` in the returned object with `appearance: normalizeAppearance(value.appearance, value.theme),`.
7. Delete `ResolvedAppTheme`, `resolveAppTheme`, `monacoThemeForAppTheme`, `terminalThemeForAppTheme`, `classicSyntaxThemeForAppTheme` and `isAppTheme`. If `MonacoAppTheme` / `TerminalTheme` are no longer referenced inside `settings.ts`, delete the `import type { MonacoAppTheme, TerminalTheme }` line and keep only the `export type` re-export.

In `src/domain/agentSettings.ts` delete lines 23-25 (`AGENT_APPEARANCE_VARIANTS`, `AgentAppearanceVariant`, `DEFAULT_AGENT_APPEARANCE_VARIANT`), the `readonly agentAppearanceVariant: AgentAppearanceVariant;` field (line 77), the `agentAppearanceVariant: DEFAULT_AGENT_APPEARANCE_VARIANT,` default (line 97) and `normalizeAgentAppearanceVariant` (lines 157-162).

In `src/domain/startupTheme.ts` delete `STARTUP_THEME_ATTRIBUTE`, `startupThemeIds`, `StartupThemeId`, `StartupSurfaceTheme`, `STARTUP_THEME_IDS`, `FALLBACK_STARTUP_THEME`, `resolveStartupTheme`, `startupThemeFor`, `readPersistedStartupTheme` and `isStartupThemeId`. Keep `STARTUP_APP_SETTINGS_KEY`, `MAX_STARTUP_SETTINGS_LENGTH`, `parseStartupSettings` and the Task 4 API.

- [ ] **Step 4: Apply the appearance at runtime**

Create `src/components/useDocumentAppearance.ts`:

```ts
import { useLayoutEffect } from "react";
import {
  COLOR_SCHEME_ATTRIBUTE,
  PALETTE_ATTRIBUTE,
  type PaletteId,
  type ResolvedColorScheme,
} from "../domain/appearance";

export function useDocumentAppearance(palette: PaletteId, colorScheme: ResolvedColorScheme): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute(PALETTE_ATTRIBUTE, palette);
    root.setAttribute(COLOR_SCHEME_ATTRIBUTE, colorScheme);
  }, [colorScheme, palette]);
}
```

Replace `src/components/useAppWorkbenchThemes.ts` with:

```ts
import { useMemo } from "react";
import type { AppearanceSettings, ResolvedColorScheme } from "../domain/appearance";
import {
  resolveEditorColorThemes,
  type MonacoAppTheme,
  type TerminalTheme,
} from "../domain/editorColorThemes";
import { useDocumentAppearance } from "./useDocumentAppearance";

export interface AppWorkbenchThemes {
  readonly colorScheme: ResolvedColorScheme;
  readonly monacoTheme: MonacoAppTheme;
  readonly terminalTheme: TerminalTheme;
}

export function useAppWorkbenchThemes(
  appearance: AppearanceSettings,
  prefersLightTheme: boolean,
): AppWorkbenchThemes {
  const themes = useMemo(
    () => resolveEditorColorThemes(appearance, prefersLightTheme),
    [appearance, prefersLightTheme],
  );
  useDocumentAppearance(appearance.palette, themes.colorScheme);
  return themes;
}
```

Delete `src/components/useDocumentStartupTheme.ts` and `src/components/useDocumentStartupTheme.test.tsx`.

In `src/App.tsx` replace lines 637-640 with:

```tsx
  const { colorScheme, monacoTheme, terminalTheme } = useAppWorkbenchThemes(
    workbench.appSettings.appearance,
    prefersLightTheme,
  );
```

replace `data-theme={workbench.appSettings.theme}` (line 1040) with `data-theme={colorScheme}`, and delete the line `agentVariant={workbench.appSettings.agentAppearanceVariant}` (line 1065).

In `src/components/WorkbenchShellFrame.tsx` delete the `../domain/agentSettings` import (lines 2-5), the `readonly agentVariant?: AgentAppearanceVariant;` prop, the `agentVariant = DEFAULT_AGENT_APPEARANCE_VARIANT,` default and the `data-agent-variant={agentVariant}` attribute.

In `src/components/remoteRunner/RemoteTerminalPanel.tsx` replace line 12 with `import { classicTerminalTheme, type TerminalTheme } from "../../domain/editorColorThemes";` and line 16 with `const DEFAULT_THEME = classicTerminalTheme("classicDark");`.

- [ ] **Step 5: Rebuild the Appearance rows**

Create `src/components/settings/pages/AppearancePaletteSwatches.tsx`:

```tsx
import { useRef, type KeyboardEvent } from "react";
import { PALETTE_IDS, PALETTE_LABELS, type PaletteId } from "../../../domain/appearance";
import { paletteTokens } from "../../../domain/appearancePalettes";

const STEP_BY_KEY: Readonly<Record<string, number>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

export interface AppearancePaletteSwatchesProps {
  readonly value: PaletteId;
  onChange(palette: PaletteId): void;
}

export function AppearancePaletteSwatches({ onChange, value }: AppearancePaletteSwatchesProps) {
  const groupRef = useRef<HTMLDivElement | null>(null);

  const move = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next = nextPalette(event.key, value);

    if (next === null) return;

    event.preventDefault();
    onChange(next);
    groupRef.current?.querySelector<HTMLButtonElement>(`[data-value="${next}"]`)?.focus();
  };

  return (
    <div
      aria-label="Palette"
      className="settings-swatches"
      onKeyDown={move}
      ref={groupRef}
      role="radiogroup"
    >
      {PALETTE_IDS.map((palette) => {
        const tokens = paletteTokens(palette, "dark");

        return (
          <button
            aria-checked={palette === value}
            aria-label={PALETTE_LABELS[palette]}
            className="settings-swatch"
            data-value={palette}
            key={palette}
            onClick={() => onChange(palette)}
            role="radio"
            style={{ background: tokens.s0 }}
            tabIndex={palette === value ? 0 : -1}
            title={PALETTE_LABELS[palette]}
            type="button"
          >
            <span
              aria-hidden="true"
              className="settings-swatch__sidebar"
              style={{ background: tokens.s1 }}
            />
            <span
              aria-hidden="true"
              className="settings-swatch__accent"
              style={{ background: tokens.accentFill }}
            />
          </button>
        );
      })}
    </div>
  );
}

function nextPalette(key: string, value: PaletteId): PaletteId | null {
  if (key === "Home") return PALETTE_IDS[0];
  if (key === "End") return PALETTE_IDS[PALETTE_IDS.length - 1];

  const step = STEP_BY_KEY[key];

  if (step === undefined) return null;

  const current = PALETTE_IDS.indexOf(value);
  return PALETTE_IDS[(Math.max(current, 0) + step + PALETTE_IDS.length) % PALETTE_IDS.length];
}
```

Delete `src/components/settings/pages/ThemeSwatches.tsx` and `src/components/settings/pages/ThemeSwatches.test.tsx`.

In `src/components/settings/pages/AppearanceSettingsPage.tsx` replace everything from the first line through the end of the `appearance.agentThreadFontSize` `SettingsRow` (current lines 1-91) with:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  COLOR_SCHEME_LABELS,
  COLOR_SCHEME_PREFERENCES,
  SYNTAX_THEME_IDS,
  SYNTAX_THEME_LABELS,
  isColorSchemePreference,
  isSyntaxThemeId,
  type AppearanceSettings,
} from "../../../domain/appearance";
import {
  MAX_AGENT_THREAD_FONT_SIZE,
  MIN_AGENT_THREAD_FONT_SIZE,
  normalizeAgentThreadFontSize,
} from "../../../domain/agentSettings";
import {
  maxEditorFontSize,
  minEditorFontSize,
  normalizeEditorFontFamily,
  normalizeEditorFontSize,
} from "../../../domain/settings";
import type { SystemFontGateway } from "../../../domain/systemFonts";
import { SettingsButton } from "../primitives/SettingsButton";
import { SettingsNumberField } from "../primitives/SettingsNumberField";
import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsSectionHeading } from "../primitives/SettingsSectionHeading";
import { SettingsSegmented } from "../primitives/SettingsSegmented";
import { SettingsSelect } from "../primitives/SettingsSelect";
import { SettingsSwitch } from "../primitives/SettingsSwitch";
import { uniqueSortedStrings } from "../../settingsDialogValues";
import type { SettingsPageProps } from "../settingsPageProps";
import { AppearancePaletteSwatches } from "./AppearancePaletteSwatches";

const COLOR_SCHEME_OPTIONS = COLOR_SCHEME_PREFERENCES.map((value) => ({
  value,
  label: COLOR_SCHEME_LABELS[value],
}));

const SYNTAX_THEME_OPTIONS = SYNTAX_THEME_IDS.map((value) => ({
  value,
  label: SYNTAX_THEME_LABELS[value],
}));

export function AppearanceSettingsPage({ actions, draft, env }: SettingsPageProps) {
  const appSettings = draft.appSettings;
  const fonts = useMonospaceFontFamilies(env.systemFontGateway, appSettings.editorFontFamily);
  const updateAppearance = (patch: Partial<AppearanceSettings>): void =>
    actions.updateAppSettings({
      ...appSettings,
      appearance: { ...appSettings.appearance, ...patch },
    });

  return (
    <>
      <SettingsSectionHeading title="Appearance">
        <SettingsRow layout="stacked" rowId="appearance.palette">
          <AppearancePaletteSwatches
            onChange={(palette) => updateAppearance({ palette })}
            value={appSettings.appearance.palette}
          />
        </SettingsRow>

        <SettingsRow rowId="appearance.colorScheme">
          <SettingsSegmented
            onChange={(value) => {
              if (!isColorSchemePreference(value)) return;

              updateAppearance({ colorScheme: value });
            }}
            options={COLOR_SCHEME_OPTIONS}
            value={appSettings.appearance.colorScheme}
          />
        </SettingsRow>

        <SettingsRow rowId="appearance.syntaxTheme">
          <SettingsSelect
            onChange={(value) => {
              if (!isSyntaxThemeId(value)) return;

              updateAppearance({ syntaxTheme: value });
            }}
            options={SYNTAX_THEME_OPTIONS}
            value={appSettings.appearance.syntaxTheme}
            width="md"
          />
        </SettingsRow>

        <SettingsRow rowId="appearance.agentThreadFontSize">
          <SettingsNumberField
            max={MAX_AGENT_THREAD_FONT_SIZE}
            min={MIN_AGENT_THREAD_FONT_SIZE}
            onChange={(value) =>
              actions.updateAppSettings({
                ...appSettings,
                agentThreadFontSize: normalizeAgentThreadFontSize(value),
              })
            }
            unit="px"
            value={appSettings.agentThreadFontSize}
          />
        </SettingsRow>
```

Keep the rest of the file (the closing `</SettingsSectionHeading>`, the "Editor font" section and `useMonospaceFontFamilies`) and delete the two helpers at the end, `isAppTheme` and `isAgentAppearanceVariant`.

In `src/components/settings/settingsRegistryRows.ts` replace the `appearance.theme` and `appearance.agentAppearance` rows (lines 132-145) with:

```ts
  row(
    "appearance.palette",
    "appearance",
    "Palette",
    "Colour palette for the whole window. Every palette has a dark and a light variant.",
    ["palette", "theme", "colour", "color", "graphite", "slate", "violet", "mint", "orange", "lime"],
  ),
  row(
    "appearance.colorScheme",
    "appearance",
    "Appearance",
    "Follow the system, or always use the dark or the light variant of the palette.",
    ["appearance", "dark", "light", "system", "mode", "theme"],
  ),
  row(
    "appearance.syntaxTheme",
    "appearance",
    "Syntax theme",
    "Match palette follows the palette above. Classic themes keep their own colours.",
    ["syntax", "editor", "theme", "highlighting", "dracula", "one dark", "catppuccin", "ayu"],
  ),
```

In `src/components/settings/settings.css` delete the `.settings-theme { ... }` rule (lines 501-506).

- [ ] **Step 6: Update the existing tests to the new model**

Apply exactly these edits. Add every new import next to the existing imports of a file, never above a `// @vitest-environment jsdom` first line (vitest only honours that pragma at the top). (The substitution rule for any other `AppSettings` literal `tsc` reports: `theme: "light"` becomes `appearance: { ...DEFAULT_APPEARANCE, colorScheme: "light" }`, `theme: "dark"` becomes `appearance: DEFAULT_APPEARANCE`, reads of `.theme` become `.appearance.colorScheme`, and `agentAppearanceVariant` lines are deleted):

`src/domain/settings.test.ts`
- Remove `appThemeOptions`, `monacoThemeForAppTheme`, `resolveAppTheme`, `terminalThemeForAppTheme` from the `./settings` import; add `import { DEFAULT_APPEARANCE } from "./appearance";`.
- Delete the six `agentAppearanceVariant: "current",` lines (47, 304, 342, 375, 438, 497).
- Replace `theme: "dark",` at lines 63, 320, 454, 513 with `appearance: DEFAULT_APPEARANCE,`.
- Keep the legacy inputs `theme: "light",` (line 334) and `theme: "ayuMirage",` (line 369); replace the expected `theme: "light",` (line 361) with `appearance: { palette: "graphite-teal", colorScheme: "light", syntaxTheme: "matchPalette" },` and the expected `theme: "ayuMirage",` (line 391) with `appearance: { palette: "graphite-teal", colorScheme: "dark", syntaxTheme: "ayuMirage" },`.
- Delete the four describe blocks `monacoThemeForAppTheme`, `appThemeOptions`, `resolveAppTheme`, `terminalThemeForAppTheme` (from line 1579 to the end of the `terminalThemeForAppTheme` block); Task 3's `editorColorThemes.test.ts` covers them.
- Add inside the describe block that contains the legacy `theme: "ayuMirage"` case:

```ts
  it("normalizes a persisted appearance and drops the retired fields", () => {
    const settings = normalizeAppSettings({
      agentAppearanceVariant: "paper",
      appearance: { palette: "black-violet", colorScheme: "system", syntaxTheme: "oneLight" },
      theme: "dracula",
    });

    expect(settings.appearance).toEqual({
      palette: "black-violet",
      colorScheme: "system",
      syntaxTheme: "oneLight",
    });
    expect(settings).not.toHaveProperty("agentAppearanceVariant");
    expect(settings).not.toHaveProperty("theme");
  });
```

`src/domain/agentSettings.test.ts`: remove `normalizeAgentAppearanceVariant,` from the import, delete `agentAppearanceVariant: "current",` (line 36) and delete the `it("normalizes the closed appearance variants", ...)` block (lines 253-258).

`src/domain/startupTheme.test.ts`: delete the `describe("startup theme ids", ...)` and `describe("resolveStartupTheme", ...)` blocks, the now-unused `persisted` helper function, the `appThemeOptions` import and every import from `./startupTheme` that is no longer used (keep `MAX_STARTUP_SETTINGS_LENGTH`, `readPersistedAppearance`, `resolveStartupAppearance`).

`src/domain/themeContrast.test.ts`: replace `import { terminalThemeForAppTheme, type TerminalTheme } from "./settings";` with

```ts
import { CLASSIC_SYNTAX_THEME_IDS } from "./appearance";
import { classicTerminalTheme, type TerminalTheme } from "./editorColorThemes";
```

and replace the body of `it("keeps terminal text colors readable in app themes", ...)` with the loop below (Dark Plus stays excluded exactly as today: its bundled VS Code ANSI colours are below AA on `#1e1e1e` and the current test never checked it):

```ts
    for (const theme of CLASSIC_SYNTAX_THEME_IDS.filter((id) => id !== "darkPlus")) {
      expectTerminalThemeContrast(classicTerminalTheme(theme));
    }
```

`src/infrastructure/browserSettingsGateway.test.ts`: add `import { DEFAULT_APPEARANCE } from "../domain/appearance";`; delete `agentAppearanceVariant: "current",` (lines 515, 620, 736, 873); replace `theme: "dark",` (lines 531, 889) with `appearance: DEFAULT_APPEARANCE,`; replace `theme: "ayuMirage",` (lines 640 and 755) with `appearance: { palette: "ink-mint", colorScheme: "light", syntaxTheme: "ayuMirage" },`.

`src/components/settings/settingsDraftPersistence.test.ts`: add `import { DEFAULT_APPEARANCE } from "../../domain/appearance";`; line 11 becomes `harness.actions.updateAppSettings({ ...defaultAppSettings(), appearance: { ...DEFAULT_APPEARANCE, colorScheme: "light" } });`; line 15 maps `settings.appearance.colorScheme`; line 17 reads `harness.saved[0]?.appSettings.appearance.colorScheme`.

`src/application/useAgentProviderManagement.test.tsx`: add `import { DEFAULT_APPEARANCE } from "../domain/appearance";` and `const LIGHT_APPEARANCE = { ...DEFAULT_APPEARANCE, colorScheme: "light" } as const;` below the imports; line 983 reads `.appearance.colorScheme`; lines 1001 and 1207 use `appearance: LIGHT_APPEARANCE`; lines 1012, 1021, 1213 assert `.appearance.colorScheme).toBe("light")`; line 1025 asserts `.appearance.colorScheme).not.toBe(initialTheme)`.

`src/application/workbenchController/useWorkbenchSettingsPersistence.test.tsx`: add `import { DEFAULT_APPEARANCE } from "../../domain/appearance";`; line 64 uses `appearance: { ...DEFAULT_APPEARANCE, colorScheme: "light" }`; lines 81 and 91 become `appearance: { colorScheme: "light" },`.

`src/application/useWorkbenchWorkspaceTabCloseCoordinator.test.tsx`: line 264 becomes `agentThreadFontSize: 18,`; line 270 becomes `expect(harness.appSettingsRef.current.agentThreadFontSize).toBe(18);`.

`src/components/settings/settingsRegistry.test.ts`: line 71 uses `"appearance.palette"`.

`src/App.commandRouting.test.tsx` (line 1298), `src/App.gitDiffBoundary.test.tsx` (line 183), `src/App.gitDiffClick.test.tsx` (line 352): these loosely typed workbench fixtures set `theme: "calm-dark",` inside `appSettings`; replace that line with `appearance: DEFAULT_APPEARANCE,` and add `import { DEFAULT_APPEARANCE } from "./domain/appearance";` below the `// @vitest-environment jsdom` line (without it `useAppWorkbenchThemes` reads `appearance.colorScheme` of `undefined` and 26 App tests crash; `tsc` does not catch it because the fixtures are cast).

`src/components/settings/settingsSearch.test.ts`: the local fixture row id `"appearance.theme"` (line 22) and its expectation (line 48) become `"appearance.palette"` (row ids are type-checked against the registry).

Terminal fixtures that used the removed `terminalThemeForAppTheme`: in `src/application/useDockedTextSearch.test.ts`, `src/components/TerminalPanel.test.tsx`, `src/components/TerminalTabsPanel.test.tsx`, `src/components/BottomPanel.test.tsx` (import `"../domain/editorColorThemes"`) and `src/components/agentMode/AgentWorkbenchScreen.test.tsx` (import `"../../domain/editorColorThemes"`) remove `terminalThemeForAppTheme` from the `domain/settings` import (keep `type TerminalTheme` where it is imported), add `import { classicTerminalTheme } from "<relative>/domain/editorColorThemes";`, and replace every `terminalThemeForAppTheme("dark")` with `classicTerminalTheme("classicDark")` and every `terminalThemeForAppTheme("light")` with `classicTerminalTheme("classicLight")`.

`src/components/WorkbenchShellFrame.test.tsx`: replace the `it("stamps a closed agent appearance variant and defaults to current", ...)` block with:

```tsx
  it("does not stamp an agent appearance variant", () => {
    render(placement("agent", "files"));

    expect(host.querySelector(".workbench-frame")?.hasAttribute("data-agent-variant")).toBe(false);
  });
```

`src/components/settings/pages/AppearanceSettingsPage.test.tsx`: add `import { DEFAULT_APPEARANCE } from "../../../domain/appearance";`; in the first test replace `queryIn<HTMLSelectElement>("appearance.theme", "select")` with `queryIn<HTMLSelectElement>("appearance.syntaxTheme", "select")`; replace the tests "persists theme changes while preserving workspace settings and trust", "selects a theme from the swatches", "moves the theme swatch selection with the arrow, Home and End keys" and "persists the agent appearance variant from the segmented control" with:

```tsx
  it("persists syntax theme changes while preserving workspace settings and trust", async () => {
    const workspaceSettings: WorkspaceSettings = {
      ...defaultWorkspaceSettings(),
      defaultTabSize: 2,
      revealActiveFileInTree: false,
      statusBar: { ...defaultWorkspaceSettings().statusBar, message: false },
    };
    const onSave = await render({ trusted: false, workspaceSettings });
    const syntax = () => queryIn<HTMLSelectElement>("appearance.syntaxTheme", "select");

    expect(syntax().value).toBe("matchPalette");

    act(() => {
      syntax().value = "oneDarkPro";
      syntax().dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: {
        ...defaultAppSettings(),
        appearance: { ...DEFAULT_APPEARANCE, syntaxTheme: "oneDarkPro" },
      },
      trusted: false,
      workspaceSettings,
    });
  });

  it("selects a palette from the swatches", async () => {
    const onSave = await render({});
    const swatch = [
      ...rowElement("appearance.palette").querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    ].find((candidate) => candidate.getAttribute("aria-label") === "Ink · Mint");

    expect(swatch).toBeDefined();
    act(() => (swatch as HTMLButtonElement).click());

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: {
        ...defaultAppSettings(),
        appearance: { ...DEFAULT_APPEARANCE, palette: "ink-mint" },
      },
      trusted: true,
      workspaceSettings: defaultWorkspaceSettings(),
    });
  });

  it("moves the palette selection with the arrow, Home and End keys", async () => {
    const onSave = await render({});
    const swatches = () => [
      ...rowElement("appearance.palette").querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    ];
    const press = (key: string): void => {
      act(() => {
        swatches()[0]?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
      });
    };
    const savedPalette = (): string => {
      const calls = onSave.mock.calls;
      const last = calls[calls.length - 1]?.[0] as {
        appSettings: { appearance: { palette: string } };
      };

      return last.appSettings.appearance.palette;
    };

    press("ArrowRight");
    expect(savedPalette()).toBe("slate-blue");

    press("End");
    expect(savedPalette()).toBe("carbon-lime");

    press("ArrowRight");
    expect(savedPalette()).toBe("graphite-teal");

    press("ArrowLeft");
    expect(savedPalette()).toBe("carbon-lime");

    press("Home");
    expect(savedPalette()).toBe("graphite-teal");
  });

  it("persists the colour scheme from the segmented control", async () => {
    const onSave = await render({});
    const option = (label: string): HTMLButtonElement => {
      const match = [
        ...rowElement("appearance.colorScheme").querySelectorAll<HTMLButtonElement>(
          '[role="radio"]',
        ),
      ].find((candidate) => candidate.textContent === label);

      expect(match).toBeDefined();
      return match as HTMLButtonElement;
    };

    expect(option("Dark").getAttribute("aria-checked")).toBe("true");

    act(() => option("System").click());

    expect(onSave).toHaveBeenLastCalledWith({
      appSettings: {
        ...defaultAppSettings(),
        appearance: { ...DEFAULT_APPEARANCE, colorScheme: "system" },
      },
      trusted: true,
      workspaceSettings: defaultWorkspaceSettings(),
    });
  });
```

- [ ] **Step 7: Run type-check and the affected tests**

Run: `npx tsc --noEmit`
Expected: exit 0. If it reports another object literal with `theme` or `agentAppearanceVariant` on `AppSettings`, apply the substitution rule from Step 6 to that line only and rerun.

Run: `npx vitest run src/domain src/components/useAppWorkbenchThemes.test.tsx src/components/settings src/components/WorkbenchShellFrame.test.tsx src/infrastructure/browserSettingsGateway.test.ts src/application/useAgentProviderManagement.test.tsx src/application/workbenchController/useWorkbenchSettingsPersistence.test.tsx src/application/useWorkbenchWorkspaceTabCloseCoordinator.test.tsx src/application/useDockedTextSearch.test.ts src/components/TerminalPanel.test.tsx src/components/TerminalTabsPanel.test.tsx src/components/BottomPanel.test.tsx src/components/agentMode/AgentWorkbenchScreen.test.tsx src/startupTheme.test.ts src/App.test.ts src/App.commandRouting.test.tsx src/App.gitDiffBoundary.test.tsx src/App.gitDiffClick.test.tsx`
Expected: PASS. Then run `grep -rn 'theme: "calm-dark"\|agentAppearanceVariant\|appSettings.theme' src --include='*.ts' --include='*.tsx'` and confirm the only remaining hits are Monaco theme arguments such as `{ theme: "calm-dark" }` passed to `setupShikiTokenization` in `GitDiffPreview.test.tsx` and `ExternalFileCompareDialog.test.tsx` (those are Monaco theme ids, not app settings) plus the two `agentAppearanceVariant` lines of the new "drops the retired fields" test in `src/domain/settings.test.ts`.

- [ ] **Step 8: Check the hotspot budget, format and lint**

Run: `npm run size:hotspots`
Expected: exit 0, or the message "Tracked hotspot size decreased; lock it in with: npm run size:hotspots:update" listing only `src/App.tsx`; in that case run `npm run size:hotspots:update` (this records a reduction, never an increase) and rerun `npm run size:hotspots` (exit 0).

Run: `npx prettier --write src/components/useDocumentAppearance.ts src/components/useAppWorkbenchThemes.test.tsx src/components/settings/pages/AppearancePaletteSwatches.tsx src/components/settings/pages/AppearancePaletteSwatches.test.tsx && npm run format:check:changed && npm run lint -- --max-warnings 0 && npm run lint:exhaustive-deps`
Expected: exit 0 (prettier-write a modified file only when `format:check:changed` lists it).

- [ ] **Step 9: Hand off (no commit)**

---

### Task 6: Load the tokens, legacy bridge, retire the agent variants stylesheet

**Files:**
- Create: `src/ui/tokens/legacyBridge.css`
- Modify: `src/ui/tokens/tokens.css`, `src/App.css` (lines 1-2)
- Delete: `src/components/agentMode/agentModeVariants.css`
- Modify: `src/components/agentMode/agentMode.css` (line 684, `.agent-find__hit`)
- Modify: `src/components/agentMode/agentModeCssTestSupport.ts` (line 5), `src/components/cssTokenContract.test.ts` (lines 23 and 500), `src/components/agentMode/agentModeResponsiveStyles.test.ts` (line 279)
- Test: `src/ui/tokens/legacyBridge.test.ts`

**Interfaces:**
- Consumes: Task 2 tokens; Task 5 (`.app-shell[data-theme]` is the resolved scheme; `data-cv-*` attributes are stamped).
- Produces: every legacy `--color-*` and `--change-*` variable resolves to a `--cv-*` token on `<html>` and on `.app-shell`; `--cv-legacy-on-accent` (dark: `var(--cv-s0)`, light: `#ffffff`). Removed in P10 together with the dead legacy theme blocks in `App.css`.

- [ ] **Step 1: Write the failing test**

Create `src/ui/tokens/legacyBridge.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildTokenTable,
  isSingleVar,
  lastOf,
  parseAllStyleSheets,
  readStyleSheet,
  selectorParts,
  varReferences,
} from "../../components/cssContractTestSupport";

const parsed = parseAllStyleSheets();
const BRIDGE_SHEET = "ui/tokens/legacyBridge.css";
const BRIDGE_SELECTORS = [":root[data-cv-scheme]", ":root[data-cv-scheme] .app-shell"];
const UNBRIDGED_LEGACY = new Set(["--color-accent-soft", "--color-accent-bar", "--color-white"]);
const EXPECTED_BRIDGE: Readonly<Record<string, string>> = {
  "--color-accent": "var(--cv-accent)",
  "--color-accent-text": "var(--cv-legacy-on-accent)",
  "--color-active": "var(--cv-s3)",
  "--color-active-muted": "var(--cv-s2)",
  "--color-active-text": "var(--cv-fg-strong)",
  "--color-app": "var(--cv-canvas)",
  "--color-border": "var(--cv-hair)",
  "--color-border-strong": "var(--cv-hair-strong)",
  "--color-control": "var(--cv-raised)",
  "--color-disabled": "var(--cv-fg-disabled)",
  "--color-error": "var(--cv-danger)",
  "--color-hover": "var(--cv-row-hover)",
  "--color-hover-strong": "var(--cv-row-active)",
  "--color-modal": "var(--cv-popover)",
  "--color-panel": "var(--cv-side)",
  "--color-panel-deep": "var(--cv-side)",
  "--color-sidebar": "var(--cv-side)",
  "--color-status": "var(--cv-side)",
  "--color-success": "var(--cv-ok)",
  "--color-surface": "var(--cv-raised)",
  "--color-tab": "var(--cv-canvas)",
  "--color-tab-active": "var(--cv-raised)",
  "--color-tabs": "var(--cv-canvas)",
  "--color-text": "var(--cv-fg)",
  "--color-text-muted": "var(--cv-fg-muted)",
  "--color-text-strong": "var(--cv-fg-strong)",
  "--color-text-subtle": "var(--cv-fg-subtle)",
  "--color-warning": "var(--cv-warn)",
  "--change-added": "var(--cv-ok)",
  "--change-added-soft": "var(--cv-add-bg)",
  "--change-added-strong": "var(--cv-ok)",
  "--change-deleted": "var(--cv-danger)",
  "--change-deleted-soft": "var(--cv-del-bg)",
  "--change-deleted-strong": "var(--cv-danger)",
  "--change-modified": "var(--cv-warn)",
  "--change-modified-soft": "var(--cv-warn-soft)",
  "--change-modified-strong": "var(--cv-warn)",
};

const bridgeRules = parsed.rules.filter(
  (rule) =>
    rule.sheet === BRIDGE_SHEET &&
    rule.context.length === 0 &&
    selectorParts(rule.selector).join(" | ") === BRIDGE_SELECTORS.join(" | "),
);
const bridge = buildTokenTable(bridgeRules);
const declaredTokens = new Set(
  parsed.rules
    .filter((rule) => rule.sheet.startsWith("ui/tokens/"))
    .flatMap((rule) => rule.declarations.map((declaration) => declaration.property))
    .filter((property) => property.startsWith("--cv-")),
);

function classLevelSpecificity(selector: string): number {
  return (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
}

function schemeValue(scheme: "dark" | "light"): string | undefined {
  const rules = parsed.rules.filter(
    (rule) =>
      rule.sheet === BRIDGE_SHEET && rule.selector === `:root[data-cv-scheme="${scheme}"]`,
  );
  return lastOf(buildTokenTable(rules).get("--cv-legacy-on-accent"));
}

describe("legacy token bridge", () => {
  it("declares one bridge rule on the document root and the app shell", () => {
    expect(bridgeRules).toHaveLength(1);
  });

  it("maps every legacy colour token to its palette token", () => {
    expect(
      Object.fromEntries([...bridge.entries()].map(([name, values]) => [name, lastOf(values)])),
    ).toEqual(EXPECTED_BRIDGE);
  });

  it("bridges every colour and change token the legacy root declares", () => {
    const legacy = parsed.rules
      .filter((rule) => rule.sheet === "App.css" && rule.context.length === 0)
      .filter((rule) => rule.selector === ":root")
      .flatMap((rule) => rule.declarations.map((declaration) => declaration.property))
      .filter((property) => property.startsWith("--color-") || property.startsWith("--change-"))
      .filter((property) => !UNBRIDGED_LEGACY.has(property));

    expect([...new Set(legacy)].filter((name) => !bridge.has(name)).sort()).toEqual([]);
  });

  it("points only at declared palette tokens", () => {
    for (const [name, values] of bridge) {
      const value = lastOf(values) ?? "";
      expect(isSingleVar(value), name).toBe(true);
      for (const reference of varReferences(value)) {
        expect(declaredTokens.has(reference), `${name} -> ${reference}`).toBe(true);
      }
    }
  });

  it("outranks every legacy theme block that targets the app shell", () => {
    const legacyThemeSelectors = new Set(
      parsed.rules
        .filter((rule) => rule.sheet === "App.css")
        .flatMap((rule) => selectorParts(rule.selector))
        .filter((part) => part.startsWith(".app-shell[data-theme=") && !part.includes(" ")),
    );
    const bridgeOnShell = classLevelSpecificity(":root[data-cv-scheme] .app-shell");

    expect(legacyThemeSelectors.size).toBeGreaterThan(0);
    for (const selector of legacyThemeSelectors) {
      expect(bridgeOnShell, selector).toBeGreaterThan(classLevelSpecificity(selector));
    }
  });

  it("keeps the legacy on-accent pairing the contrast gate checks", () => {
    expect(schemeValue("dark")).toBe("var(--cv-s0)");
    expect(schemeValue("light")).toBe("#ffffff");
  });

  it("loads the tokens before every legacy sheet and drops the agent variants", () => {
    const appCss = readStyleSheet("App.css").source;
    const tokens = readStyleSheet("ui/tokens/tokens.css").source;

    expect(appCss.split("\n")[0]).toBe('@import "./ui/tokens/tokens.css";');
    expect(appCss).not.toContain("agentModeVariants.css");
    expect(tokens).toContain('@import "./legacyBridge.css";');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/tokens/legacyBridge.test.ts`
Expected: FAIL (`bridgeRules` has length 0; `App.css` first line is the agent tokens import).

- [ ] **Step 3: Write the bridge and load the tokens**

Create `src/ui/tokens/legacyBridge.css`:

```css
:root[data-cv-scheme="dark"] {
  --cv-legacy-on-accent: var(--cv-s0);
}

:root[data-cv-scheme="light"] {
  --cv-legacy-on-accent: #ffffff;
}

:root[data-cv-scheme],
:root[data-cv-scheme] .app-shell {
  --color-accent: var(--cv-accent);
  --color-accent-text: var(--cv-legacy-on-accent);
  --color-active: var(--cv-s3);
  --color-active-muted: var(--cv-s2);
  --color-active-text: var(--cv-fg-strong);
  --color-app: var(--cv-canvas);
  --color-border: var(--cv-hair);
  --color-border-strong: var(--cv-hair-strong);
  --color-control: var(--cv-raised);
  --color-disabled: var(--cv-fg-disabled);
  --color-error: var(--cv-danger);
  --color-hover: var(--cv-row-hover);
  --color-hover-strong: var(--cv-row-active);
  --color-modal: var(--cv-popover);
  --color-panel: var(--cv-side);
  --color-panel-deep: var(--cv-side);
  --color-sidebar: var(--cv-side);
  --color-status: var(--cv-side);
  --color-success: var(--cv-ok);
  --color-surface: var(--cv-raised);
  --color-tab: var(--cv-canvas);
  --color-tab-active: var(--cv-raised);
  --color-tabs: var(--cv-canvas);
  --color-text: var(--cv-fg);
  --color-text-muted: var(--cv-fg-muted);
  --color-text-strong: var(--cv-fg-strong);
  --color-text-subtle: var(--cv-fg-subtle);
  --color-warning: var(--cv-warn);
  --change-added: var(--cv-ok);
  --change-added-soft: var(--cv-add-bg);
  --change-added-strong: var(--cv-ok);
  --change-deleted: var(--cv-danger);
  --change-deleted-soft: var(--cv-del-bg);
  --change-deleted-strong: var(--cv-danger);
  --change-modified: var(--cv-warn);
  --change-modified-soft: var(--cv-warn-soft);
  --change-modified-strong: var(--cv-warn);
}
```

Append to `src/ui/tokens/tokens.css`:

```css
@import "./legacyBridge.css";
```

In `src/App.css` replace the first two lines

```css
@import "./components/agentMode/agentModeTokens.css";
@import "./components/agentMode/agentModeVariants.css";
```

with

```css
@import "./ui/tokens/tokens.css";
@import "./components/agentMode/agentModeTokens.css";
```

Delete `src/components/agentMode/agentModeVariants.css`.

In `src/components/agentMode/agentMode.css` (line 684, rule `.agent-find__hit`) replace `background: color-mix(in srgb, var(--agent-warm) 32%, transparent);` with `background: var(--cv-match);`. `--agent-warm` was declared only by the retired "paper" variant, so the find highlight was already invalid (transparent) in every other variant; after the deletion the undeclared reference also fails `agentModeTokens.test.ts` and the `themeContrast.test.ts` token scan.

- [ ] **Step 4: Update the tests that referenced the variants sheet**

- `src/components/agentMode/agentModeCssTestSupport.ts`: delete the `"agentModeVariants.css",` entry (line 5).
- `src/components/cssTokenContract.test.ts`: delete `const VARIANTS_SHEET = "components/agentMode/agentModeVariants.css";` (line 23) and the line `.filter((entry) => entry.rule.sheet !== VARIANTS_SHEET)` (line 500).
- `src/components/agentMode/agentModeResponsiveStyles.test.ts` line 279: replace `expect(rule('.workbench-frame[data-agent-variant="studio"]')).toContain("0 0 0 4px");` with `expect(rule(".app-shell {")).toContain("0 0 0 4px var(--codevo-primary)");` (the base `--codevo-focus-ring` in `agentModeTokens.css`, the first sheet in the concatenation, is now the widest ring and still fits the 4px gutter).

- [ ] **Step 5: Run the CSS contract suite**

Run: `npx vitest run src/ui/tokens src/components/cssTokenContract.test.ts src/components/cssBorderContract.test.ts src/components/agentMode src/domain/themeContrast.test.ts src/startupDocument.test.ts src/components/monacoWidgetStyles.test.ts src/components/windowChromeStyles.test.ts src/components/workbenchShellFrame.expanded.test.ts`
Expected: PASS.

- [ ] **Step 6: Smoke the running app (lead only, optional before Task 16)**

Run `npm run check` (exit 0). Visual verification happens in Task 16; do not start `npm run debug` (it kills the TypeScript servers of the user's running app).

- [ ] **Step 7: Hand off (no commit)**

---

### Task 7: Foundation infrastructure (helpers, hooks, spinner, style contract)

**Files:**
- Create: `src/ui/foundation/classNames.ts`, `src/ui/foundation/roving.ts`, `src/ui/foundation/popoverPosition.ts`, `src/ui/foundation/focus.ts`, `src/ui/foundation/useLatest.ts`, `src/ui/foundation/useRestoreFocus.ts`, `src/ui/foundation/useDismiss.ts`, `src/ui/foundation/usePopoverPosition.ts`, `src/ui/foundation/Spinner.tsx`, `src/ui/foundation/status.css`, `src/ui/foundation/foundationTestSupport.ts`
- Test: `src/ui/foundation/roving.test.ts`, `src/ui/foundation/popoverPosition.test.ts`, `src/ui/foundation/focus.test.ts`, `src/ui/foundation/foundationHooks.test.tsx`, `src/ui/foundation/foundationStyles.test.ts`

**Interfaces:**
- Consumes: Task 2 tokens (`--cv-*` in `src/ui/tokens/*.css`) and `cssContractTestSupport`.
- Produces:
  - `cx(...parts: ReadonlyArray<string | false | null | undefined>): string`
  - `type RovingOrientation = "vertical" | "horizontal" | "both"`, `rovingIndex(key: string, current: number, count: number, orientation: RovingOrientation): number | null`
  - `type PopoverPlacement = "bottom-start" | "bottom-end" | "top-start" | "top-end" | "right-start" | "left-start"`, `interface Rect { top; left; width; height }`, `interface Size { width; height }`, `interface PopoverPosition { top; left; placement }`, `computePopoverPosition(anchor: Rect, popover: Size, viewport: Size, placement: PopoverPlacement): PopoverPosition`
  - `focusableWithin(root: HTMLElement): HTMLElement[]`, `interface TabKeyEvent { key; shiftKey; preventDefault() }`, `trapTabKey(event: TabKeyEvent, root: HTMLElement): void`
  - `useLatest<T>(value: T): RefObject<T>`
  - `useRestoreFocus(): void` (captures `document.activeElement` during the first render, restores it on unmount when still connected)
  - `useDismiss(active: boolean, containerRef: RefObject<HTMLElement | null>, anchorRef: RefObject<HTMLElement | null>, onDismiss: () => void): void` (outside `pointerdown`, `Escape`)
  - `usePopoverPosition(anchorRef, surfaceRef, placement): PopoverPosition`
  - `Spinner({ label?: string })` with class `cv-spinner`
  - Test support: `mountUi(): MountedUi { host; render(node); unmount() }`, `press(target, key, init?)`, `click(target)`, `pointer(target, type, init?)`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/foundation/foundationTestSupport.ts`:

```ts
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

export interface MountedUi {
  readonly host: HTMLElement;
  render(node: ReactNode): void;
  unmount(): void;
}

export function mountUi(): MountedUi {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  return {
    host,
    render(node) {
      act(() => root.render(node));
    },
    unmount() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

export function press(target: Element, key: string, init: KeyboardEventInit = {}): void {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, ...init }),
    );
  });
}

export function click(target: Element): void {
  act(() => {
    (target as HTMLElement).click();
  });
}

export function pointer(target: Element, type: string, init: PointerEventInit = {}): void {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, ...init }),
    );
  });
}
```

Create `src/ui/foundation/roving.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { rovingIndex } from "./roving";

describe("rovingIndex", () => {
  it("moves and wraps along the vertical axis", () => {
    expect(rovingIndex("ArrowDown", 0, 3, "vertical")).toBe(1);
    expect(rovingIndex("ArrowDown", 2, 3, "vertical")).toBe(0);
    expect(rovingIndex("ArrowUp", 0, 3, "vertical")).toBe(2);
    expect(rovingIndex("ArrowRight", 0, 3, "vertical")).toBeNull();
  });

  it("moves and wraps along the horizontal axis", () => {
    expect(rovingIndex("ArrowRight", 1, 3, "horizontal")).toBe(2);
    expect(rovingIndex("ArrowLeft", 0, 3, "horizontal")).toBe(2);
    expect(rovingIndex("ArrowDown", 0, 3, "horizontal")).toBeNull();
  });

  it("accepts both axes for radio groups", () => {
    expect(rovingIndex("ArrowDown", 0, 3, "both")).toBe(1);
    expect(rovingIndex("ArrowLeft", 0, 3, "both")).toBe(2);
  });

  it("jumps with Home and End and starts from nothing focused", () => {
    expect(rovingIndex("Home", 2, 3, "vertical")).toBe(0);
    expect(rovingIndex("End", 0, 3, "vertical")).toBe(2);
    expect(rovingIndex("ArrowDown", -1, 3, "vertical")).toBe(0);
    expect(rovingIndex("ArrowUp", -1, 3, "vertical")).toBe(2);
  });

  it("ignores other keys and empty collections", () => {
    expect(rovingIndex("a", 0, 3, "vertical")).toBeNull();
    expect(rovingIndex("ArrowDown", 0, 0, "vertical")).toBeNull();
  });
});
```

Create `src/ui/foundation/popoverPosition.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computePopoverPosition } from "./popoverPosition";

const VIEWPORT = { width: 1000, height: 800 };
const MENU = { width: 200, height: 120 };

describe("computePopoverPosition", () => {
  it("opens below the anchor, aligned to its start, with a 4px gap", () => {
    const anchor = { top: 100, left: 300, width: 80, height: 28 };

    expect(computePopoverPosition(anchor, MENU, VIEWPORT, "bottom-start")).toEqual({
      top: 132,
      left: 300,
      placement: "bottom-start",
    });
  });

  it("aligns to the anchor end", () => {
    const anchor = { top: 100, left: 300, width: 80, height: 28 };

    expect(computePopoverPosition(anchor, MENU, VIEWPORT, "bottom-end").left).toBe(180);
  });

  it("flips above when there is no room below", () => {
    const anchor = { top: 740, left: 300, width: 80, height: 28 };

    expect(computePopoverPosition(anchor, MENU, VIEWPORT, "bottom-start")).toEqual({
      top: 616,
      left: 300,
      placement: "top-start",
    });
  });

  it("flips a submenu to the left side at the right window edge", () => {
    const anchor = { top: 200, left: 850, width: 140, height: 28 };

    expect(computePopoverPosition(anchor, MENU, VIEWPORT, "right-start")).toEqual({
      top: 200,
      left: 646,
      placement: "left-start",
    });
  });

  it("clamps inside an 8px margin when the anchor is at the edge", () => {
    const anchor = { top: 100, left: 2, width: 20, height: 28 };

    expect(computePopoverPosition(anchor, MENU, VIEWPORT, "bottom-end").left).toBe(8);
  });

  it("never returns negative coordinates for a popover larger than the window", () => {
    const anchor = { top: 10, left: 10, width: 20, height: 20 };
    const position = computePopoverPosition(
      anchor,
      { width: 1400, height: 1200 },
      VIEWPORT,
      "bottom-start",
    );

    expect(position).toEqual({ top: 8, left: 8, placement: "bottom-start" });
  });
});
```

Create `src/ui/foundation/focus.test.ts`:

```ts
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { focusableWithin, trapTabKey } from "./focus";

function container(markup: string): HTMLElement {
  const element = document.createElement("div");
  element.tabIndex = -1;
  element.innerHTML = markup;
  document.body.append(element);
  return element;
}

function tab(shiftKey = false) {
  return { key: "Tab", shiftKey, preventDefault: vi.fn() };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("focus trap", () => {
  it("lists enabled focusable descendants in document order", () => {
    const root = container(
      '<button id="a">A</button><button disabled>B</button><input id="c" /><span tabindex="-1">D</span><a href="#x" id="e">E</a>',
    );

    expect(focusableWithin(root).map((element) => element.id)).toEqual(["a", "c", "e"]);
  });

  it("wraps Tab from the last element to the first", () => {
    const root = container('<button id="first">1</button><button id="last">2</button>');
    root.querySelector<HTMLElement>("#last")?.focus();
    const event = tab();

    trapTabKey(event, root);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(document.activeElement?.id).toBe("first");
  });

  it("wraps Shift+Tab from the first element to the last", () => {
    const root = container('<button id="first">1</button><button id="last">2</button>');
    root.querySelector<HTMLElement>("#first")?.focus();

    trapTabKey(tab(true), root);

    expect(document.activeElement?.id).toBe("last");
  });

  it("keeps focus on the container when nothing inside can take it", () => {
    const root = container("<p>Nothing to focus</p>");
    const event = tab();

    trapTabKey(event, root);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(document.activeElement).toBe(root);
  });

  it("lets Tab move naturally between middle elements", () => {
    const root = container('<button id="a">1</button><button id="b">2</button><button>3</button>');
    root.querySelector<HTMLElement>("#a")?.focus();
    const event = tab();

    trapTabKey(event, root);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
```

Create `src/ui/foundation/foundationHooks.test.tsx`:

```tsx
// @vitest-environment jsdom

import { useEffect, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountUi, pointer, press, type MountedUi } from "./foundationTestSupport";
import { Spinner } from "./Spinner";
import { useDismiss } from "./useDismiss";
import { useRestoreFocus } from "./useRestoreFocus";

let ui: MountedUi | null = null;

afterEach(() => {
  ui?.unmount();
  ui = null;
  document.body.replaceChildren();
});

function DismissProbe({ active, onDismiss }: { readonly active: boolean; onDismiss(): void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  useDismiss(active, containerRef, anchorRef, onDismiss);
  return (
    <>
      <button ref={anchorRef} type="button">
        anchor
      </button>
      <div ref={containerRef}>
        <button type="button">inside</button>
      </div>
    </>
  );
}

function FocusTaker() {
  const innerRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    innerRef.current?.focus();
  }, []);
  return (
    <button ref={innerRef} type="button">
      inner
    </button>
  );
}

function RestoringSurface() {
  useRestoreFocus();
  return <FocusTaker />;
}

describe("useDismiss", () => {
  it("dismisses on an outside pointer and on Escape, not inside or on the anchor", () => {
    const onDismiss = vi.fn();
    ui = mountUi();
    ui.render(<DismissProbe active onDismiss={onDismiss} />);
    const [anchor, inside] = [...ui.host.querySelectorAll("button")];

    pointer(inside as Element, "pointerdown");
    pointer(anchor as Element, "pointerdown");
    expect(onDismiss).not.toHaveBeenCalled();

    pointer(document.body, "pointerdown");
    press(inside as Element, "Escape");
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it("stays silent while inactive and after unmount", () => {
    const onDismiss = vi.fn();
    ui = mountUi();
    ui.render(<DismissProbe active={false} onDismiss={onDismiss} />);
    pointer(document.body, "pointerdown");

    ui.render(<DismissProbe active onDismiss={onDismiss} />);
    ui.unmount();
    ui = null;
    pointer(document.body, "pointerdown");

    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe("useRestoreFocus", () => {
  it("returns focus to the element focused before a child grabbed it", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    ui = mountUi();

    ui.render(<RestoringSurface />);
    expect(document.activeElement?.textContent).toBe("inner");

    ui.render(null);
    expect(document.activeElement).toBe(trigger);
  });

  it("does nothing when the previous element left the document", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    ui = mountUi();
    ui.render(<RestoringSurface />);
    trigger.remove();

    ui.render(null);

    expect(document.activeElement).toBe(document.body);
  });
});

describe("Spinner", () => {
  it("is decorative without a label and a status with one", () => {
    ui = mountUi();
    ui.render(<Spinner />);
    expect(ui.host.querySelector(".cv-spinner")?.getAttribute("aria-hidden")).toBe("true");

    ui.render(<Spinner label="Loading threads" />);
    const status = ui.host.querySelector('[role="status"]');
    expect(status?.getAttribute("aria-label")).toBe("Loading threads");
    expect(status?.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});
```

Create `src/ui/foundation/foundationStyles.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  COLOR_LITERAL,
  parseAllStyleSheets,
  selectorParts,
  varReferences,
} from "../../components/cssContractTestSupport";

const parsed = parseAllStyleSheets();
const foundationRules = parsed.rules.filter((rule) => rule.sheet.startsWith("ui/foundation/"));
const tokenRules = parsed.rules.filter((rule) => rule.sheet.startsWith("ui/tokens/"));
const declared = new Set(
  [...tokenRules, ...foundationRules]
    .flatMap((rule) => rule.declarations.map((declaration) => declaration.property))
    .filter((property) => property.startsWith("--cv-")),
);
const MOTION_PROPERTIES = new Set([
  "transition",
  "transition-duration",
  "animation",
  "animation-duration",
]);
const DURATION_LITERAL = /(^|[\s,(])\d+(\.\d+)?m?s\b/;
const MOTION_TOKEN = /var\(--cv-motion-(fast|base|slow|spin)\)/;
const LEGACY_TOKEN = /var\(\s*--(color|agent|codevo|settings|toast|change)-/;
const CLASS_NAME = /\.(-?[_a-zA-Z][\w-]*)/g;
const REDUCED_MOTION = "@media (prefers-reduced-motion: reduce)";

function declarations() {
  return foundationRules.flatMap((rule) =>
    rule.declarations.map((declaration) => ({ rule, declaration })),
  );
}

describe("foundation stylesheets", () => {
  it("exist and parse cleanly", () => {
    expect(parsed.issues).toEqual([]);
    expect(foundationRules.length).toBeGreaterThan(0);
  });

  it("declare no colour literals", () => {
    const literals = declarations()
      .filter(({ declaration }) => COLOR_LITERAL.test(declaration.value))
      .map(({ rule, declaration }) => `${rule.sheet} ${rule.selector} ${declaration.property}`);

    expect(literals).toEqual([]);
  });

  it("reference only declared --cv tokens and never the legacy ones", () => {
    const undeclared = declarations().flatMap(({ rule, declaration }) =>
      varReferences(declaration.value)
        .filter((name) => name.startsWith("--cv-") && !declared.has(name))
        .map((name) => `${rule.sheet} ${rule.selector} ${name}`),
    );
    const legacy = declarations()
      .filter(({ declaration }) => LEGACY_TOKEN.test(declaration.value))
      .map(({ rule, declaration }) => `${rule.sheet} ${rule.selector} ${declaration.property}`);

    expect(undeclared).toEqual([]);
    expect(legacy).toEqual([]);
  });

  it("animate only through the motion tokens", () => {
    const offenders = declarations()
      .filter(({ declaration }) => MOTION_PROPERTIES.has(declaration.property))
      .filter(({ declaration }) => declaration.value !== "none")
      .filter(
        ({ declaration }) =>
          DURATION_LITERAL.test(declaration.value) || !MOTION_TOKEN.test(declaration.value),
      )
      .map(({ rule, declaration }) => `${rule.sheet} ${rule.selector}: ${declaration.value}`);

    expect(offenders).toEqual([]);
  });

  it("scope every class selector to the cv- namespace", () => {
    const foreign = foundationRules
      .flatMap((rule) => selectorParts(rule.selector))
      .flatMap((part) => [...part.matchAll(CLASS_NAME)].map((match) => match[1] ?? ""))
      .filter((name) => !name.startsWith("cv-"));

    expect(foreign).toEqual([]);
  });

  it("stops the spinner under reduced motion", () => {
    const reduced = foundationRules.filter(
      (rule) =>
        rule.context.includes(REDUCED_MOTION) &&
        selectorParts(rule.selector).includes(".cv-spinner"),
    );

    expect(
      reduced.flatMap((rule) => rule.declarations).find((entry) => entry.property === "animation")
        ?.value,
    ).toBe("none");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/foundation`
Expected: FAIL with unresolved imports (`./roving`, `./popoverPosition`, `./focus`, `./Spinner`, `./useDismiss`, `./useRestoreFocus`) and "foundationRules.length" 0.

- [ ] **Step 3: Implement the helpers**

Create `src/ui/foundation/classNames.ts`:

```ts
export function cx(...parts: ReadonlyArray<string | false | null | undefined>): string {
  return parts
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" ");
}
```

Create `src/ui/foundation/roving.ts`:

```ts
export type RovingOrientation = "vertical" | "horizontal" | "both";

const NEXT_KEYS: Readonly<Record<RovingOrientation, readonly string[]>> = {
  vertical: ["ArrowDown"],
  horizontal: ["ArrowRight"],
  both: ["ArrowDown", "ArrowRight"],
};

const PREVIOUS_KEYS: Readonly<Record<RovingOrientation, readonly string[]>> = {
  vertical: ["ArrowUp"],
  horizontal: ["ArrowLeft"],
  both: ["ArrowUp", "ArrowLeft"],
};

export function rovingIndex(
  key: string,
  current: number,
  count: number,
  orientation: RovingOrientation,
): number | null {
  if (count <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (NEXT_KEYS[orientation].includes(key)) return (Math.max(current, -1) + 1) % count;
  if (!PREVIOUS_KEYS[orientation].includes(key)) return null;
  if (current <= 0) return count - 1;
  return current - 1;
}
```

Create `src/ui/foundation/popoverPosition.ts`:

```ts
export type PopoverPlacement =
  | "bottom-start"
  | "bottom-end"
  | "top-start"
  | "top-end"
  | "right-start"
  | "left-start";

export interface Rect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface PopoverPosition {
  readonly top: number;
  readonly left: number;
  readonly placement: PopoverPlacement;
}

interface Point {
  readonly top: number;
  readonly left: number;
}

const GAP = 4;
const MARGIN = 8;

const FLIPPED: Readonly<Record<PopoverPlacement, PopoverPlacement>> = {
  "bottom-start": "top-start",
  "bottom-end": "top-end",
  "top-start": "bottom-start",
  "top-end": "bottom-end",
  "right-start": "left-start",
  "left-start": "right-start",
};

export function computePopoverPosition(
  anchor: Rect,
  popover: Size,
  viewport: Size,
  placement: PopoverPlacement,
): PopoverPosition {
  const chosen = choosePlacement(anchor, popover, viewport, placement);
  const point = placeAt(anchor, popover, chosen);
  return {
    top: clamp(point.top, MARGIN, viewport.height - popover.height - MARGIN),
    left: clamp(point.left, MARGIN, viewport.width - popover.width - MARGIN),
    placement: chosen,
  };
}

function choosePlacement(
  anchor: Rect,
  popover: Size,
  viewport: Size,
  placement: PopoverPlacement,
): PopoverPlacement {
  if (fitsMainAxis(placeAt(anchor, popover, placement), popover, viewport, placement)) {
    return placement;
  }
  const flipped = FLIPPED[placement];
  if (fitsMainAxis(placeAt(anchor, popover, flipped), popover, viewport, flipped)) return flipped;
  return placement;
}

function fitsMainAxis(
  point: Point,
  popover: Size,
  viewport: Size,
  placement: PopoverPlacement,
): boolean {
  if (placement === "right-start" || placement === "left-start") {
    return point.left >= MARGIN && point.left + popover.width <= viewport.width - MARGIN;
  }
  return point.top >= MARGIN && point.top + popover.height <= viewport.height - MARGIN;
}

function placeAt(anchor: Rect, popover: Size, placement: PopoverPlacement): Point {
  const below = anchor.top + anchor.height + GAP;
  const above = anchor.top - GAP - popover.height;
  const endAligned = anchor.left + anchor.width - popover.width;
  switch (placement) {
    case "bottom-start":
      return { top: below, left: anchor.left };
    case "bottom-end":
      return { top: below, left: endAligned };
    case "top-start":
      return { top: above, left: anchor.left };
    case "top-end":
      return { top: above, left: endAligned };
    case "right-start":
      return { top: anchor.top, left: anchor.left + anchor.width + GAP };
    case "left-start":
      return { top: anchor.top, left: anchor.left - GAP - popover.width };
  }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}
```

Create `src/ui/foundation/focus.ts`:

```ts
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface TabKeyEvent {
  readonly key: string;
  readonly shiftKey: boolean;
  preventDefault(): void;
}

export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.getAttribute("aria-hidden") !== "true",
  );
}

export function trapTabKey(event: TabKeyEvent, root: HTMLElement): void {
  if (event.key !== "Tab") return;
  const focusable = focusableWithin(root);
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (first === undefined || last === undefined) {
    event.preventDefault();
    root.focus();
    return;
  }
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === root)) {
    event.preventDefault();
    last.focus();
    return;
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
```

Create `src/ui/foundation/useLatest.ts`:

```ts
import { useLayoutEffect, useRef, type RefObject } from "react";

export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
```

Create `src/ui/foundation/useRestoreFocus.ts`:

```ts
import { useEffect, useState } from "react";

export function useRestoreFocus(): void {
  const [previous] = useState<Element | null>(() => document.activeElement);
  useEffect(
    () => () => {
      if (!(previous instanceof HTMLElement)) return;
      if (!previous.isConnected) return;
      previous.focus();
    },
    [previous],
  );
}
```

Create `src/ui/foundation/useDismiss.ts`:

```ts
import { useEffect, type RefObject } from "react";
import { useLatest } from "./useLatest";

export function useDismiss(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  anchorRef: RefObject<HTMLElement | null>,
  onDismiss: () => void,
): void {
  const onDismissRef = useLatest(onDismiss);
  useEffect(() => {
    if (!active) return;
    const isInside = (target: EventTarget | null): boolean =>
      target instanceof Node &&
      [containerRef.current, anchorRef.current].some((element) => element?.contains(target));
    const handlePointerDown = (event: PointerEvent): void => {
      if (isInside(event.target)) return;
      onDismissRef.current();
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onDismissRef.current();
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [active, anchorRef, containerRef, onDismissRef]);
}
```

Create `src/ui/foundation/usePopoverPosition.ts`:

```ts
import { useLayoutEffect, useState, type RefObject } from "react";
import {
  computePopoverPosition,
  type PopoverPlacement,
  type PopoverPosition,
} from "./popoverPosition";

const OFFSCREEN = -10000;

export function usePopoverPosition(
  anchorRef: RefObject<HTMLElement | null>,
  surfaceRef: RefObject<HTMLElement | null>,
  placement: PopoverPlacement,
): PopoverPosition {
  const [position, setPosition] = useState<PopoverPosition>({
    top: OFFSCREEN,
    left: OFFSCREEN,
    placement,
  });
  useLayoutEffect(() => {
    const update = (): void => {
      const anchor = anchorRef.current;
      const surface = surfaceRef.current;
      if (anchor === null || surface === null) return;
      const rect = anchor.getBoundingClientRect();
      const next = computePopoverPosition(
        { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        { width: surface.offsetWidth, height: surface.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        placement,
      );
      setPosition((current) =>
        current.top === next.top &&
        current.left === next.left &&
        current.placement === next.placement
          ? current
          : next,
      );
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRef, placement, surfaceRef]);
  return position;
}
```

Create `src/ui/foundation/Spinner.tsx`:

```tsx
import "./status.css";

export interface SpinnerProps {
  readonly label?: string;
}

export function Spinner({ label }: SpinnerProps) {
  const glyph = (
    <svg aria-hidden="true" className="cv-spinner" fill="none" height="12" viewBox="0 0 12 12" width="12">
      <circle cx="6" cy="6" opacity="0.25" r="5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 1a5 5 0 0 1 5 5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  );
  if (label === undefined) return glyph;
  return (
    <span aria-label={label} className="cv-spinner-status" role="status">
      {glyph}
    </span>
  );
}
```

Create `src/ui/foundation/status.css`:

```css
.cv-spinner {
  flex: none;
  width: 12px;
  height: 12px;
  animation: cv-spin var(--cv-motion-spin) linear infinite;
}

.cv-spinner-status {
  display: inline-grid;
  place-items: center;
}

@keyframes cv-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .cv-spinner {
    animation: none;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui/foundation src/components/cssBorderContract.test.ts src/domain/themeContrast.test.ts`
Expected: PASS.

- [ ] **Step 5: Format, type-check, lint**

Run: `npx prettier --write src/ui/foundation && npx tsc --noEmit && npm run lint -- --max-warnings 0 && npm run lint:exhaustive-deps`
Expected: exit 0. (`src/ui/foundation` contains only files this stream created, so writing the directory is safe here; never prettier any other directory.)

- [ ] **Step 6: Hand off (no commit)**

---

### Task 8: Buttons (Button, IconButton, SubmitButton)

**Files:**
- Create: `src/ui/foundation/Button.tsx`, `src/ui/foundation/IconButton.tsx`, `src/ui/foundation/SubmitButton.tsx`, `src/ui/foundation/buttons.css`
- Test: `src/ui/foundation/buttons.test.tsx`

**Interfaces:**
- Consumes: `cx` (Task 7), tokens.
- Produces:
  - `Button(props: ButtonProps)` with `type ButtonVariant = "default" | "primary" | "ghost"`, `type ButtonSize = "sm" | "md"`, `interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?; size?; icon?: ReactNode; children: ReactNode }`
  - `IconButton(props: IconButtonProps)` with `type IconButtonSize = "xs" | "sm" | "round"`, `interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "aria-pressed" | "children"> { label: string; icon: ReactNode; size?; pressed?: boolean }`
  - `SubmitButton(props: SubmitButtonProps)` with `type SubmitButtonMode = "send" | "stop" | "update"`, `interface SubmitButtonProps { mode; disabled?; label?; onClick?(): void }`

- [ ] **Step 1: Write the failing test**

Create `src/ui/foundation/buttons.test.tsx`:

```tsx
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { click, mountUi, type MountedUi } from "./foundationTestSupport";
import { IconButton } from "./IconButton";
import { SubmitButton } from "./SubmitButton";

let ui: MountedUi | null = null;

afterEach(() => {
  ui?.unmount();
  ui = null;
});

function mount(node: Parameters<MountedUi["render"]>[0]): MountedUi {
  ui = mountUi();
  ui.render(node);
  return ui;
}

describe("Button", () => {
  it("defaults to a non-submitting medium default button", () => {
    const { host } = mount(<Button>Commit</Button>);
    const button = host.querySelector("button");

    expect(button?.type).toBe("button");
    expect(button?.className).toBe("cv-button cv-button--default cv-button--md");
    expect(button?.textContent).toBe("Commit");
  });

  it("renders variants, sizes, a decorative icon and extra layout classes", () => {
    const { host } = mount(
      <Button className="layout-gap" icon={<svg />} size="sm" variant="primary">
        Push
      </Button>,
    );
    const button = host.querySelector("button");

    expect(button?.className).toBe("cv-button cv-button--primary cv-button--sm layout-gap");
    expect(button?.querySelector(".cv-button__icon")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("forwards clicks and blocks them while disabled", () => {
    const onClick = vi.fn();
    const { host, render } = mount(<Button onClick={onClick}>Run</Button>);

    click(host.querySelector("button") as Element);
    render(
      <Button disabled onClick={onClick}>
        Run
      </Button>,
    );
    click(host.querySelector("button") as Element);

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("IconButton", () => {
  it("names the button from its label and hides the glyph", () => {
    const { host } = mount(<IconButton icon={<svg />} label="Close panel" />);
    const button = host.querySelector("button");

    expect(button?.getAttribute("aria-label")).toBe("Close panel");
    expect(button?.title).toBe("Close panel");
    expect(button?.hasAttribute("aria-pressed")).toBe(false);
    expect(button?.className).toBe("cv-icon-button cv-icon-button--sm");
    expect(button?.querySelector(".cv-icon-button__glyph")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  it("exposes toggle state only when pressed is given", () => {
    const { host } = mount(<IconButton icon={<svg />} label="Wrap" pressed size="xs" />);

    expect(host.querySelector("button")?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector("button")?.className).toContain("cv-icon-button--xs");
  });
});

describe("SubmitButton", () => {
  it("sends with the t3code arrow as a submit button", () => {
    const { host } = mount(<SubmitButton mode="send" />);
    const button = host.querySelector("button");

    expect(button?.type).toBe("submit");
    expect(button?.getAttribute("aria-label")).toBe("Send message");
    expect(button?.querySelector("path")?.getAttribute("d")).toBe("M8 3L8 13M8 3L4 7M8 3L12 7");
  });

  it("stops as a plain button with the stop square", () => {
    const onClick = vi.fn();
    const { host } = mount(<SubmitButton mode="stop" onClick={onClick} />);
    const button = host.querySelector("button");

    expect(button?.type).toBe("button");
    expect(button?.getAttribute("aria-label")).toBe("Stop generation");
    expect(button?.className).toBe("cv-submit cv-submit--stop");
    expect(button?.querySelector("rect")).not.toBeNull();
    click(button as Element);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("supports the queued-edit label, custom labels and the disabled state", () => {
    const { host, render } = mount(<SubmitButton disabled mode="update" />);

    expect(host.querySelector("button")?.getAttribute("aria-label")).toBe(
      "Update queued message",
    );
    expect(host.querySelector("button")?.disabled).toBe(true);
    render(<SubmitButton label="Send to Codex" mode="send" />);
    expect(host.querySelector("button")?.getAttribute("aria-label")).toBe("Send to Codex");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/foundation/buttons.test.tsx`
Expected: FAIL with unresolved `./Button`, `./IconButton`, `./SubmitButton`.

- [ ] **Step 3: Implement the buttons**

Create `src/ui/foundation/Button.tsx`:

```tsx
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./classNames";
import "./buttons.css";

export type ButtonVariant = "default" | "primary" | "ghost";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly icon?: ReactNode;
  readonly children: ReactNode;
}

export function Button({
  children,
  className,
  icon,
  size = "md",
  type = "button",
  variant = "default",
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      className={cx("cv-button", `cv-button--${variant}`, `cv-button--${size}`, className)}
      type={type}
    >
      {icon === undefined ? null : (
        <span aria-hidden="true" className="cv-button__icon">
          {icon}
        </span>
      )}
      {children}
    </button>
  );
}
```

Create `src/ui/foundation/IconButton.tsx`:

```tsx
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./classNames";
import "./buttons.css";

export type IconButtonSize = "xs" | "sm" | "round";

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "aria-pressed" | "children"> {
  readonly label: string;
  readonly icon: ReactNode;
  readonly size?: IconButtonSize;
  readonly pressed?: boolean;
}

export function IconButton({
  className,
  icon,
  label,
  pressed,
  size = "sm",
  title,
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...rest}
      aria-label={label}
      aria-pressed={pressed}
      className={cx("cv-icon-button", `cv-icon-button--${size}`, className)}
      title={title ?? label}
      type={type}
    >
      <span aria-hidden="true" className="cv-icon-button__glyph">
        {icon}
      </span>
    </button>
  );
}
```

Create `src/ui/foundation/SubmitButton.tsx`:

```tsx
import { cx } from "./classNames";
import "./buttons.css";

export type SubmitButtonMode = "send" | "stop" | "update";

export interface SubmitButtonProps {
  readonly mode: SubmitButtonMode;
  readonly disabled?: boolean;
  readonly label?: string;
  onClick?(): void;
}

const LABELS: Readonly<Record<SubmitButtonMode, string>> = {
  send: "Send message",
  stop: "Stop generation",
  update: "Update queued message",
};

export function SubmitButton({ disabled = false, label, mode, onClick }: SubmitButtonProps) {
  const accessibleLabel = label ?? LABELS[mode];
  const stopping = mode === "stop";
  return (
    <button
      aria-label={accessibleLabel}
      className={cx("cv-submit", stopping && "cv-submit--stop")}
      disabled={disabled}
      onClick={onClick}
      title={accessibleLabel}
      type={stopping ? "button" : "submit"}
    >
      {stopping ? <StopGlyph /> : <ArrowGlyph />}
    </button>
  );
}

function ArrowGlyph() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 16 16"
      width="16"
    >
      <path d="M8 3L8 13M8 3L4 7M8 3L12 7" />
    </svg>
  );
}

function StopGlyph() {
  return (
    <svg aria-hidden="true" fill="currentColor" height="12" viewBox="0 0 12 12" width="12">
      <rect height="8" rx="1.5" width="8" x="2" y="2" />
    </svg>
  );
}
```

Create `src/ui/foundation/buttons.css`:

```css
.cv-button {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--cv-r-control);
  background: var(--cv-tint-1);
  box-shadow: var(--cv-ring-hair-strong);
  color: var(--cv-fg);
  font: 500 var(--cv-t-xs) / 1 var(--cv-font-ui);
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color var(--cv-motion-fast),
    color var(--cv-motion-fast);
}

.cv-button:hover:not(:disabled) {
  background: var(--cv-tint-2);
  color: var(--cv-fg-strong);
}

.cv-button:disabled {
  color: var(--cv-fg-disabled);
  cursor: default;
}

.cv-button:focus-visible,
.cv-icon-button:focus-visible,
.cv-submit:focus-visible {
  outline: 2px solid var(--cv-focus);
  outline-offset: 2px;
}

.cv-button--sm {
  height: 24px;
  padding: 0 8px;
  border-radius: var(--cv-r-sm);
}

.cv-button--primary {
  background: var(--cv-accent-fill);
  box-shadow: var(--cv-fill-edge);
  color: var(--cv-on-accent);
}

.cv-button--primary:hover:not(:disabled) {
  background: var(--cv-accent-fill);
  color: var(--cv-on-accent);
  filter: brightness(1.06);
}

.cv-button--primary:disabled {
  color: var(--cv-on-accent);
  opacity: 0.5;
}

.cv-button--ghost {
  background: transparent;
  box-shadow: none;
  color: var(--cv-fg-muted);
}

.cv-button__icon {
  display: inline-grid;
  place-items: center;
  color: var(--cv-fg-subtle);
}

.cv-button--primary .cv-button__icon {
  color: inherit;
}

.cv-icon-button {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--cv-r-control);
  background: transparent;
  color: var(--cv-fg-subtle);
  cursor: pointer;
  transition:
    background-color var(--cv-motion-fast),
    color var(--cv-motion-fast);
}

.cv-icon-button:hover:not(:disabled),
.cv-icon-button[aria-pressed="true"] {
  background: var(--cv-tint-2);
  color: var(--cv-fg-strong);
}

.cv-icon-button:disabled {
  color: var(--cv-fg-disabled);
  cursor: default;
}

.cv-icon-button--xs {
  width: 24px;
  height: 24px;
  border-radius: var(--cv-r-sm);
}

.cv-icon-button--round {
  width: 32px;
  height: 32px;
  border-radius: 50%;
}

.cv-icon-button__glyph {
  display: inline-grid;
  place-items: center;
}

.cv-submit {
  display: grid;
  flex: none;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--cv-accent-fill);
  box-shadow: var(--cv-fill-edge);
  color: var(--cv-on-accent);
  cursor: pointer;
  transition:
    transform var(--cv-motion-base) var(--cv-ease),
    opacity var(--cv-motion-base);
}

.cv-submit:hover:not(:disabled) {
  transform: scale(1.05);
}

.cv-submit:disabled {
  opacity: 0.3;
  cursor: default;
}

.cv-submit--stop {
  background: var(--cv-fg-strong);
  color: var(--cv-canvas);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui/foundation/buttons.test.tsx src/ui/foundation/foundationStyles.test.ts src/components/cssBorderContract.test.ts`
Expected: PASS.

- [ ] **Step 5: Format, type-check, lint**

Run: `npx prettier --write src/ui/foundation/Button.tsx src/ui/foundation/IconButton.tsx src/ui/foundation/SubmitButton.tsx src/ui/foundation/buttons.test.tsx && npx tsc --noEmit && npm run lint -- --max-warnings 0`
Expected: exit 0.

- [ ] **Step 6: Hand off (no commit)**

---

### Task 9: Form controls (Kbd, Switch, Checkbox, SegmentedControl, Stepper)

**Files:**
- Create: `src/ui/foundation/Kbd.tsx`, `src/ui/foundation/Switch.tsx`, `src/ui/foundation/Checkbox.tsx`, `src/ui/foundation/SegmentedControl.tsx`, `src/ui/foundation/Stepper.tsx`, `src/ui/foundation/controls.css`
- Test: `src/ui/foundation/controls.test.tsx`

**Interfaces:**
- Consumes: `cx`, `rovingIndex` (Task 7), lucide `Check`, `Minus`, `Plus`.
- Produces:
  - `Kbd({ children: string })` renders `<kbd class="cv-kbd">`; `ShortcutKeys({ keys: readonly string[]; label: string })`
  - `Switch({ checked: boolean; label: string; disabled?: boolean; onChange(checked: boolean): void })` (`role="switch"`)
  - `type CheckboxState = boolean | "mixed"`, `Checkbox({ checked: CheckboxState; label: string; disabled?: boolean; onChange(checked: boolean): void })`
  - `interface SegmentedOption<T extends string> { value: T; label: string; icon?: ReactNode }`, `SegmentedControl<T extends string>({ label: string; options: ReadonlyArray<SegmentedOption<T>>; value: T; iconOnly?: boolean; onChange(value: T): void })`
  - `Stepper({ label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange(value: number): void })` (`role="spinbutton"`)

- [ ] **Step 1: Write the failing test**

Create `src/ui/foundation/controls.test.tsx`:

```tsx
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { Checkbox } from "./Checkbox";
import { click, mountUi, press, type MountedUi } from "./foundationTestSupport";
import { Kbd, ShortcutKeys } from "./Kbd";
import { SegmentedControl } from "./SegmentedControl";
import { Stepper } from "./Stepper";
import { Switch } from "./Switch";

let ui: MountedUi | null = null;

afterEach(() => {
  ui?.unmount();
  ui = null;
});

function mount(node: Parameters<MountedUi["render"]>[0]): MountedUi {
  ui = mountUi();
  ui.render(node);
  return ui;
}

describe("Kbd", () => {
  it("renders keyboard keys and a labelled shortcut group", () => {
    const { host, render } = mount(<Kbd>⌘</Kbd>);
    expect(host.querySelector("kbd.cv-kbd")?.textContent).toBe("⌘");

    render(<ShortcutKeys keys={["⌘", "K"]} label="Command K" />);
    const group = host.querySelector(".cv-kbd-group");
    expect(group?.getAttribute("aria-label")).toBe("Command K");
    expect([...(group?.querySelectorAll("kbd") ?? [])].map((key) => key.textContent)).toEqual([
      "⌘",
      "K",
    ]);
  });
});

describe("Switch", () => {
  it("reports its state and flips on click", () => {
    const onChange = vi.fn();
    const { host } = mount(<Switch checked label="Minimap" onChange={onChange} />);
    const control = host.querySelector('[role="switch"]');

    expect(control?.getAttribute("aria-checked")).toBe("true");
    expect(control?.getAttribute("aria-label")).toBe("Minimap");
    click(control as Element);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("ignores clicks while disabled", () => {
    const onChange = vi.fn();
    const { host } = mount(<Switch checked={false} disabled label="Wrap" onChange={onChange} />);

    click(host.querySelector('[role="switch"]') as Element);

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("Checkbox", () => {
  it("cycles false to true, true to false and mixed to true", () => {
    const onChange = vi.fn();
    const { host, render } = mount(
      <Checkbox checked={false} label="Include file" onChange={onChange} />,
    );
    const box = () => host.querySelector('[role="checkbox"]') as Element;

    click(box());
    render(<Checkbox checked label="Include file" onChange={onChange} />);
    click(box());
    render(<Checkbox checked="mixed" label="Include file" onChange={onChange} />);
    expect(box().getAttribute("aria-checked")).toBe("mixed");
    click(box());

    expect(onChange.mock.calls.map((call) => call[0])).toEqual([true, false, true]);
  });
});

describe("SegmentedControl", () => {
  const OPTIONS = [
    { value: "unified", label: "Unified" },
    { value: "split", label: "Split" },
    { value: "wrap", label: "Wrap" },
  ] as const;

  it("is a labelled radiogroup with one tab stop", () => {
    const { host } = mount(
      <SegmentedControl label="Diff layout" onChange={() => undefined} options={OPTIONS} value="split" />,
    );
    const radios = [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')];

    expect(host.querySelector('[role="radiogroup"]')?.getAttribute("aria-label")).toBe(
      "Diff layout",
    );
    expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
      "false",
    ]);
    expect(radios.map((radio) => radio.tabIndex)).toEqual([-1, 0, -1]);
  });

  it("selects by click and by wrapping arrow keys, moving focus", () => {
    const onChange = vi.fn();
    const { host } = mount(
      <SegmentedControl label="Diff layout" onChange={onChange} options={OPTIONS} value="wrap" />,
    );
    const radios = [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')];

    click(radios[0] as Element);
    press(radios[2] as Element, "ArrowRight");

    expect(onChange.mock.calls.map((call) => call[0])).toEqual(["unified", "unified"]);
    expect(document.activeElement).toBe(radios[0]);
  });

  it("names icon-only options from their labels", () => {
    const { host } = mount(
      <SegmentedControl
        iconOnly
        label="View"
        onChange={() => undefined}
        options={[{ value: "list", label: "List", icon: <svg /> }]}
        value="list"
      />,
    );
    const radio = host.querySelector('[role="radio"]');

    expect(radio?.getAttribute("aria-label")).toBe("List");
    expect(radio?.textContent).toBe("");
  });
});

describe("Stepper", () => {
  it("exposes a spinbutton with its value, bounds and unit", () => {
    const { host } = mount(
      <Stepper label="Editor font size" max={40} min={8} onChange={() => undefined} unit="px" value={13} />,
    );
    const spin = host.querySelector('[role="spinbutton"]');

    expect(spin?.getAttribute("aria-label")).toBe("Editor font size");
    expect(spin?.getAttribute("aria-valuenow")).toBe("13");
    expect(spin?.getAttribute("aria-valuemin")).toBe("8");
    expect(spin?.getAttribute("aria-valuemax")).toBe("40");
    expect(spin?.getAttribute("aria-valuetext")).toBe("13px");
    expect(spin?.textContent).toBe("13px");
  });

  it("steps with keys and buttons and clamps at the bounds", () => {
    const onChange = vi.fn();
    const { host, render } = mount(
      <Stepper label="Size" max={20} min={12} onChange={onChange} value={19} />,
    );
    const spin = () => host.querySelector('[role="spinbutton"]') as Element;

    press(spin(), "ArrowUp");
    press(spin(), "PageUp");
    press(spin(), "Home");
    press(spin(), "ArrowDown");
    render(<Stepper label="Size" max={20} min={12} onChange={onChange} value={20} />);
    press(spin(), "ArrowUp");
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Increase Size"]')?.disabled).toBe(true);
    click(host.querySelector('[aria-label="Decrease Size"]') as Element);

    expect(onChange.mock.calls.map((call) => call[0])).toEqual([20, 20, 12, 18, 19]);
  });

  it("recovers from a non-finite value by starting at the minimum", () => {
    const onChange = vi.fn();
    const { host } = mount(
      <Stepper label="Size" max={20} min={12} onChange={onChange} value={Number.NaN} />,
    );

    expect(host.querySelector('[role="spinbutton"]')?.getAttribute("aria-valuenow")).toBe("12");
    press(host.querySelector('[role="spinbutton"]') as Element, "ArrowUp");
    expect(onChange).toHaveBeenCalledWith(13);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/foundation/controls.test.tsx`
Expected: FAIL with unresolved component imports.

- [ ] **Step 3: Implement the controls**

Create `src/ui/foundation/Kbd.tsx`:

```tsx
import "./controls.css";

export interface KbdProps {
  readonly children: string;
}

export function Kbd({ children }: KbdProps) {
  return <kbd className="cv-kbd">{children}</kbd>;
}

export interface ShortcutKeysProps {
  readonly keys: readonly string[];
  readonly label: string;
}

export function ShortcutKeys({ keys, label }: ShortcutKeysProps) {
  return (
    <span aria-label={label} className="cv-kbd-group" role="img">
      {keys.map((key, index) => (
        <Kbd key={`${index}-${key}`}>{key}</Kbd>
      ))}
    </span>
  );
}
```

Create `src/ui/foundation/Switch.tsx`:

```tsx
import "./controls.css";

export interface SwitchProps {
  readonly checked: boolean;
  readonly label: string;
  readonly disabled?: boolean;
  onChange(checked: boolean): void;
}

export function Switch({ checked, disabled = false, label, onChange }: SwitchProps) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className="cv-switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    />
  );
}
```

Create `src/ui/foundation/Checkbox.tsx`:

```tsx
import { Check, Minus } from "lucide-react";
import "./controls.css";

export type CheckboxState = boolean | "mixed";

export interface CheckboxProps {
  readonly checked: CheckboxState;
  readonly label: string;
  readonly disabled?: boolean;
  onChange(checked: boolean): void;
}

export function Checkbox({ checked, disabled = false, label, onChange }: CheckboxProps) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className="cv-checkbox"
      disabled={disabled}
      onClick={() => onChange(checked !== true)}
      role="checkbox"
      type="button"
    >
      {checked === "mixed" ? (
        <Minus aria-hidden="true" strokeWidth={2.5} />
      ) : (
        <Check aria-hidden="true" strokeWidth={2.5} />
      )}
    </button>
  );
}
```

Create `src/ui/foundation/SegmentedControl.tsx`:

```tsx
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { rovingIndex } from "./roving";
import "./controls.css";

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon?: ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  readonly label: string;
  readonly options: ReadonlyArray<SegmentedOption<T>>;
  readonly value: T;
  readonly iconOnly?: boolean;
  onChange(value: T): void;
}

export function SegmentedControl<T extends string>({
  iconOnly = false,
  label,
  onChange,
  options,
  value,
}: SegmentedControlProps<T>) {
  const groupRef = useRef<HTMLDivElement | null>(null);
  const selectedIndex = options.findIndex((option) => option.value === value);

  const move = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next = rovingIndex(event.key, selectedIndex, options.length, "both");
    if (next === null) return;
    const option = options[next];
    if (option === undefined) return;
    event.preventDefault();
    onChange(option.value);
    groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };

  return (
    <div
      aria-label={label}
      className="cv-segmented"
      onKeyDown={move}
      ref={groupRef}
      role="radiogroup"
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        const tabbable = selected || (selectedIndex < 0 && index === 0);
        return (
          <button
            aria-checked={selected}
            aria-label={iconOnly ? option.label : undefined}
            className="cv-segmented__option"
            key={option.value}
            onClick={() => onChange(option.value)}
            role="radio"
            tabIndex={tabbable ? 0 : -1}
            title={iconOnly ? option.label : undefined}
            type="button"
          >
            {option.icon === undefined ? null : (
              <span aria-hidden="true" className="cv-segmented__icon">
                {option.icon}
              </span>
            )}
            {iconOnly ? null : option.label}
          </button>
        );
      })}
    </div>
  );
}
```

Create `src/ui/foundation/Stepper.tsx`:

```tsx
import { Minus, Plus } from "lucide-react";
import type { KeyboardEvent } from "react";
import "./controls.css";

export interface StepperProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly unit?: string;
  onChange(value: number): void;
}

export function Stepper({ label, max, min, onChange, step = 1, unit = "", value }: StepperProps) {
  const current = Number.isFinite(value) ? clamp(value, min, max) : min;
  const commit = (next: number): void => {
    const clamped = clamp(next, min, max);
    if (clamped === current && Number.isFinite(value)) return;
    onChange(clamped);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>): void => {
    const next = steppedValue(event.key, current, min, max, step);
    if (next === null) return;
    event.preventDefault();
    commit(next);
  };

  return (
    <span className="cv-stepper">
      <button
        aria-label={`Decrease ${label}`}
        className="cv-stepper__button"
        disabled={current <= min}
        onClick={() => commit(current - step)}
        tabIndex={-1}
        type="button"
      >
        <Minus aria-hidden="true" size={14} />
      </button>
      <span
        aria-label={label}
        aria-valuemax={max}
        aria-valuemin={min}
        aria-valuenow={current}
        aria-valuetext={`${current}${unit}`}
        className="cv-stepper__value"
        onKeyDown={handleKeyDown}
        role="spinbutton"
        tabIndex={0}
      >
        {`${current}${unit}`}
      </span>
      <button
        aria-label={`Increase ${label}`}
        className="cv-stepper__button"
        disabled={current >= max}
        onClick={() => commit(current + step)}
        tabIndex={-1}
        type="button"
      >
        <Plus aria-hidden="true" size={14} />
      </button>
    </span>
  );
}

function steppedValue(
  key: string,
  value: number,
  min: number,
  max: number,
  step: number,
): number | null {
  if (key === "ArrowUp" || key === "ArrowRight") return value + step;
  if (key === "ArrowDown" || key === "ArrowLeft") return value - step;
  if (key === "PageUp") return value + step * 10;
  if (key === "PageDown") return value - step * 10;
  if (key === "Home") return min;
  if (key === "End") return max;
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
```

Trace of the Stepper test (the parent never re-renders between key presses, so `value` stays 19): ArrowUp -> 20, PageUp -> 29 clamped to 20, Home -> 12, ArrowDown -> 18; after the rerender at 20, ArrowUp is a no-op at the maximum and the Increase button is disabled; Decrease -> 19. Expected calls: `[20, 20, 12, 18, 19]`.

Create `src/ui/foundation/controls.css`:

```css
.cv-kbd {
  display: inline-grid;
  place-items: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: var(--cv-r-xs);
  background: var(--cv-tint-1);
  box-shadow: var(--cv-ring-hair-strong);
  color: var(--cv-fg-subtle);
  font: 500 var(--cv-t-2xs) / 1 var(--cv-font-ui);
}

.cv-kbd-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.cv-switch {
  position: relative;
  flex: none;
  width: 30px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: var(--cv-r-pill);
  background: var(--cv-switch-track);
  box-shadow: var(--cv-switch-edge);
  cursor: pointer;
  transition: background-color var(--cv-motion-base);
}

.cv-switch::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--cv-switch-knob);
  box-shadow: var(--cv-shadow-knob);
  transition: transform var(--cv-motion-base) var(--cv-ease);
}

.cv-switch[aria-checked="true"] {
  background: var(--cv-accent-fill);
}

.cv-switch[aria-checked="true"]::after {
  transform: translateX(12px);
}

.cv-switch:disabled,
.cv-checkbox:disabled {
  opacity: 0.5;
  cursor: default;
}

.cv-switch:focus-visible,
.cv-checkbox:focus-visible,
.cv-segmented__option:focus-visible,
.cv-stepper__value:focus-visible {
  outline: 2px solid var(--cv-focus);
  outline-offset: 2px;
}

.cv-checkbox {
  display: grid;
  flex: none;
  place-items: center;
  width: 14px;
  height: 14px;
  padding: 0;
  border: 0;
  border-radius: var(--cv-r-xs);
  background: transparent;
  box-shadow: var(--cv-ring-hair-strong);
  color: var(--cv-on-accent);
  cursor: pointer;
}

.cv-checkbox[aria-checked="true"],
.cv-checkbox[aria-checked="mixed"] {
  background: var(--cv-accent-fill);
  box-shadow: var(--cv-fill-edge);
}

.cv-checkbox svg {
  width: 10px;
  height: 10px;
}

.cv-checkbox[aria-checked="false"] svg {
  display: none;
}

.cv-segmented {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: var(--cv-r-control);
  background: var(--cv-tint-1);
  box-shadow: var(--cv-ring-hair);
}

.cv-segmented__option {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 22px;
  height: 22px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--cv-r-sm);
  background: transparent;
  color: var(--cv-fg-muted);
  font: 500 var(--cv-t-xs) / 1 var(--cv-font-ui);
  cursor: pointer;
  transition:
    background-color var(--cv-motion-fast),
    color var(--cv-motion-fast);
}

.cv-segmented__option:hover {
  background: var(--cv-tint-2);
  color: var(--cv-fg-strong);
}

.cv-segmented__option[aria-checked="true"] {
  background: var(--cv-tint-3);
  color: var(--cv-fg-strong);
}

.cv-segmented__icon {
  display: inline-grid;
  place-items: center;
}

.cv-stepper {
  display: inline-flex;
  align-items: center;
  height: 28px;
  border-radius: var(--cv-r-control);
  background: var(--cv-tint-1);
  box-shadow: var(--cv-ring-hair-strong);
}

.cv-stepper__button {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--cv-r-control);
  background: transparent;
  color: var(--cv-fg-subtle);
  cursor: pointer;
}

.cv-stepper__button:hover:not(:disabled) {
  background: var(--cv-tint-2);
  color: var(--cv-fg-strong);
}

.cv-stepper__button:disabled {
  color: var(--cv-fg-disabled);
  cursor: default;
}

.cv-stepper__value {
  min-width: 44px;
  color: var(--cv-fg-strong);
  font: var(--cv-t-md) / 1 var(--cv-font-ui);
  font-variant-numeric: tabular-nums;
  text-align: center;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui/foundation/controls.test.tsx src/ui/foundation/foundationStyles.test.ts src/components/cssBorderContract.test.ts`
Expected: PASS.

- [ ] **Step 5: Format, type-check, lint**

Run: `npx prettier --write src/ui/foundation/Kbd.tsx src/ui/foundation/Switch.tsx src/ui/foundation/Checkbox.tsx src/ui/foundation/SegmentedControl.tsx src/ui/foundation/Stepper.tsx src/ui/foundation/controls.test.tsx && npx tsc --noEmit && npm run lint -- --max-warnings 0`
Expected: exit 0.

- [ ] **Step 6: Hand off (no commit)**

---

### Task 10: Text fields (TextField, TextArea, field hint)

**Files:**
- Create: `src/ui/foundation/fieldIds.ts`, `src/ui/foundation/FieldFrame.tsx`, `src/ui/foundation/TextField.tsx`, `src/ui/foundation/TextArea.tsx`, `src/ui/foundation/fields.css`
- Test: `src/ui/foundation/fields.test.tsx`

**Interfaces:**
- Consumes: `cx` (Task 7).
- Produces:
  - `fieldHintId(id: string): string`, `fieldDescribedBy(id: string, hint?: string, error?: string): string | undefined`
  - `FieldFrame({ id; label; optional?; hint?; error?; children })`
  - `TextField(props: TextFieldProps)`: `interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className" | "onChange" | "value" | "type"> { label: string; value: string; hint?: string; error?: string; optional?: boolean; mono?: boolean; type?: "text" | "search" | "url"; onChange(value: string): void }`
  - `TextArea(props: TextAreaProps)`: `interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "className" | "onChange" | "value"> { label: string; value: string; hint?: string; error?: string; optional?: boolean; onChange(value: string): void }`

- [ ] **Step 1: Write the failing test**

Create `src/ui/foundation/fields.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountUi, type MountedUi } from "./foundationTestSupport";
import { TextArea } from "./TextArea";
import { TextField } from "./TextField";

let ui: MountedUi | null = null;

afterEach(() => {
  ui?.unmount();
  ui = null;
});

function type(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = Object.getPrototypeOf(element) as object;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  act(() => {
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("TextField", () => {
  it("labels the input and describes it with the hint", () => {
    ui = mountUi();
    ui.render(
      <TextField
        hint="Folder name used on disk"
        label="Destination"
        onChange={() => undefined}
        optional
        value="~/code/app"
      />,
    );
    const input = ui.host.querySelector("input") as HTMLInputElement;
    const label = ui.host.querySelector("label");
    const hint = ui.host.querySelector(".cv-field__hint");

    expect(label?.getAttribute("for")).toBe(input.id);
    expect(label?.textContent).toBe("DestinationOptional");
    expect(input.getAttribute("aria-describedby")).toBe(hint?.id);
    expect(hint?.textContent).toBe("Folder name used on disk");
    expect(input.getAttribute("aria-invalid")).toBe("false");
    expect(input.type).toBe("text");
  });

  it("replaces the hint with an alert when the value is invalid", () => {
    ui = mountUi();
    ui.render(
      <TextField
        error="Not a Git URL"
        hint="HTTPS or SSH"
        label="Repository"
        mono
        onChange={() => undefined}
        value="nope"
      />,
    );
    const input = ui.host.querySelector("input") as HTMLInputElement;
    const hint = ui.host.querySelector(".cv-field__hint");

    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.className).toBe("cv-input cv-input--mono");
    expect(hint?.getAttribute("role")).toBe("alert");
    expect(hint?.className).toBe("cv-field__hint cv-field__hint--error");
    expect(hint?.textContent).toBe("Not a Git URL");
  });

  it("reports typed text and omits the description when there is no hint", () => {
    const onChange = vi.fn();
    ui = mountUi();
    ui.render(<TextField label="Branch" onChange={onChange} value="" />);
    const input = ui.host.querySelector("input") as HTMLInputElement;

    type(input, "feature/p1");

    expect(onChange).toHaveBeenCalledWith("feature/p1");
    expect(input.hasAttribute("aria-describedby")).toBe(false);
  });
});

describe("TextArea", () => {
  it("labels the textarea and reports typed text", () => {
    const onChange = vi.fn();
    ui = mountUi();
    ui.render(<TextArea hint="Markdown" label="Description" onChange={onChange} value="" />);
    const area = ui.host.querySelector("textarea") as HTMLTextAreaElement;

    expect(ui.host.querySelector("label")?.getAttribute("for")).toBe(area.id);
    expect(area.className).toBe("cv-textarea");
    type(area, "Adds palettes");
    expect(onChange).toHaveBeenCalledWith("Adds palettes");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/foundation/fields.test.tsx`
Expected: FAIL with unresolved `./TextField`, `./TextArea`.

- [ ] **Step 3: Implement the fields**

Create `src/ui/foundation/fieldIds.ts`:

```ts
export function fieldHintId(id: string): string {
  return `${id}-hint`;
}

export function fieldDescribedBy(id: string, hint?: string, error?: string): string | undefined {
  if (hint === undefined && error === undefined) return undefined;
  return fieldHintId(id);
}
```

Create `src/ui/foundation/FieldFrame.tsx`:

```tsx
import type { ReactNode } from "react";
import { cx } from "./classNames";
import { fieldHintId } from "./fieldIds";
import "./fields.css";

export interface FieldFrameProps {
  readonly id: string;
  readonly label: string;
  readonly optional?: boolean;
  readonly hint?: string;
  readonly error?: string;
  readonly children: ReactNode;
}

export function FieldFrame({ children, error, hint, id, label, optional = false }: FieldFrameProps) {
  const message = error ?? hint;
  return (
    <div className="cv-field">
      <label className="cv-field__label" htmlFor={id}>
        <span>{label}</span>
        {optional ? <span className="cv-field__optional">Optional</span> : null}
      </label>
      {children}
      {message === undefined ? null : (
        <p
          className={cx("cv-field__hint", error !== undefined && "cv-field__hint--error")}
          id={fieldHintId(id)}
          role={error === undefined ? undefined : "alert"}
        >
          {message}
        </p>
      )}
    </div>
  );
}
```

Create `src/ui/foundation/TextField.tsx`:

```tsx
import { useId, type InputHTMLAttributes } from "react";
import { cx } from "./classNames";
import { FieldFrame } from "./FieldFrame";
import { fieldDescribedBy } from "./fieldIds";

export interface TextFieldProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "id" | "className" | "onChange" | "value" | "type"
  > {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly error?: string;
  readonly optional?: boolean;
  readonly mono?: boolean;
  readonly type?: "text" | "search" | "url";
  onChange(value: string): void;
}

export function TextField({
  error,
  hint,
  label,
  mono = false,
  onChange,
  optional,
  type = "text",
  value,
  ...rest
}: TextFieldProps) {
  const id = useId();
  return (
    <FieldFrame error={error} hint={hint} id={id} label={label} optional={optional}>
      <input
        {...rest}
        aria-describedby={fieldDescribedBy(id, hint, error)}
        aria-invalid={error !== undefined}
        className={cx("cv-input", mono && "cv-input--mono")}
        id={id}
        onChange={(event) => onChange(event.currentTarget.value)}
        type={type}
        value={value}
      />
    </FieldFrame>
  );
}
```

Create `src/ui/foundation/TextArea.tsx`:

```tsx
import { useId, type TextareaHTMLAttributes } from "react";
import { FieldFrame } from "./FieldFrame";
import { fieldDescribedBy } from "./fieldIds";

export interface TextAreaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "className" | "onChange" | "value"> {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly error?: string;
  readonly optional?: boolean;
  onChange(value: string): void;
}

export function TextArea({ error, hint, label, onChange, optional, value, ...rest }: TextAreaProps) {
  const id = useId();
  return (
    <FieldFrame error={error} hint={hint} id={id} label={label} optional={optional}>
      <textarea
        {...rest}
        aria-describedby={fieldDescribedBy(id, hint, error)}
        aria-invalid={error !== undefined}
        className="cv-textarea"
        id={id}
        onChange={(event) => onChange(event.currentTarget.value)}
        value={value}
      />
    </FieldFrame>
  );
}
```

Create `src/ui/foundation/fields.css`:

```css
.cv-field {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.cv-field__label {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 6px;
  color: var(--cv-fg-muted);
  font: 500 var(--cv-t-xs) / var(--cv-lh-xs) var(--cv-font-ui);
}

.cv-field__optional {
  color: var(--cv-fg-subtle);
  font-weight: 400;
}

.cv-input,
.cv-textarea {
  display: block;
  width: 100%;
  min-width: 0;
  border: 0;
  border-radius: var(--cv-r-control);
  background: var(--cv-tint-1);
  box-shadow: var(--cv-ring-hair-strong);
  color: var(--cv-fg-strong);
  font: var(--cv-t-md) / var(--cv-lh-sm) var(--cv-font-ui);
  transition: box-shadow var(--cv-motion-fast);
}

.cv-input {
  height: 34px;
  padding: 0 10px;
}

.cv-input--mono {
  font-family: var(--cv-font-mono);
  font-size: var(--cv-t-code);
}

.cv-textarea {
  min-height: 120px;
  padding: 10px;
  line-height: var(--cv-lh-prose);
  resize: vertical;
}

.cv-input::placeholder,
.cv-textarea::placeholder {
  color: var(--cv-fg-subtle);
}

.cv-input:focus-visible,
.cv-textarea:focus-visible {
  outline: none;
  box-shadow: var(--cv-ring-focus);
}

.cv-input[aria-invalid="true"],
.cv-textarea[aria-invalid="true"] {
  box-shadow: var(--cv-ring-danger);
}

.cv-field__hint {
  min-height: 16px;
  margin: 6px 0 0;
  color: var(--cv-fg-subtle);
  font: var(--cv-t-xs) / var(--cv-lh-xs) var(--cv-font-ui);
}

.cv-field__hint--error {
  color: var(--cv-danger);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui/foundation/fields.test.tsx src/ui/foundation/foundationStyles.test.ts src/components/cssBorderContract.test.ts`
Expected: PASS.

- [ ] **Step 5: Format, type-check, lint**

Run: `npx prettier --write src/ui/foundation/fieldIds.ts src/ui/foundation/FieldFrame.tsx src/ui/foundation/TextField.tsx src/ui/foundation/TextArea.tsx src/ui/foundation/fields.test.tsx && npx tsc --noEmit && npm run lint -- --max-warnings 0`
Expected: exit 0.

- [ ] **Step 6: Hand off (no commit)**

---

### Task 11: Overlays (Popover, Menu with Submenu, Dialog)

**Files:**
- Create: `src/ui/foundation/Popover.tsx`, `src/ui/foundation/menuContext.ts`, `src/ui/foundation/menuItems.ts`, `src/ui/foundation/MenuSurface.tsx`, `src/ui/foundation/Menu.tsx`, `src/ui/foundation/MenuItem.tsx`, `src/ui/foundation/Submenu.tsx`, `src/ui/foundation/Dialog.tsx`, `src/ui/foundation/overlays.css`
- Test: `src/ui/foundation/overlays.test.tsx`

**Interfaces:**
- Consumes: `cx`, `rovingIndex`, `PopoverPlacement`, `usePopoverPosition`, `useDismiss`, `useRestoreFocus`, `focusableWithin`, `trapTabKey` (Task 7); lucide `ChevronRight`, `Check`.
- Produces:
  - `Popover({ open; anchorRef: RefObject<HTMLElement | null>; label: string; placement?: PopoverPlacement; className?: string; children; onClose(): void })` - portaled to `document.body`, `role="dialog"`, dismiss on outside pointer and Escape, focus restored.
  - `Menu({ open; anchorRef; label; placement?; children; onClose() })` - `role="menu"`, first enabled item focused on open, Arrow/Home/End roving (disabled skipped), Tab closes, Escape closes, focus restored.
  - `MenuItem({ children; icon?; shortcut?: string; tone?: "default" | "danger"; disabled?; checked?: boolean; onSelect(): void })`, `MenuSeparator()`, `MenuLabel({ children })`
  - `Submenu({ label: string; icon?; children })` - opens on click, Enter, ArrowRight or hover; closes on Escape or ArrowLeft back to its trigger; selecting inside closes every menu.
  - `Dialog({ open; title: string; description?: string; width?: "sm" | "md"; footer?: ReactNode; children?: ReactNode; initialFocusRef?: RefObject<HTMLElement | null>; dismissOnBackdrop?: boolean; onClose(): void })` - `role="dialog"`, `aria-modal`, focus trap, Escape, backdrop dismiss, focus restored.
  - Internal: `MenuContext`, `useMenuContext()`, `menuItems(surface, menuId)`, `focusMenuItem(surface, menuId, key): boolean`, `MenuSurface`.

- [ ] **Step 1: Write the failing test**

Create `src/ui/foundation/overlays.test.tsx`:

```tsx
// @vitest-environment jsdom

import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog";
import { click, mountUi, pointer, press, type MountedUi } from "./foundationTestSupport";
import { Menu } from "./Menu";
import { MenuItem, MenuLabel, MenuSeparator } from "./MenuItem";
import { Popover } from "./Popover";
import { Submenu } from "./Submenu";

let ui: MountedUi | null = null;

afterEach(() => {
  ui?.unmount();
  ui = null;
  document.body.replaceChildren();
});

interface MenuHarnessProps {
  onPin(): void;
  onDelete(): void;
  onMove(target: string): void;
}

function MenuHarness({ onDelete, onMove, onPin }: MenuHarnessProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button onClick={() => setOpen(true)} ref={triggerRef} type="button">
        Actions
      </button>
      <Menu anchorRef={triggerRef} label="Thread actions" onClose={() => setOpen(false)} open={open}>
        <MenuLabel>Thread</MenuLabel>
        <MenuItem onSelect={onPin} shortcut="⌘P">
          Pin
        </MenuItem>
        <MenuItem disabled onSelect={() => undefined}>
          Rename
        </MenuItem>
        <MenuSeparator />
        <Submenu label="Move to">
          <MenuItem onSelect={() => onMove("alpha")}>Alpha</MenuItem>
          <MenuItem checked onSelect={() => onMove("beta")}>
            Beta
          </MenuItem>
        </Submenu>
        <MenuItem onSelect={onDelete} tone="danger">
          Delete
        </MenuItem>
      </Menu>
    </>
  );
}

function openMenu(): { trigger: HTMLButtonElement; spies: MenuHarnessProps } {
  const spies = { onDelete: vi.fn(), onMove: vi.fn(), onPin: vi.fn() };
  ui = mountUi();
  ui.render(<MenuHarness {...spies} />);
  const trigger = ui.host.querySelector("button") as HTMLButtonElement;
  trigger.focus();
  click(trigger);
  return { trigger, spies };
}

function active(): string {
  return document.activeElement?.textContent ?? "";
}

function menus(): HTMLElement[] {
  return [...document.body.querySelectorAll<HTMLElement>('[role="menu"]')];
}

describe("Menu", () => {
  it("opens as a labelled menu and focuses the first enabled item", () => {
    openMenu();

    expect(menus()).toHaveLength(1);
    expect(menus()[0]?.getAttribute("aria-label")).toBe("Thread actions");
    expect(active()).toBe("Pin⌘P");
  });

  it("moves with the arrow keys, skips disabled items and wraps", () => {
    openMenu();

    press(document.activeElement as Element, "ArrowDown");
    expect(active()).toBe("Move to");
    press(document.activeElement as Element, "ArrowDown");
    expect(active()).toBe("Delete");
    press(document.activeElement as Element, "ArrowDown");
    expect(active()).toBe("Pin⌘P");
    press(document.activeElement as Element, "ArrowUp");
    expect(active()).toBe("Delete");
    press(document.activeElement as Element, "Home");
    expect(active()).toBe("Pin⌘P");
    press(document.activeElement as Element, "End");
    expect(active()).toBe("Delete");
  });

  it("selects an item, closes and returns focus to the trigger", () => {
    const { spies, trigger } = openMenu();

    click(document.activeElement as Element);

    expect(spies.onPin).toHaveBeenCalledTimes(1);
    expect(menus()).toHaveLength(0);
    expect(document.activeElement).toBe(trigger);
  });

  it("does not select disabled items and marks danger items", () => {
    const { spies } = openMenu();
    const rename = [...document.body.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.textContent === "Rename",
    );
    const remove = [...document.body.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.textContent === "Delete",
    );

    expect(rename?.getAttribute("aria-disabled")).toBe("true");
    click(rename as Element);
    expect(menus()).toHaveLength(1);
    expect(spies.onPin).not.toHaveBeenCalled();
    expect(remove?.className).toContain("cv-menu__item--danger");
  });

  it("closes on Escape, Tab and an outside pointer", () => {
    const { trigger } = openMenu();
    press(document.activeElement as Element, "Escape");
    expect(menus()).toHaveLength(0);
    expect(document.activeElement).toBe(trigger);

    click(trigger);
    press(document.activeElement as Element, "Tab");
    expect(menus()).toHaveLength(0);

    click(trigger);
    pointer(document.body, "pointerdown");
    expect(menus()).toHaveLength(0);
  });

  it("opens a submenu with ArrowRight and closes only the submenu with ArrowLeft or Escape", () => {
    openMenu();
    press(document.activeElement as Element, "ArrowDown");
    const trigger = document.activeElement as HTMLElement;

    press(trigger, "ArrowRight");
    expect(menus()).toHaveLength(2);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(active()).toBe("Alpha");

    press(document.activeElement as Element, "ArrowLeft");
    expect(menus()).toHaveLength(1);
    expect(document.activeElement).toBe(trigger);

    press(trigger, "ArrowRight");
    press(document.activeElement as Element, "Escape");
    expect(menus()).toHaveLength(1);
    expect(document.activeElement).toBe(trigger);
  });

  it("selects inside a submenu and closes every menu", () => {
    const { spies, trigger } = openMenu();
    const move = [...document.body.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.textContent === "Move to",
    );
    click(move as Element);
    const beta = document.body.querySelector('[role="menuitemcheckbox"]');

    expect(beta?.getAttribute("aria-checked")).toBe("true");
    click(beta as Element);

    expect(spies.onMove).toHaveBeenCalledWith("beta");
    expect(menus()).toHaveLength(0);
    expect(document.activeElement).toBe(trigger);
  });
});

function PopoverHarness() {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button onClick={() => setOpen((current) => !current)} ref={anchorRef} type="button">
        Branch
      </button>
      <Popover anchorRef={anchorRef} label="Branches" onClose={() => setOpen(false)} open={open}>
        <input aria-label="Filter branches" />
      </Popover>
    </>
  );
}

describe("Popover", () => {
  it("portals a labelled dialog, keeps it open for inside and anchor pointers, restores focus", () => {
    ui = mountUi();
    ui.render(<PopoverHarness />);
    const anchor = ui.host.querySelector("button") as HTMLButtonElement;
    anchor.focus();
    click(anchor);
    const popover = document.body.querySelector('[role="dialog"]');

    expect(popover?.getAttribute("aria-label")).toBe("Branches");
    expect(ui.host.contains(popover)).toBe(false);
    pointer(popover?.querySelector("input") as Element, "pointerdown");
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();

    press(popover?.querySelector("input") as Element, "Escape");
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(anchor);
  });
});

interface DialogHarnessProps {
  readonly dismissOnBackdrop?: boolean;
  readonly withInitialFocus?: boolean;
  onClose(): void;
}

function DialogHarness({ dismissOnBackdrop, onClose, withInitialFocus = false }: DialogHarnessProps) {
  const [open, setOpen] = useState(false);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const close = (): void => {
    onClose();
    setOpen(false);
  };
  return (
    <>
      <button onClick={() => setOpen(true)} type="button">
        Trust
      </button>
      <Dialog
        description="Codevo will run project tools."
        dismissOnBackdrop={dismissOnBackdrop}
        footer={
          <>
            <button onClick={close} type="button">
              Cancel
            </button>
            <button onClick={close} ref={confirmRef} type="button">
              Trust folder
            </button>
          </>
        }
        initialFocusRef={withInitialFocus ? confirmRef : undefined}
        onClose={close}
        open={open}
        title="Trust this folder?"
      >
        <input aria-label="Reason" />
      </Dialog>
    </>
  );
}

function openDialog(props: Omit<DialogHarnessProps, "onClose"> = {}) {
  const onClose = vi.fn();
  ui = mountUi();
  ui.render(<DialogHarness {...props} onClose={onClose} />);
  const trigger = ui.host.querySelector("button") as HTMLButtonElement;
  trigger.focus();
  click(trigger);
  return { onClose, trigger, dialog: () => document.body.querySelector('[role="dialog"]') };
}

describe("Dialog", () => {
  it("is a labelled, described modal that focuses its first control", () => {
    const { dialog } = openDialog();
    const surface = dialog();
    const title = document.getElementById(surface?.getAttribute("aria-labelledby") ?? "");
    const description = document.getElementById(surface?.getAttribute("aria-describedby") ?? "");

    expect(surface?.getAttribute("aria-modal")).toBe("true");
    expect(title?.textContent).toBe("Trust this folder?");
    expect(description?.textContent).toBe("Codevo will run project tools.");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Reason");
  });

  it("honours an explicit initial focus target", () => {
    openDialog({ withInitialFocus: true });

    expect(document.activeElement?.textContent).toBe("Trust folder");
  });

  it("traps Tab and Shift+Tab inside the dialog", () => {
    openDialog();

    press(document.activeElement as Element, "Tab", { shiftKey: true });
    expect(document.activeElement?.textContent).toBe("Trust folder");
    press(document.activeElement as Element, "Tab");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Reason");
  });

  it("closes on Escape and returns focus to the trigger", () => {
    const { dialog, onClose, trigger } = openDialog();

    press(document.activeElement as Element, "Escape");

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on a backdrop pointer but not on a pointer inside the dialog", () => {
    const { dialog, onClose } = openDialog();

    pointer(dialog()?.querySelector("input") as Element, "pointerdown");
    expect(onClose).not.toHaveBeenCalled();
    pointer(document.body.querySelector(".cv-overlay") as Element, "pointerdown");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("can require an explicit choice instead of backdrop dismissal", () => {
    const { dialog, onClose } = openDialog({ dismissOnBackdrop: false });

    pointer(document.body.querySelector(".cv-overlay") as Element, "pointerdown");

    expect(onClose).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/foundation/overlays.test.tsx`
Expected: FAIL with unresolved overlay component imports.

- [ ] **Step 3: Implement Popover**

Create `src/ui/foundation/Popover.tsx`:

```tsx
import { useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cx } from "./classNames";
import type { PopoverPlacement } from "./popoverPosition";
import { useDismiss } from "./useDismiss";
import { usePopoverPosition } from "./usePopoverPosition";
import { useRestoreFocus } from "./useRestoreFocus";
import "./overlays.css";

export interface PopoverProps {
  readonly open: boolean;
  readonly anchorRef: RefObject<HTMLElement | null>;
  readonly label: string;
  readonly placement?: PopoverPlacement;
  readonly className?: string;
  readonly children: ReactNode;
  onClose(): void;
}

export function Popover(props: PopoverProps) {
  if (!props.open) return null;
  return createPortal(<PopoverSurface {...props} />, document.body);
}

function PopoverSurface({
  anchorRef,
  children,
  className,
  label,
  onClose,
  placement = "bottom-start",
}: PopoverProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const position = usePopoverPosition(anchorRef, surfaceRef, placement);
  useRestoreFocus();
  useDismiss(true, surfaceRef, anchorRef, onClose);
  return (
    <div
      aria-label={label}
      className={cx("cv-popover", className)}
      data-placement={position.placement}
      ref={surfaceRef}
      role="dialog"
      style={{ left: position.left, top: position.top }}
      tabIndex={-1}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Implement the menu parts**

Create `src/ui/foundation/menuContext.ts`:

```ts
import { createContext, useContext } from "react";

export interface MenuContextValue {
  readonly menuId: string;
  readonly openSubmenuId: string | null;
  openSubmenu(id: string | null): void;
  closeAll(): void;
}

export const MenuContext = createContext<MenuContextValue | null>(null);

export function useMenuContext(): MenuContextValue {
  const value = useContext(MenuContext);
  if (value === null) throw new Error("Menu items must be rendered inside a Menu");
  return value;
}
```

Create `src/ui/foundation/menuItems.ts`:

```ts
import { rovingIndex } from "./roving";

export function menuItems(surface: HTMLElement, menuId: string): HTMLElement[] {
  return [...surface.querySelectorAll<HTMLElement>(`[data-cv-menu="${menuId}"]`)].filter(
    (item) => item.getAttribute("aria-disabled") !== "true",
  );
}

export function focusMenuItem(surface: HTMLElement, menuId: string, key: string): boolean {
  const items = menuItems(surface, menuId);
  const current = items.findIndex((item) => item === document.activeElement);
  const next = rovingIndex(key, current, items.length, "vertical");
  if (next === null) return false;
  items[next]?.focus();
  return true;
}
```

Create `src/ui/foundation/MenuSurface.tsx`:

```tsx
import {
  useEffect,
  useId,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { MenuContext } from "./menuContext";
import { focusMenuItem, menuItems } from "./menuItems";
import type { PopoverPlacement } from "./popoverPosition";
import { usePopoverPosition } from "./usePopoverPosition";
import "./overlays.css";

export interface MenuSurfaceProps {
  readonly anchorRef: RefObject<HTMLElement | null>;
  readonly surfaceRef: RefObject<HTMLDivElement | null>;
  readonly placement: PopoverPlacement;
  readonly label: string;
  readonly children: ReactNode;
  closeAll(): void;
  onKeyDown?(event: KeyboardEvent<HTMLDivElement>): void;
}

export function MenuSurface({
  anchorRef,
  children,
  closeAll,
  label,
  onKeyDown,
  placement,
  surfaceRef,
}: MenuSurfaceProps) {
  const menuId = useId();
  const [openSubmenuId, openSubmenu] = useState<string | null>(null);
  const position = usePopoverPosition(anchorRef, surfaceRef, placement);
  const context = useMemo(
    () => ({ menuId, openSubmenuId, openSubmenu, closeAll }),
    [closeAll, menuId, openSubmenuId],
  );

  useEffect(() => {
    const surface = surfaceRef.current;
    if (surface === null) return;
    menuItems(surface, menuId)[0]?.focus();
  }, [menuId, surfaceRef]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "Tab") {
      event.preventDefault();
      closeAll();
      return;
    }
    const surface = surfaceRef.current;
    if (surface === null) return;
    if (!focusMenuItem(surface, menuId, event.key)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <MenuContext.Provider value={context}>
      <div
        aria-label={label}
        className="cv-menu"
        data-placement={position.placement}
        onKeyDown={handleKeyDown}
        ref={surfaceRef}
        role="menu"
        style={{ left: position.left, top: position.top }}
      >
        {children}
      </div>
    </MenuContext.Provider>
  );
}
```

Create `src/ui/foundation/Menu.tsx`:

```tsx
import { useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { MenuSurface } from "./MenuSurface";
import type { PopoverPlacement } from "./popoverPosition";
import { useDismiss } from "./useDismiss";
import { useRestoreFocus } from "./useRestoreFocus";

export interface MenuProps {
  readonly open: boolean;
  readonly anchorRef: RefObject<HTMLElement | null>;
  readonly label: string;
  readonly placement?: PopoverPlacement;
  readonly children: ReactNode;
  onClose(): void;
}

export function Menu(props: MenuProps) {
  if (!props.open) return null;
  return createPortal(<MenuRoot {...props} />, document.body);
}

function MenuRoot({ anchorRef, children, label, onClose, placement = "bottom-start" }: MenuProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  useRestoreFocus();
  useDismiss(true, surfaceRef, anchorRef, onClose);
  return (
    <MenuSurface
      anchorRef={anchorRef}
      closeAll={onClose}
      label={label}
      placement={placement}
      surfaceRef={surfaceRef}
    >
      {children}
    </MenuSurface>
  );
}
```

Create `src/ui/foundation/MenuItem.tsx`:

```tsx
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./classNames";
import { useMenuContext } from "./menuContext";
import "./overlays.css";

export type MenuItemTone = "default" | "danger";

export interface MenuItemProps {
  readonly children: ReactNode;
  readonly icon?: ReactNode;
  readonly shortcut?: string;
  readonly tone?: MenuItemTone;
  readonly disabled?: boolean;
  readonly checked?: boolean;
  onSelect(): void;
}

export function MenuItem({
  checked,
  children,
  disabled = false,
  icon,
  onSelect,
  shortcut,
  tone = "default",
}: MenuItemProps) {
  const menu = useMenuContext();
  const select = (): void => {
    if (disabled) return;
    onSelect();
    menu.closeAll();
  };
  return (
    <button
      aria-checked={checked}
      aria-disabled={disabled ? true : undefined}
      className={cx("cv-menu__item", tone === "danger" && "cv-menu__item--danger")}
      data-cv-menu={menu.menuId}
      onClick={select}
      onPointerEnter={() => menu.openSubmenu(null)}
      role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
      tabIndex={-1}
      type="button"
    >
      {icon === undefined ? null : (
        <span aria-hidden="true" className="cv-menu__icon">
          {icon}
        </span>
      )}
      <span className="cv-menu__text">{children}</span>
      {shortcut === undefined ? null : <span className="cv-menu__end">{shortcut}</span>}
      {checked === true ? (
        <span aria-hidden="true" className="cv-menu__check">
          <Check size={14} />
        </span>
      ) : null}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="cv-menu__separator" role="separator" />;
}

export interface MenuLabelProps {
  readonly children: ReactNode;
}

export function MenuLabel({ children }: MenuLabelProps) {
  return (
    <div className="cv-menu__label" role="presentation">
      {children}
    </div>
  );
}
```

Create `src/ui/foundation/Submenu.tsx`:

```tsx
import { ChevronRight } from "lucide-react";
import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { useMenuContext } from "./menuContext";
import { MenuSurface } from "./MenuSurface";

export interface SubmenuProps {
  readonly label: string;
  readonly icon?: ReactNode;
  readonly children: ReactNode;
}

export function Submenu({ children, icon, label }: SubmenuProps) {
  const parent = useMenuContext();
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const open = parent.openSubmenuId === id;

  const close = (): void => {
    parent.openSubmenu(null);
    triggerRef.current?.focus();
  };
  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    parent.openSubmenu(id);
  };
  const handleSurfaceKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Escape" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="cv-menu__item"
        data-cv-menu={parent.menuId}
        onClick={() => parent.openSubmenu(id)}
        onKeyDown={handleTriggerKeyDown}
        onPointerEnter={() => parent.openSubmenu(id)}
        ref={triggerRef}
        role="menuitem"
        tabIndex={-1}
        type="button"
      >
        {icon === undefined ? null : (
          <span aria-hidden="true" className="cv-menu__icon">
            {icon}
          </span>
        )}
        <span className="cv-menu__text">{label}</span>
        <span aria-hidden="true" className="cv-menu__end">
          <ChevronRight size={14} />
        </span>
      </button>
      {open ? (
        <MenuSurface
          anchorRef={triggerRef}
          closeAll={parent.closeAll}
          label={label}
          onKeyDown={handleSurfaceKeyDown}
          placement="right-start"
          surfaceRef={surfaceRef}
        >
          {children}
        </MenuSurface>
      ) : null}
    </>
  );
}
```

The submenu surface is rendered inside the parent menu element (not portaled), so outside-pointer dismissal treats it as inside the menu and its key events reach the parent only when it did not handle them.

- [ ] **Step 5: Implement Dialog**

Create `src/ui/foundation/Dialog.tsx`:

```tsx
import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { focusableWithin, trapTabKey } from "./focus";
import { useRestoreFocus } from "./useRestoreFocus";
import "./overlays.css";

export type DialogWidth = "sm" | "md";

export interface DialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly description?: string;
  readonly width?: DialogWidth;
  readonly footer?: ReactNode;
  readonly children?: ReactNode;
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  readonly dismissOnBackdrop?: boolean;
  onClose(): void;
}

export function Dialog(props: DialogProps) {
  if (!props.open) return null;
  return createPortal(<DialogSurface {...props} />, document.body);
}

function DialogSurface({
  children,
  description,
  dismissOnBackdrop = true,
  footer,
  initialFocusRef,
  onClose,
  title,
  width = "sm",
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  useRestoreFocus();

  useEffect(() => {
    initialFocusTarget(surfaceRef.current, initialFocusRef)?.focus();
  }, [initialFocusRef]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    const surface = surfaceRef.current;
    if (surface === null) return;
    trapTabKey(event, surface);
  };
  const handleBackdrop = (event: PointerEvent<HTMLDivElement>): void => {
    if (!dismissOnBackdrop) return;
    if (event.target !== event.currentTarget) return;
    onClose();
  };

  return (
    <div className="cv-overlay" onPointerDown={handleBackdrop}>
      <div
        aria-describedby={description === undefined ? undefined : descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className={`cv-dialog cv-dialog--${width}`}
        onKeyDown={handleKeyDown}
        ref={surfaceRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="cv-dialog__header">
          <h2 className="cv-dialog__title" id={titleId}>
            {title}
          </h2>
          {description === undefined ? null : (
            <p className="cv-dialog__description" id={descriptionId}>
              {description}
            </p>
          )}
        </header>
        {children === undefined ? null : <div className="cv-dialog__body">{children}</div>}
        {footer === undefined ? null : <footer className="cv-dialog__footer">{footer}</footer>}
      </div>
    </div>
  );
}

function initialFocusTarget(
  surface: HTMLElement | null,
  initialFocusRef: RefObject<HTMLElement | null> | undefined,
): HTMLElement | null {
  const explicit = initialFocusRef?.current ?? null;
  if (explicit !== null) return explicit;
  if (surface === null) return null;
  return focusableWithin(surface)[0] ?? surface;
}
```

- [ ] **Step 6: Style the overlays**

Create `src/ui/foundation/overlays.css`:

```css
.cv-popover,
.cv-menu {
  position: fixed;
  z-index: var(--cv-z-popover);
  border-radius: var(--cv-r-card);
  background: var(--cv-popover);
  box-shadow: var(--cv-shadow-pop);
  color: var(--cv-fg);
  font: var(--cv-t-md) / var(--cv-lh-sm) var(--cv-font-ui);
}

.cv-popover:focus-visible,
.cv-dialog:focus-visible {
  outline: none;
}

.cv-menu {
  min-width: 200px;
  padding: 4px;
}

.cv-menu__item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 28px;
  padding: 4px 8px;
  border: 0;
  border-radius: var(--cv-r-sm);
  background: transparent;
  color: var(--cv-fg);
  font: inherit;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}

.cv-menu__item:hover,
.cv-menu__item:focus-visible,
.cv-menu__item[aria-expanded="true"] {
  outline: none;
  background: var(--cv-tint-3);
  color: var(--cv-fg-strong);
}

.cv-menu__item[aria-disabled="true"] {
  background: transparent;
  color: var(--cv-fg-disabled);
  cursor: default;
}

.cv-menu__item--danger,
.cv-menu__item--danger .cv-menu__icon {
  color: var(--cv-danger);
}

.cv-menu__icon {
  display: inline-grid;
  place-items: center;
  color: var(--cv-fg-subtle);
}

.cv-menu__text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cv-menu__end {
  display: inline-flex;
  margin-left: auto;
  padding-left: 16px;
  color: var(--cv-fg-subtle);
  font-variant-numeric: tabular-nums;
}

.cv-menu__check {
  display: inline-grid;
  margin-left: auto;
  color: var(--cv-accent);
}

.cv-menu__separator {
  height: 1px;
  margin: 4px;
  background: var(--cv-hair);
}

.cv-menu__label {
  padding: 4px 8px 2px;
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-2xs);
}

.cv-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--cv-z-dialog);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 96px;
  background: var(--cv-overlay);
  -webkit-backdrop-filter: blur(4px);
  backdrop-filter: blur(4px);
}

.cv-dialog {
  display: flex;
  flex-direction: column;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 144px);
  overflow: hidden;
  border-radius: var(--cv-r-dialog);
  background: var(--cv-popover);
  box-shadow: var(--cv-shadow-dialog);
  color: var(--cv-fg);
  font: var(--cv-t-sm) / var(--cv-lh-sm) var(--cv-font-ui);
}

.cv-dialog--sm {
  width: 456px;
}

.cv-dialog--md {
  width: 576px;
}

.cv-dialog__header {
  padding: 24px 24px 0;
}

.cv-dialog__title {
  margin: 0;
  color: var(--cv-fg-strong);
  font: 600 var(--cv-t-title) / 24px var(--cv-font-display);
  letter-spacing: -0.01em;
}

.cv-dialog__description {
  margin: 8px 0 0;
  color: var(--cv-fg-muted);
  font-size: var(--cv-t-sm);
}

.cv-dialog__body {
  display: grid;
  gap: 16px;
  padding: 16px 24px 24px;
  overflow: auto;
}

.cv-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 24px;
  background: var(--cv-tint-1);
  box-shadow: var(--cv-edge-top-hair);
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/ui/foundation/overlays.test.tsx src/ui/foundation/foundationStyles.test.ts src/components/cssBorderContract.test.ts`
Expected: PASS.

- [ ] **Step 8: Format, type-check, lint**

Run: `npx prettier --write src/ui/foundation/Popover.tsx src/ui/foundation/menuContext.ts src/ui/foundation/menuItems.ts src/ui/foundation/MenuSurface.tsx src/ui/foundation/Menu.tsx src/ui/foundation/MenuItem.tsx src/ui/foundation/Submenu.tsx src/ui/foundation/Dialog.tsx src/ui/foundation/overlays.test.tsx && npx tsc --noEmit && npm run lint -- --max-warnings 0 && npm run lint:exhaustive-deps`
Expected: exit 0.

- [ ] **Step 9: Hand off (no commit)**

---

### Task 12: Panel parts (PanelTabs, TreeRow, ResizeHandle)

**Files:**
- Create: `src/ui/foundation/PanelTabs.tsx`, `src/ui/foundation/TreeRow.tsx`, `src/ui/foundation/ResizeHandle.tsx`, `src/ui/foundation/panels.css`
- Test: `src/ui/foundation/panels.test.tsx`

**Interfaces:**
- Consumes: `cx`, `rovingIndex` (Task 7); lucide `X`, `ChevronRight`.
- Produces:
  - `interface PanelTabItem { id: string; title: string; icon: ReactNode; dirty?: boolean; preview?: boolean; live?: boolean; closable?: boolean }`, `PanelTabs({ label: string; tabs: ReadonlyArray<PanelTabItem>; selectedId: string | null; onSelect(id: string): void; onClose?(id: string): void })` - `role="tablist"`/`"tab"`, selection follows arrow focus, Delete/Backspace closes the selected closable tab, hover or focus swaps the icon for a close button.
  - `TreeRow({ label: string; depth: number; icon?; description?: string; expanded?: boolean; selected?: boolean; current?: boolean; trailing?: ReactNode; onActivate(): void; onToggle?(expanded: boolean): void })` - `role="treeitem"`, `aria-level = clamp(depth, 0, 64) + 1`, folders toggle on click/Enter/Space, ArrowRight expands, ArrowLeft collapses.
  - `type ResizeEdge = "start" | "end"`, `ResizeHandle({ label: string; value: number; min: number; max: number; edge: ResizeEdge; step?: number; onChange(value: number): void; onCommit?(value: number): void })` - `role="separator"`, pointer drag and keyboard resize, clamped.

- [ ] **Step 1: Write the failing test**

Create `src/ui/foundation/panels.test.tsx`:

```tsx
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { click, mountUi, pointer, press, type MountedUi } from "./foundationTestSupport";
import { PanelTabs, type PanelTabItem } from "./PanelTabs";
import { ResizeHandle } from "./ResizeHandle";
import { TreeRow } from "./TreeRow";

let ui: MountedUi | null = null;

afterEach(() => {
  ui?.unmount();
  ui = null;
});

function mount(node: Parameters<MountedUi["render"]>[0]): MountedUi {
  ui = mountUi();
  ui.render(node);
  return ui;
}

const TABS: readonly PanelTabItem[] = [
  { id: "diff", title: "Diff", icon: <svg />, closable: false },
  { id: "app.ts", title: "app.ts", icon: <svg />, dirty: true },
  { id: "readme", title: "README.md", icon: <svg />, preview: true },
  { id: "term", title: "Terminal", icon: <svg />, live: true },
];

describe("PanelTabs", () => {
  it("renders a labelled tablist with one selected tab stop", () => {
    const { host } = mount(
      <PanelTabs label="Right panel" onSelect={() => undefined} selectedId="app.ts" tabs={TABS} />,
    );
    const tabs = [...host.querySelectorAll<HTMLElement>('[role="tab"]')];

    expect(host.querySelector('[role="tablist"]')?.getAttribute("aria-label")).toBe("Right panel");
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual([
      "false",
      "true",
      "false",
      "false",
    ]);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0, -1, -1]);
    expect(tabs[1]?.querySelector('[aria-label="Unsaved changes"]')).not.toBeNull();
    expect(tabs[2]?.className).toContain("cv-tab--preview");
    expect(tabs[3]?.querySelector('[aria-label="Running"]')).not.toBeNull();
  });

  it("selects by click and by arrow keys, moving focus", () => {
    const onSelect = vi.fn();
    const { host } = mount(
      <PanelTabs label="Right panel" onSelect={onSelect} selectedId="term" tabs={TABS} />,
    );
    const tabs = () => [...host.querySelectorAll<HTMLElement>('[role="tab"]')];

    click(tabs()[2] as Element);
    press(tabs()[3] as Element, "ArrowRight");

    expect(onSelect.mock.calls.map((call) => call[0])).toEqual(["readme", "diff"]);
    expect(document.activeElement).toBe(tabs()[0]);
  });

  it("closes through the close button without selecting, and with Delete", () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    const { host } = mount(
      <PanelTabs
        label="Right panel"
        onClose={onClose}
        onSelect={onSelect}
        selectedId="readme"
        tabs={TABS}
      />,
    );

    click(host.querySelector('[aria-label="Close app.ts"]') as Element);
    press(host.querySelector('[role="tablist"]') as Element, "Delete");

    expect(onClose.mock.calls.map((call) => call[0])).toEqual(["app.ts", "readme"]);
    expect(onSelect).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-label="Close Diff"]')).toBeNull();
  });
});

describe("TreeRow", () => {
  it("exposes level, expansion and selection", () => {
    const { host } = mount(
      <TreeRow depth={2} expanded={false} label="src" onActivate={() => undefined} selected />,
    );
    const row = host.querySelector('[role="treeitem"]') as HTMLElement;

    expect(row.getAttribute("aria-level")).toBe("3");
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(row.getAttribute("aria-selected")).toBe("true");
    expect(row.tabIndex).toBe(0);
    expect(row.style.getPropertyValue("--cv-tree-depth")).toBe("2");
  });

  it("toggles folders by click and arrows and activates files with Enter", () => {
    const onToggle = vi.fn();
    const onActivate = vi.fn();
    const { host, render } = mount(
      <TreeRow depth={0} expanded={false} label="src" onActivate={onActivate} onToggle={onToggle} />,
    );
    const row = () => host.querySelector('[role="treeitem"]') as HTMLElement;

    click(row());
    press(row(), "ArrowRight");
    render(<TreeRow depth={0} expanded label="src" onActivate={onActivate} onToggle={onToggle} />);
    press(row(), "ArrowLeft");
    press(row(), "ArrowRight");
    render(<TreeRow depth={1} label="index.ts" onActivate={onActivate} />);
    press(row(), "Enter");
    click(row());

    expect(onToggle.mock.calls.map((call) => call[0])).toEqual([true, true, false]);
    expect(onActivate).toHaveBeenCalledTimes(2);
    expect(row().hasAttribute("aria-expanded")).toBe(false);
  });

  it("clamps absurd depths", () => {
    const { host, render } = mount(<TreeRow depth={-3} label="a" onActivate={() => undefined} />);
    expect(host.querySelector('[role="treeitem"]')?.getAttribute("aria-level")).toBe("1");

    render(<TreeRow depth={1000} label="a" onActivate={() => undefined} />);
    expect(host.querySelector('[role="treeitem"]')?.getAttribute("aria-level")).toBe("65");
  });
});

describe("ResizeHandle", () => {
  it("is a focusable vertical separator with its value range", () => {
    const { host } = mount(
      <ResizeHandle edge="start" label="Resize panel" max={900} min={320} onChange={() => undefined} value={540} />,
    );
    const handle = host.querySelector('[role="separator"]') as HTMLElement;

    expect(handle.getAttribute("aria-label")).toBe("Resize panel");
    expect(handle.getAttribute("aria-orientation")).toBe("vertical");
    expect(handle.getAttribute("aria-valuenow")).toBe("540");
    expect(handle.getAttribute("aria-valuemin")).toBe("320");
    expect(handle.getAttribute("aria-valuemax")).toBe("900");
    expect(handle.tabIndex).toBe(0);
  });

  it("resizes from the keyboard in the direction of the edge and clamps", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const { host } = mount(
      <ResizeHandle
        edge="start"
        label="Resize panel"
        max={560}
        min={320}
        onChange={onChange}
        onCommit={onCommit}
        value={540}
      />,
    );
    const handle = host.querySelector('[role="separator"]') as HTMLElement;

    press(handle, "ArrowLeft");
    press(handle, "ArrowRight");
    press(handle, "Home");
    press(handle, "End");

    expect(onChange.mock.calls.map((call) => call[0])).toEqual([556, 524, 320, 560]);
    expect(onCommit.mock.calls.map((call) => call[0])).toEqual([556, 524, 320, 560]);
  });

  it("follows a pointer drag and commits the last value on release", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const { host } = mount(
      <ResizeHandle
        edge="start"
        label="Resize panel"
        max={900}
        min={320}
        onChange={onChange}
        onCommit={onCommit}
        value={540}
      />,
    );
    const handle = host.querySelector('[role="separator"]') as HTMLElement;

    pointer(handle, "pointerdown", { clientX: 800 });
    expect(handle.className).toContain("cv-resize--active");
    pointer(handle, "pointermove", { clientX: 760 });
    pointer(handle, "pointermove", { clientX: 100 });
    pointer(handle, "pointerup", { clientX: 100 });

    expect(onChange.mock.calls.map((call) => call[0])).toEqual([580, 900]);
    expect(onCommit).toHaveBeenCalledWith(900);
    expect(handle.className).not.toContain("cv-resize--active");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/foundation/panels.test.tsx`
Expected: FAIL with unresolved `./PanelTabs`, `./TreeRow`, `./ResizeHandle`.

- [ ] **Step 3: Implement PanelTabs**

Create `src/ui/foundation/PanelTabs.tsx`:

```tsx
import { X } from "lucide-react";
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./classNames";
import { rovingIndex } from "./roving";
import "./panels.css";

export interface PanelTabItem {
  readonly id: string;
  readonly title: string;
  readonly icon: ReactNode;
  readonly dirty?: boolean;
  readonly preview?: boolean;
  readonly live?: boolean;
  readonly closable?: boolean;
}

export interface PanelTabsProps {
  readonly label: string;
  readonly tabs: ReadonlyArray<PanelTabItem>;
  readonly selectedId: string | null;
  onSelect(id: string): void;
  onClose?(id: string): void;
}

export function PanelTabs({ label, onClose, onSelect, selectedId, tabs }: PanelTabsProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const selectedIndex = tabs.findIndex((tab) => tab.id === selectedId);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Delete" || event.key === "Backspace") {
      const selected = tabs[selectedIndex];
      if (selected === undefined || onClose === undefined || selected.closable === false) return;
      event.preventDefault();
      onClose(selected.id);
      return;
    }
    const next = rovingIndex(event.key, selectedIndex, tabs.length, "horizontal");
    if (next === null) return;
    const tab = tabs[next];
    if (tab === undefined) return;
    event.preventDefault();
    onSelect(tab.id);
    listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  };

  return (
    <div
      aria-label={label}
      className="cv-tabs"
      onKeyDown={handleKeyDown}
      ref={listRef}
      role="tablist"
    >
      {tabs.map((tab, index) => {
        const selected = tab.id === selectedId;
        const tabbable = selected || (selectedIndex < 0 && index === 0);
        const closable = onClose !== undefined && tab.closable !== false;
        return (
          <div
            aria-selected={selected}
            className={cx(
              "cv-tab",
              tab.preview === true && "cv-tab--preview",
              closable && "cv-tab--closable",
            )}
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            role="tab"
            tabIndex={tabbable ? 0 : -1}
            title={tab.title}
          >
            <span className="cv-tab__icon">
              <span aria-hidden="true" className="cv-tab__glyph">
                {tab.icon}
              </span>
              {onClose === undefined || tab.closable === false ? null : (
                <button
                  aria-label={`Close ${tab.title}`}
                  className="cv-tab__close"
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose(tab.id);
                  }}
                  tabIndex={-1}
                  type="button"
                >
                  <X aria-hidden="true" size={12} />
                </button>
              )}
              {tab.dirty === true ? (
                <span aria-label="Unsaved changes" className="cv-tab__dirty" role="img" />
              ) : null}
              {tab.live === true ? (
                <span aria-label="Running" className="cv-tab__live" role="img" />
              ) : null}
            </span>
            <span className="cv-tab__title">{tab.title}</span>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Implement TreeRow**

Create `src/ui/foundation/TreeRow.tsx`:

```tsx
import { ChevronRight } from "lucide-react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import "./panels.css";

const MAX_DEPTH = 64;

export interface TreeRowProps {
  readonly label: string;
  readonly depth: number;
  readonly icon?: ReactNode;
  readonly description?: string;
  readonly expanded?: boolean;
  readonly selected?: boolean;
  readonly current?: boolean;
  readonly trailing?: ReactNode;
  onActivate(): void;
  onToggle?(expanded: boolean): void;
}

export function TreeRow({
  current = false,
  depth,
  description,
  expanded,
  icon,
  label,
  onActivate,
  onToggle,
  selected = false,
  trailing,
}: TreeRowProps) {
  const level = clampDepth(depth);
  const activate = (): void => {
    if (expanded === undefined || onToggle === undefined) {
      onActivate();
      return;
    }
    onToggle(!expanded);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate();
      return;
    }
    if (expanded === undefined || onToggle === undefined) return;
    if (event.key === "ArrowRight" && !expanded) {
      event.preventDefault();
      onToggle(true);
      return;
    }
    if (event.key === "ArrowLeft" && expanded) {
      event.preventDefault();
      onToggle(false);
    }
  };

  return (
    <div
      aria-current={current ? "true" : undefined}
      aria-expanded={expanded}
      aria-level={level + 1}
      aria-selected={selected}
      className="cv-tree-row"
      onClick={activate}
      onKeyDown={handleKeyDown}
      role="treeitem"
      style={{ "--cv-tree-depth": level } as CSSProperties}
      tabIndex={selected ? 0 : -1}
    >
      <span aria-hidden="true" className="cv-tree-row__chevron">
        {expanded === undefined ? null : <ChevronRight size={14} />}
      </span>
      {icon === undefined ? null : (
        <span aria-hidden="true" className="cv-tree-row__icon">
          {icon}
        </span>
      )}
      <span className="cv-tree-row__label">{label}</span>
      {description === undefined ? null : (
        <span className="cv-tree-row__description">{description}</span>
      )}
      {trailing === undefined ? null : <span className="cv-tree-row__trailing">{trailing}</span>}
    </div>
  );
}

function clampDepth(depth: number): number {
  if (!Number.isFinite(depth)) return 0;
  return Math.min(Math.max(Math.trunc(depth), 0), MAX_DEPTH);
}
```

- [ ] **Step 5: Implement ResizeHandle**

Create `src/ui/foundation/ResizeHandle.tsx`:

```tsx
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cx } from "./classNames";
import "./panels.css";

export type ResizeEdge = "start" | "end";

export interface ResizeHandleProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly edge: ResizeEdge;
  readonly step?: number;
  onChange(value: number): void;
  onCommit?(value: number): void;
}

interface DragState {
  readonly originX: number;
  readonly originValue: number;
  last: number;
}

const DIRECTION: Readonly<Record<ResizeEdge, number>> = { start: -1, end: 1 };

export function ResizeHandle({
  edge,
  label,
  max,
  min,
  onChange,
  onCommit,
  step = 16,
  value,
}: ResizeHandleProps) {
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);
  const direction = DIRECTION[edge];

  const apply = (next: number): number => {
    const clamped = clamp(next, min, max);
    onChange(clamped);
    return clamped;
  };
  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    const target = event.currentTarget;
    if (typeof target.setPointerCapture === "function") target.setPointerCapture(event.pointerId);
    dragRef.current = { originX: event.clientX, originValue: value, last: value };
    setDragging(true);
  };
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (drag === null) return;
    drag.last = apply(drag.originValue + (event.clientX - drag.originX) * direction);
  };
  const finishDrag = (): void => {
    const drag = dragRef.current;
    if (drag === null) return;
    dragRef.current = null;
    setDragging(false);
    onCommit?.(drag.last);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next = keyboardValue(event.key, value, min, max, step * direction * -1);
    if (next === null) return;
    event.preventDefault();
    onCommit?.(apply(next));
  };

  return (
    <div
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemax={max}
      aria-valuemin={min}
      aria-valuenow={value}
      className={cx("cv-resize", `cv-resize--${edge}`, dragging && "cv-resize--active")}
      onKeyDown={handleKeyDown}
      onPointerCancel={finishDrag}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      role="separator"
      tabIndex={0}
    />
  );
}

function keyboardValue(
  key: string,
  value: number,
  min: number,
  max: number,
  leftStep: number,
): number | null {
  if (key === "ArrowLeft") return value + leftStep;
  if (key === "ArrowRight") return value - leftStep;
  if (key === "Home") return min;
  if (key === "End") return max;
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
```

For `edge="start"` (a right panel whose handle sits on its left edge) moving the pointer or pressing ArrowLeft grows the panel; for `edge="end"` it shrinks. Trace of the keyboard test (value stays 540 because the parent does not re-render): ArrowLeft -> 556, ArrowRight -> 524, Home -> 320, End -> 560. Trace of the drag: origin 800 at 540, move to 760 -> 540 + 40 = 580, move to 100 -> 1240 clamped to 900, release commits 900.

- [ ] **Step 6: Style the panel parts**

Create `src/ui/foundation/panels.css`:

```css
.cv-tabs {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 4px;
  min-width: 0;
  height: 100%;
  overflow-x: auto;
  scrollbar-width: none;
}

.cv-tabs::-webkit-scrollbar {
  display: none;
}

.cv-tab {
  position: relative;
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 2px;
  max-width: 144px;
  height: 28px;
  padding: 0 10px 0 4px;
  border-radius: var(--cv-r-control);
  color: var(--cv-fg-subtle);
  font: var(--cv-t-xs) / 1 var(--cv-font-ui);
  cursor: pointer;
}

.cv-tab:hover {
  background: var(--cv-tint-1);
  color: var(--cv-fg-strong);
}

.cv-tab[aria-selected="true"] {
  background: var(--cv-tint-2);
  color: var(--cv-fg-strong);
  font-weight: 500;
}

.cv-tab:focus-visible,
.cv-tree-row:focus-visible {
  outline: 2px solid var(--cv-focus);
  outline-offset: -2px;
}

.cv-tab__icon {
  position: relative;
  display: grid;
  flex: none;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: var(--cv-r-sm);
}

.cv-tab__glyph {
  display: grid;
  place-items: center;
}

.cv-tab__close {
  position: absolute;
  inset: 0;
  display: none;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--cv-r-sm);
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.cv-tab--closable:hover .cv-tab__glyph,
.cv-tab--closable:focus-within .cv-tab__glyph {
  visibility: hidden;
}

.cv-tab--closable:hover .cv-tab__close,
.cv-tab--closable:focus-within .cv-tab__close {
  display: grid;
}

.cv-tab__close:hover {
  background: var(--cv-tint-2);
}

.cv-tab__dirty {
  position: absolute;
  right: 0;
  bottom: 1px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: var(--cv-ring-canvas);
}

.cv-tab__live {
  position: absolute;
  right: 2px;
  bottom: 3px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--cv-ok);
}

.cv-tab:hover .cv-tab__dirty,
.cv-tab:hover .cv-tab__live {
  display: none;
}

.cv-tab__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv-tab--preview .cv-tab__title {
  font-style: italic;
}

.cv-tree-row {
  --cv-tree-depth: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 26px;
  padding: 0 6px 0 calc(6px + var(--cv-tree-depth) * 12px);
  border-radius: var(--cv-r-sm);
  color: var(--cv-fg);
  font: var(--cv-t-xs) / 1 var(--cv-font-ui);
  white-space: nowrap;
  cursor: pointer;
}

.cv-tree-row:hover {
  background: var(--cv-tint-1);
  color: var(--cv-fg-strong);
}

.cv-tree-row[aria-selected="true"],
.cv-tree-row[aria-current="true"] {
  background: var(--cv-tint-2);
  color: var(--cv-fg-strong);
}

.cv-tree-row__chevron {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 14px;
  color: var(--cv-fg-subtle);
  transition: transform var(--cv-motion-base);
}

.cv-tree-row[aria-expanded="true"] .cv-tree-row__chevron {
  transform: rotate(90deg);
}

.cv-tree-row__icon {
  display: inline-grid;
  flex: none;
  place-items: center;
  color: var(--cv-fg-subtle);
}

.cv-tree-row__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cv-tree-row__description {
  min-width: 0;
  overflow: hidden;
  color: var(--cv-fg-subtle);
  text-overflow: ellipsis;
}

.cv-tree-row__trailing {
  display: flex;
  flex: none;
  gap: 6px;
  margin-left: auto;
}

.cv-resize {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 5;
  width: 6px;
  cursor: col-resize;
  touch-action: none;
}

.cv-resize--start {
  left: -3px;
}

.cv-resize--end {
  right: -3px;
}

.cv-resize::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 2px;
  width: 2px;
  background: transparent;
  transition: background-color var(--cv-motion-base);
}

.cv-resize:hover::after,
.cv-resize:focus-visible::after,
.cv-resize--active::after {
  background: var(--cv-accent);
}

.cv-resize:focus-visible {
  outline: none;
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/ui/foundation/panels.test.tsx src/ui/foundation/foundationStyles.test.ts src/components/cssBorderContract.test.ts src/domain/themeContrast.test.ts`
Expected: PASS (`themeContrast.test.ts` "limits undeclared theme tokens" sees `--cv-tree-depth` declared in `panels.css`).

- [ ] **Step 8: Format, type-check, lint**

Run: `npx prettier --write src/ui/foundation/PanelTabs.tsx src/ui/foundation/TreeRow.tsx src/ui/foundation/ResizeHandle.tsx src/ui/foundation/panels.test.tsx && npx tsc --noEmit && npm run lint -- --max-warnings 0`
Expected: exit 0.

- [ ] **Step 9: Hand off (no commit)**

---

### Task 13: Status and feedback (StatusLabel, RoleTag, ComposerBanner, Toast)

**Files:**
- Create: `src/ui/foundation/StatusLabel.tsx`, `src/ui/foundation/RoleTag.tsx`, `src/ui/foundation/ComposerBanner.tsx`, `src/ui/foundation/Toast.tsx`
- Modify: `src/ui/foundation/status.css` (append)
- Test: `src/ui/foundation/status.test.tsx`

**Interfaces:**
- Consumes: `Spinner`, `useLatest` (Task 7); `Button`, `IconButton` (Task 8); lucide `Check`, `Info`, `TriangleAlert`, `X`.
- Produces:
  - `type StatusKind = "work" | "warn" | "ok" | "fail"`, `StatusLabel({ kind; spinner?: boolean; children })`
  - `RoleTag({ children: string })`
  - `type ComposerBannerTone = "neutral" | "working" | "warn"`, `ComposerBanner({ tone?; icon?; actions?; children })` (`role="status"`)
  - `type ToastTone = "info" | "success" | "error"`, `interface ToastAction { label: string; onSelect(): void }`, `Toast({ message: string; tone?; action?: ToastAction; durationMs?: number; onDismiss(): void })` (auto-dismiss, `0` keeps it), `ToastViewport({ children })` (`role="region"`, label "Notifications")

- [ ] **Step 1: Write the failing test**

Create `src/ui/foundation/status.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposerBanner } from "./ComposerBanner";
import { click, mountUi, type MountedUi } from "./foundationTestSupport";
import { RoleTag } from "./RoleTag";
import { StatusLabel } from "./StatusLabel";
import { Toast, ToastViewport } from "./Toast";

let ui: MountedUi | null = null;

afterEach(() => {
  ui?.unmount();
  ui = null;
  vi.useRealTimers();
});

function mount(node: Parameters<MountedUi["render"]>[0]): MountedUi {
  ui = mountUi();
  ui.render(node);
  return ui;
}

describe("StatusLabel and RoleTag", () => {
  it("colours the status by kind and can show a spinner", () => {
    const { host, render } = mount(<StatusLabel kind="fail">Failed</StatusLabel>);
    expect(host.querySelector(".cv-status")?.className).toBe("cv-status cv-status--fail");
    expect(host.querySelector(".cv-spinner")).toBeNull();

    render(
      <StatusLabel kind="work" spinner>
        Working 12s
      </StatusLabel>,
    );
    expect(host.querySelector(".cv-status--work .cv-spinner")).not.toBeNull();
    expect(host.textContent).toBe("Working 12s");
  });

  it("shows the full role on hover", () => {
    const { host } = mount(<RoleTag>code-reviewer-with-a-long-name</RoleTag>);

    expect(host.querySelector(".cv-role")?.getAttribute("title")).toBe(
      "code-reviewer-with-a-long-name",
    );
  });
});

describe("ComposerBanner", () => {
  it("announces its message politely with tone, icon and actions", () => {
    const { host, render } = mount(
      <ComposerBanner actions={<button type="button">Cancel</button>} icon={<svg />} tone="warn">
        Cloning repository
      </ComposerBanner>,
    );
    const banner = host.querySelector('[role="status"]');

    expect(banner?.getAttribute("aria-live")).toBe("polite");
    expect(banner?.className).toBe("cv-composer-banner cv-composer-banner--warn");
    expect(banner?.querySelector(".cv-composer-banner__icon")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(banner?.querySelector(".cv-composer-banner__actions button")?.textContent).toBe(
      "Cancel",
    );

    render(<ComposerBanner tone="working">Waiting for 2 agents</ComposerBanner>);
    expect(host.querySelector(".cv-composer-banner--working .cv-spinner")).not.toBeNull();
  });
});

describe("Toast", () => {
  it("uses status for information and alert for errors inside a labelled viewport", () => {
    const { host, render } = mount(
      <ToastViewport>
        <Toast durationMs={0} message="Copied" onDismiss={() => undefined} />
      </ToastViewport>,
    );
    expect(host.querySelector('[role="region"]')?.getAttribute("aria-label")).toBe("Notifications");
    expect(host.querySelector(".cv-toast")?.getAttribute("role")).toBe("status");

    render(<Toast durationMs={0} message="Push failed" onDismiss={() => undefined} tone="error" />);
    expect(host.querySelector(".cv-toast")?.getAttribute("role")).toBe("alert");
  });

  it("dismisses itself after its duration and clears the timer on unmount", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { render } = mount(<Toast durationMs={4000} message="Saved" onDismiss={onDismiss} />);

    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);

    render(<Toast durationMs={4000} key="second" message="Saved again" onDismiss={onDismiss} />);
    render(null);
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("stays until dismissed when the duration is zero and runs its action", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const onSelect = vi.fn();
    const { host } = mount(
      <Toast
        action={{ label: "Undo", onSelect }}
        durationMs={0}
        message="Thread archived"
        onDismiss={onDismiss}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(60000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    click([...host.querySelectorAll("button")].find((button) => button.textContent === "Undo") as Element);
    click(host.querySelector('[aria-label="Dismiss"]') as Element);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/foundation/status.test.tsx`
Expected: FAIL with unresolved component imports.

- [ ] **Step 3: Implement the components**

Create `src/ui/foundation/StatusLabel.tsx`:

```tsx
import type { ReactNode } from "react";
import { Spinner } from "./Spinner";
import "./status.css";

export type StatusKind = "work" | "warn" | "ok" | "fail";

export interface StatusLabelProps {
  readonly kind: StatusKind;
  readonly spinner?: boolean;
  readonly children: ReactNode;
}

export function StatusLabel({ children, kind, spinner = false }: StatusLabelProps) {
  return (
    <span className={`cv-status cv-status--${kind}`}>
      {spinner ? <Spinner /> : null}
      {children}
    </span>
  );
}
```

Create `src/ui/foundation/RoleTag.tsx`:

```tsx
import "./status.css";

export interface RoleTagProps {
  readonly children: string;
}

export function RoleTag({ children }: RoleTagProps) {
  return (
    <span className="cv-role" title={children}>
      {children}
    </span>
  );
}
```

Create `src/ui/foundation/ComposerBanner.tsx`:

```tsx
import type { ReactNode } from "react";
import { Spinner } from "./Spinner";
import "./status.css";

export type ComposerBannerTone = "neutral" | "working" | "warn";

export interface ComposerBannerProps {
  readonly tone?: ComposerBannerTone;
  readonly icon?: ReactNode;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}

export function ComposerBanner({ actions, children, icon, tone = "neutral" }: ComposerBannerProps) {
  return (
    <div
      aria-live="polite"
      className={`cv-composer-banner cv-composer-banner--${tone}`}
      role="status"
    >
      {leadingVisual(tone, icon)}
      <span className="cv-composer-banner__message">{children}</span>
      {actions === undefined ? null : (
        <span className="cv-composer-banner__actions">{actions}</span>
      )}
    </div>
  );
}

function leadingVisual(tone: ComposerBannerTone, icon: ReactNode): ReactNode {
  if (tone === "working") return <Spinner />;
  if (icon === undefined) return null;
  return (
    <span aria-hidden="true" className="cv-composer-banner__icon">
      {icon}
    </span>
  );
}
```

Create `src/ui/foundation/Toast.tsx`:

```tsx
import { Check, Info, TriangleAlert, X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { useLatest } from "./useLatest";
import "./status.css";

export type ToastTone = "info" | "success" | "error";

export interface ToastAction {
  readonly label: string;
  onSelect(): void;
}

export interface ToastProps {
  readonly message: string;
  readonly tone?: ToastTone;
  readonly action?: ToastAction;
  readonly durationMs?: number;
  onDismiss(): void;
}

const TONE_ICONS: Readonly<Record<ToastTone, ReactNode>> = {
  info: <Info size={14} />,
  success: <Check size={14} />,
  error: <TriangleAlert size={14} />,
};

export function Toast({ action, durationMs = 4000, message, onDismiss, tone = "info" }: ToastProps) {
  const onDismissRef = useLatest(onDismiss);
  useEffect(() => {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return;
    const timer = window.setTimeout(() => onDismissRef.current(), durationMs);
    return () => window.clearTimeout(timer);
  }, [durationMs, onDismissRef]);

  return (
    <div className={`cv-toast cv-toast--${tone}`} role={tone === "error" ? "alert" : "status"}>
      <span aria-hidden="true" className="cv-toast__icon">
        {TONE_ICONS[tone]}
      </span>
      <span className="cv-toast__message">{message}</span>
      {action === undefined ? null : (
        <Button onClick={action.onSelect} size="sm" variant="ghost">
          {action.label}
        </Button>
      )}
      <IconButton icon={<X size={14} />} label="Dismiss" onClick={onDismiss} size="xs" />
    </div>
  );
}

export interface ToastViewportProps {
  readonly children: ReactNode;
}

export function ToastViewport({ children }: ToastViewportProps) {
  return (
    <div aria-label="Notifications" className="cv-toast-viewport" role="region">
      {children}
    </div>
  );
}
```

Append to `src/ui/foundation/status.css`:

```css
.cv-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.cv-status--work {
  color: var(--cv-accent);
}

.cv-status--warn {
  color: var(--cv-warn);
}

.cv-status--ok {
  color: var(--cv-ok);
}

.cv-status--fail {
  color: var(--cv-danger);
}

.cv-role {
  flex: none;
  max-width: 112px;
  padding: 0 4px;
  overflow: hidden;
  border-radius: var(--cv-r-xs);
  box-shadow: var(--cv-ring-hair-strong);
  color: var(--cv-fg-subtle);
  font: 10.5px / 16px var(--cv-font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv-composer-banner {
  position: relative;
  z-index: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 22px -16px;
  padding: 6px 8px 22px 12px;
  border-radius: 16px 16px 0 0;
  background: var(--cv-raised);
  box-shadow: var(--cv-ring-hair);
  color: var(--cv-fg-muted);
  font: var(--cv-t-xs) / var(--cv-lh-xs) var(--cv-font-ui);
}

.cv-composer-banner__icon {
  display: inline-grid;
  flex: none;
  place-items: center;
}

.cv-composer-banner--warn .cv-composer-banner__icon {
  color: var(--cv-warn);
}

.cv-composer-banner--working .cv-spinner {
  color: var(--cv-accent);
}

.cv-composer-banner__message {
  flex: 1;
  min-width: 0;
}

.cv-composer-banner__actions {
  display: flex;
  gap: 2px;
  margin-left: auto;
}

.cv-toast-viewport {
  position: fixed;
  bottom: 24px;
  left: 50%;
  z-index: var(--cv-z-toast);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  transform: translateX(-50%);
  pointer-events: none;
}

.cv-toast {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 6px 0 14px;
  border-radius: var(--cv-r-card);
  background: var(--cv-popover);
  box-shadow: var(--cv-shadow-toast);
  color: var(--cv-fg-strong);
  font: 500 var(--cv-t-xs) / var(--cv-lh-xs) var(--cv-font-ui);
  pointer-events: auto;
  animation: cv-fade-in var(--cv-motion-base) var(--cv-ease);
}

@keyframes cv-fade-in {
  from {
    opacity: 0;
  }
}

.cv-toast__icon {
  display: inline-grid;
  place-items: center;
  color: var(--cv-fg-subtle);
}

.cv-toast--success .cv-toast__icon {
  color: var(--cv-ok);
}

.cv-toast--error .cv-toast__icon {
  color: var(--cv-danger);
}

.cv-toast__message {
  min-width: 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui/foundation src/components/cssBorderContract.test.ts src/domain/themeContrast.test.ts`
Expected: PASS (whole foundation suite).

- [ ] **Step 5: Format, type-check, lint**

Run: `npx prettier --write src/ui/foundation/StatusLabel.tsx src/ui/foundation/RoleTag.tsx src/ui/foundation/ComposerBanner.tsx src/ui/foundation/Toast.tsx src/ui/foundation/status.test.tsx && npx tsc --noEmit && npm run lint -- --max-warnings 0 && npm run lint:exhaustive-deps`
Expected: exit 0.

- [ ] **Step 6: Hand off (no commit)**

---

### Task 14: Full repository gates (lead)

**Files:** none (verification only).

**Interfaces:** consumes the finished Tasks 1-13.

- [ ] **Step 1: Free the Node inspector port before the suite**

Run: `lsof -ti tcp:9229 | xargs -r kill`
Expected: exit 0 (an orphaned `node --inspect` from an earlier run otherwise makes the Node watch tests fail; repo memory "Node watch tests and port 9229").

- [ ] **Step 2: Run the TypeScript gates one by one and check each exit code**

Run each command on its own line and confirm `echo $?` prints `0` after each (never judge a gate through `| tail`):

```bash
npm run check
npm run lint -- --max-warnings 0
npm run lint:exhaustive-deps
npm run build
npm run size:hotspots
npm run format:check
npm run format:check:changed
npm test -- --run
```

Expected: every command exits 0. `npm run build` also runs the initial bundle budget (500 KiB per initial asset). If `npm test -- --run` fails only in Node watch/debug tests, free port 9229 again and rerun just those files sequentially before treating it as a regression.

- [ ] **Step 3: Run the Rust gates (unchanged code, still required)**

```bash
cd src-tauri
cargo check --all-targets
cargo test --lib
cargo test --tests
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cd ..
```

Expected: every command exits 0.

- [ ] **Step 4: Whitespace and scope check**

Run: `git diff --check && git status --porcelain`
Expected: `git diff --check` prints nothing. `git status` lists only the P1 files from the File Structure table plus the pre-existing untracked `docs/redesign/`, `docs/superpowers/specs/2026-09-23-codevo-redesign-design.md` and other phase plans such as `docs/superpowers/plans/2026-09-24-redesign-p0-deferred-bugs.md` (not part of the P1 commits), and any P0 changes if P0 runs in parallel (commit those separately, never inside the P1 commits).

- [ ] **Step 5: Coverage (the changed surface is covered by the coverage workflow)**

Run: `npm run test:coverage`
Expected: exit 0 (thresholds lines/functions/statements 45, branches 35).

---

### Task 15: Independent read-only review (Opus 5.5)

**Files:** none.

- [ ] **Step 1: Dispatch the reviewer**

Dispatch a fresh general-purpose agent with `model: "opus"` and this prompt (the reviewer must not edit files or run mutating git commands):

```text
You are an independent, read-only reviewer for phase P1 of the Codevo redesign in /Users/matusmockor/Developer/editor. Do not edit files, do not run git commands that change state, do not run coderabbit. Read CLAUDE.md, the spec docs/superpowers/specs/2026-09-23-codevo-redesign-design.md (sections 3.1.1-3.1.2, 4, 6, 7) and the plan docs/superpowers/plans/2026-09-24-redesign-p1-foundation.md, then review the working-tree diff (`git diff` and the untracked files under src/ui, src/domain, src/infrastructure, src/components).

Report findings as P0 (wrong behaviour or data loss), P1 (spec or CLAUDE.md violation, missing test for a risky path), P2 (quality). For each: file:line, what is wrong, a concrete failing scenario, the fix. Verify every claim in code before reporting it.

Focus on:
1. Settings migration: legacy `theme` values, partial or hostile `appearance` JSON (prototype keys, wrong types, arrays), startup vs runtime agreeing on the same palette and scheme, no flash between the startup skeleton and React.
2. System scheme: live OS light/dark flips update <html data-cv-*>, .app-shell[data-theme], Monaco and the terminal without reload.
3. Legacy bridge: every --color-*/--change-* the legacy surfaces read resolves to a --cv-* token in all 12 combinations; specificity really beats every .app-shell[data-theme=...] block; nothing in agent mode lost contrast; portals outside .app-shell still get tokens.
4. Monaco: Match palette themes registered before first use, the immediate fallback picks vs/vs-dark correctly for palette and classic ids, classic syntax themes still selectable and unchanged.
5. Foundation components: roles, aria attributes, keyboard support, focus trap and focus restoration (menus, submenus, dialogs, popovers), Escape/Tab/outside-pointer behaviour, no business logic, files small, no colour literals, motion only through tokens, prefers-reduced-motion honoured.
6. Contrast gate: it truly fails CI under 4.5 and covers all text/surface pairs claimed; list any user-visible pair it does not cover.
7. Hotspots: App.tsx did not grow; no new file near the size limits.
8. Anything in the diff that contradicts the plan or the spec.

End with a verdict: SHIP, SHIP AFTER FIXES (list), or DO NOT SHIP.
```

- [ ] **Step 2: Triage**

Verify every P0/P1 finding in the code before acting (repo memory: audits over-report). Fix the real ones through a new implementer task scoped to the affected files, rerun the focused tests and Task 14, and re-dispatch the reviewer on the fix diff. Record rejected findings with a one-line reason in the final report.

---

### Task 16: QA build and Codex computer-use QA

**Files:** `~/tmp/codevo-qa/qa_prompt_p1.txt`, `~/tmp/codevo-qa/qa_prompt_p1_restart.txt` (scratch, deleted at the end).

- [ ] **Step 1: Build the QA bundle**

Run: `npx tauri build --debug --bundles app --config '{"identifier":"dev.mockor.editor.qa","productName":"Codevo QA"}'`
Expected: `src-tauri/target/debug/bundle/macos/Codevo QA.app` exists. Exit code 1 caused only by the missing updater signing key is acceptable; any compile error is not.

- [ ] **Step 2: Start the QA app in the user's GUI session**

Run: `open "src-tauri/target/debug/bundle/macos/Codevo QA.app"`
Expected: a window titled "Codevo QA" opens. Do not use `npm run debug`.

- [ ] **Step 3: Write the QA prompt**

```bash
mkdir -p ~/tmp/codevo-qa && cat > ~/tmp/codevo-qa/qa_prompt_p1.txt <<'QA'
You are a UI QA tester with Computer Use. First action: take a screenshot. If Computer Use is unavailable, reply only COMPUTER_USE_UNAVAILABLE and stop.

Scope and rules:
- Work ONLY in the already running app window "Codevo QA" (bundle id dev.mockor.editor.qa). Never interact with "Codevo Editor" or any other app.
- Do not build, launch, quit or restart any app. Do not edit files. Do not run shell commands except for saving screenshots.
- Do not change macOS system settings.

Steps (record worked/failed and a screenshot path for every step):
1. Open Settings (Cmd+,) and go to Appearance. Confirm three rows: "Palette" with six swatches named Graphite · Teal, Slate · Blue, Black · Violet, Ink · Mint, Zinc · Orange, Carbon · Lime; "Appearance" with System / Dark / Light; "Syntax theme" whose value is "Match palette".
2. For each palette in that order, first with Dark then with Light (12 combinations): select it, close Settings, take a screenshot of the whole window and judge readability: sidebar and thread text, composer placeholder and text, buttons, menus, status bar text, tree rows, tabs. Report any text that is hard to read, any surface that merges with its neighbour, any white-on-light or dark-on-dark text, any leftover colours from the old theme.
3. With Graphite · Teal Dark and then Zinc · Orange Light: open any .ts file in the editor. Confirm the editor background matches the app canvas tone and keywords/strings/comments change colour when the palette changes. Open the completion list (type a few letters) and a hover; confirm they are readable.
4. Set Appearance to Light and Syntax theme to Dracula: the chrome stays light while the editor uses Dracula colours. Set Syntax theme back to Match palette: the editor follows the palette again.
5. Keyboard: in Settings focus a palette swatch, press ArrowRight, ArrowLeft, Home, End and confirm the selection moves and the app recolours; Tab to the Appearance segmented control and change it with the arrow keys.
6. Agent mode regression in Graphite · Teal Dark and Carbon · Lime Light: open agent mode, the thread list, an existing thread and the composer. Confirm messages, tool rows, the send button, status labels, the right panel (diff/files) and any open menu or dialog are readable and laid out as before (no missing separators, no overlapping panels, no clipped text).
7. Terminal: open a terminal panel in Ink · Mint Dark; confirm the terminal background matches the canvas and prompt text is readable.
8. Finish by selecting Ink · Mint with Light and leaving Settings closed.

Final report format:
- One line per step: "Step N: worked" or "Step N: failed - <what you saw>".
- A table of the 12 palette/scheme combinations with pass/fail and the screenshot path.
- A list of every unreadable or inconsistent element with palette, scheme and location.
QA
```

- [ ] **Step 4: Run the tester and wait for the report**

Run (background, 45 minute cap inside the orchestrator): `python3 ~/tmp/codevo-qa/qa_orchestrator_v2.py ~/tmp/codevo-qa/qa_prompt_p1.txt > /tmp/qa-p1.log 2>&1`
Expected: the log ends with the tester's report. If the run is blocked by the permission classifier (the tester auto-accepts approvals), ask the user to run the same command with the `!` prefix, or to paste `~/tmp/codevo-qa/qa_prompt_p1.txt` into their own Codex desktop thread and paste the report back. Watch only final or error lines (`COMPUTER_USE_UNAVAILABLE`, `TIMEOUT`, `ERROR`, the final agent message).

- [ ] **Step 5: Persistence check after a restart**

Run: `osascript -e 'quit app "Codevo QA"' && sleep 2 && open "src-tauri/target/debug/bundle/macos/Codevo QA.app"`, then write and run a short second prompt:

```bash
cat > ~/tmp/codevo-qa/qa_prompt_p1_restart.txt <<'QA'
You are a UI QA tester with Computer Use. First action: take a screenshot. If Computer Use is unavailable, reply only COMPUTER_USE_UNAVAILABLE and stop. Work only in the running "Codevo QA" window; do not launch, quit or edit anything.
1. Confirm the app shows the Ink · Mint palette in Light (light surfaces, mint-green accent) without a dark flash visible in your first screenshot.
2. Open Settings > Appearance and confirm Palette = Ink · Mint, Appearance = Light, Syntax theme = Match palette.
3. Set Palette back to Graphite · Teal and Appearance to Dark, close Settings.
Report each step as worked/failed with a screenshot path.
QA
python3 ~/tmp/codevo-qa/qa_orchestrator_v2.py ~/tmp/codevo-qa/qa_prompt_p1_restart.txt > /tmp/qa-p1-restart.log 2>&1
```

Expected: all three steps "worked".

- [ ] **Step 6: Fix loop**

For each QA failure: confirm the root cause in code, fix it through a scoped implementer task, rerun the focused tests, Task 14 and a reviewer pass on the fix, rebuild the QA app and re-run only the failed QA steps.

- [ ] **Step 7: Clean up**

Run: `osascript -e 'quit app "Codevo QA"'; rm -f /tmp/qa-p1.log /tmp/qa-p1-restart.log ~/tmp/codevo-qa/qa_prompt_p1.txt ~/tmp/codevo-qa/qa_prompt_p1_restart.txt`
Expected: exit 0.

---

### Task 17: Commit to `main` (lead, after explicit owner authorization)

**Files:** all P1 files.

- [ ] **Step 1: Confirm the tree**

Run: `git branch --show-current && git status --porcelain && git log --oneline -5`
Expected: branch `main`; only P1 files changed plus the owner's untracked `docs/redesign/` and spec. Check for foreign hunks from a concurrent Codex session (repo memory) before staging; stage nothing that is not P1.

- [ ] **Step 2: Commit the token, appearance and bridge slice**

```bash
git add -A -- src/domain src/infrastructure src/ui/tokens src/components src/application src/App.tsx src/App.css src/startupTheme.ts src/startupTheme.test.ts src/startupDocument.test.ts public/startup.css src-tauri/tauri.conf.json src-tauri/tauri.macos.conf.json scripts/hotspot-size-baseline.json docs/superpowers/plans/2026-09-24-redesign-p1-foundation.md
git diff --cached --stat
git commit -F - <<'MSG'
feat(appearance): palette tokens, appearance setting and legacy token bridge

- Six palettes (Graphite · Teal default, Slate · Blue, Black · Violet, Ink · Mint,
  Zinc · Orange, Carbon · Lime), each dark and light, as --cv-* tokens with a
  WCAG AA contrast gate over all 12 combinations
- Appearance setting: palette, System/Dark/Light and syntax theme with
  "Match palette" as default; classic editor themes stay selectable
- Palette-driven Monaco and terminal themes, startup skeleton per palette
- Temporary bridge maps legacy --color-*/--change-* tokens onto the palette
- Retire the agent appearance variants
MSG
```

Expected: one commit; `git diff --cached --stat` before it lists no file under `src/ui/foundation/` and nothing under `docs/redesign/`.

- [ ] **Step 3: Commit the foundation components**

```bash
git add -A -- src/ui/foundation
git diff --cached --stat
git commit -F - <<'MSG'
feat(ui): foundation components

Button, IconButton, SubmitButton, Menu with Submenu, Popover, Dialog, Kbd,
Switch, Checkbox, SegmentedControl, Stepper, TextField, TextArea, PanelTabs,
TreeRow, ResizeHandle, StatusLabel, RoleTag, ComposerBanner and Toast, styled
only through --cv-* tokens, with keyboard and focus handling and tests.
MSG
git status --porcelain
```

Expected: the second commit contains only `src/ui/foundation/*`; the final `git status` shows only the owner's untracked redesign docs. No push, no tag, no release (single release in P10).

---

## Open Questions for the Owner

1. Default appearance for fresh installs: this plan keeps `colorScheme: "dark"` (today's default, and existing users who never touched the theme have `"dark"` persisted). Should new installs default to `"system"` like t3code?
2. "Match palette" syntax mapping: the mockups define only keyword/string/number/comment colours. The plan maps functions to `accent`, types to `warn`, and variables/properties to `fg` (all AA-checked). Approve, or provide per-palette function/type colours?
3. Hover and active tints (`tint-3` over `s0`/`pop-bg`) drop text contrast to 4.01-4.29 in some combinations (lowest: Slate · Blue light, `warn` on `tint-3` over `s0`). The P1 gate covers solid surfaces only. Accept for hover/active states, or tune the tints in P2?
4. Command list (spec §3.1.2 base component) is not in this P1 component list; the plan leaves it to P5 (command palette) where its behaviour is defined. OK?
5. Commit `docs/redesign/` and the spec together with P1, or keep them untracked?
6. The native Tauri window background becomes `#151616` (Graphite · Teal dark side, pinned by `startupDocument.test.ts`); a Light palette may still show a dark frame for a few milliseconds before `startup.css` paints. Address in P2 (window chrome, e.g. set the native background from the persisted scheme) or accept?

## Self-Review

**Spec coverage.**
- §3.1.1 one token module (surfaces s0-s4, text levels, borders/hairlines, accent/on-accent, success/danger/warning, focus, selection, syntax, diff, shadows, radius, type scale, spacing, motion): Task 2 (`palettes.css`, `semantic.css`). `agentModeVariants.css` retired in Task 6; `agentModeTokens.css` and ad-hoc App.css colours are bridged (Task 6) and removed surface by surface through P10, per §4.
- 6 palettes x dark/light from the mockup, all text pairs AA: Task 2 generator + sync test + contrast gate.
- Appearance setting (palette, System/Dark/Light, syntax theme default "Match palette", classic themes selectable): Tasks 1, 3, 5.
- `prefers-reduced-motion`: Task 2 (motion tokens zeroed), Task 7 (spinner stopped, motion-token-only rule enforced for every foundation sheet).
- §3.1.2 base components: icon button, button sizes, round submit/stop (Task 8); menu/popover + submenu, dialog (Task 11); kbd, switch, checkbox, segmented control, stepper (Task 9); input/textarea/field hint (Task 10); panel tabs with hover-close, tree row, resize handle (Task 12); status label, role tag, composer banner, toast (Task 13). Command list deferred to P5 (Open Question 4).
- §4 placement in `src/ui/`, presentation-only, no Rust change, hotspots flat: Global Constraints, Task 5 Step 8, Task 14.
- §6 component tests with `act`, scripted AA contrast checks, keyboard navigation for menus/dialogs/pickers, visible focus rings (`:focus-visible` outlines, ring tokens), full gates, QA build with bundle id `dev.mockor.editor.qa` in palette 1 dark+light and other palettes: Tasks 2, 7-13, 14, 16.
- §7 Opus reviewer, Codex computer-use QA, no per-phase release: Tasks 15-17.

**Placeholder scan.** No "TBD"/"TODO"/"similar to". The palette data is produced by a deterministic generator from the approved mockup (Task 2 Step 4) and pinned by spot values; the ten classic terminal literals are reproduced in full (Task 3 Step 4).

**Type consistency.** `PaletteId`, `ResolvedColorScheme`, `AppearanceSettings`, `DEFAULT_APPEARANCE`, `PALETTE_ATTRIBUTE`, `COLOR_SCHEME_ATTRIBUTE` (Task 1) are used unchanged in Tasks 2-6; `paletteTokens` / `surfaceColor` / `cssTokenName` / `SCHEME_SURFACE_ROLES` (Task 2) in Tasks 3-5; `MonacoAppTheme`, `TerminalTheme`, `resolveEditorColorThemes`, `classicTerminalTheme` (Task 3) in Task 5; `resolveStartupAppearance` (Task 4); `cx`, `rovingIndex`, `PopoverPlacement`, `usePopoverPosition`, `useDismiss`, `useRestoreFocus`, `focusableWithin`, `trapTabKey`, `mountUi`, `press`, `click`, `pointer` (Task 7) in Tasks 8-13; `Button`/`IconButton` (Task 8) in Task 13.

**Dry run.** While writing this plan, Tasks 1-13 were applied mechanically to a scratch copy of the repository (outside the repo, no git changes): `npm run check`, `eslint src --max-warnings 0`, the exhaustive-deps budget and the full vitest suite (1855 files, 29135 tests) passed; `size:hotspots` reported only the expected reduction `src/App.tsx: 7199 -> 7188` structural tokens. The dry run surfaced and the plan now includes: the Tauri `backgroundColor` pin, the Dark Plus terminal exclusion, the `--agent-warm` dangling reference, the cast App test fixtures, five terminal test fixtures, `settingsSearch.test.ts`, and the `var(--` token-scan pitfall. `npm run build`, `format:check:changed`, Rust gates and the QA run were not part of the dry run.

**Review Focus.** Each of the five lines has a pinning test: legacy/hostile settings (Task 1 `normalizeAppearance` prototype and legacy tests, Task 4 `readPersistedAppearance`), live system flip (Task 5 `useAppWorkbenchThemes` rerender test, Task 4 System stamping), focus restoration and submenu Escape (Task 7 `useRestoreFocus`, Task 11 menu/dialog/popover tests), popover edge/oversize (Task 7 `computePopoverPosition`), classic-vs-scheme Monaco fallback (Task 3 `applyImmediateFallbackTheme` palette cases and `resolveEditorColorThemes` classic case).
