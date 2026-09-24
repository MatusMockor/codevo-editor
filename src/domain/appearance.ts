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
  colorScheme: "system",
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
