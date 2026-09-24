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
