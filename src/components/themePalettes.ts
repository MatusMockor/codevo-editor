export interface ThemePalette {
  name: string;
  base: "vs" | "vs-dark";
  bg: string;
  fg: string;
  lineHighlight: string;
  selection: string;
  cursor: string;
  lineNumber: string;
  lineNumberActive: string;
  whitespace: string;
  widgetBg: string;
  border: string;
  selectedBg: string;
  selectedFg: string;
  accent: string;
  inputBg: string;
  diffInserted: string;
  diffRemoved: string;
  keyword: string;
  func: string;
  type: string;
  string: string;
  number: string;
  variable: string;
  parameter: string;
  property: string;
  constant: string;
  operator: string;
  comment: string;
  commentItalic: boolean;
  keywordItalic?: boolean;
  namespace: string;
  regexp: string;
  decorator: string;
}

export const calmDark: ThemePalette = {
  name: "calm-dark",
  base: "vs-dark",
  bg: "#16181d",
  fg: "#c2c8d2",
  lineHighlight: "#1d2026",
  selection: "#28323d",
  cursor: "#8aa9c9",
  lineNumber: "#5e6573",
  lineNumberActive: "#c2c8d2",
  whitespace: "#2c303a",
  widgetBg: "#1b1e24",
  border: "#2c303a",
  selectedBg: "#23303a",
  selectedFg: "#eef1f5",
  accent: "#8aa9c9",
  inputBg: "#16181d",
  diffInserted: "#8fbcae22",
  diffRemoved: "#d98b8b22",
  keyword: "#b48ead",
  func: "#dcc188",
  type: "#7fb9b0",
  string: "#8fbcae",
  number: "#d29a6e",
  variable: "#c2c8d2",
  parameter: "#c9b39a",
  property: "#a7c0d8",
  constant: "#d2a96e",
  operator: "#8b94a3",
  comment: "#6e7787",
  commentItalic: true,
  namespace: "#7fb9b0",
  regexp: "#8fbcae",
  decorator: "#cfa6c8",
};

export const calmLight: ThemePalette = {
  name: "calm-light",
  base: "vs",
  bg: "#f5f7f9",
  fg: "#3a4654",
  lineHighlight: "#eef1f4",
  selection: "#d3e1e7",
  cursor: "#3d7c8a",
  lineNumber: "#9aa7b6",
  lineNumberActive: "#3a4654",
  whitespace: "#cfd6de",
  widgetBg: "#ffffff",
  border: "#e2e7ec",
  selectedBg: "#dbe8ed",
  selectedFg: "#1b2733",
  accent: "#3d7c8a",
  inputBg: "#ffffff",
  diffInserted: "#2a7d6f22",
  diffRemoved: "#b0565622",
  keyword: "#8a5c8f",
  func: "#946a14",
  type: "#2f7d86",
  string: "#2a7d6f",
  number: "#b05a2a",
  variable: "#3a4654",
  parameter: "#6a5a3a",
  property: "#2f5f78",
  constant: "#b05a2a",
  operator: "#5d6b7a",
  comment: "#6b7787",
  commentItalic: true,
  namespace: "#2f7d86",
  regexp: "#2a7d6f",
  decorator: "#8a5c8f",
};

// Ayu Mirage is no longer a custom palette: the editor uses Shiki's bundled
// official "ayu-mirage" theme (imported directly in shikiHighlighter.ts) so the
// syntax colors match VS Code's Ayu Mirage 1:1. The terminal palette for this
// theme is defined independently in domain/settings.ts (terminalThemeForAppTheme),
// and the chrome lives in App.css ([data-theme="ayuMirage"]).

export const materialDeepOcean: ThemePalette = {
  name: "material-deep-ocean",
  base: "vs-dark",
  bg: "#0f111a",
  fg: "#a6accd",
  lineHighlight: "#161b2a",
  selection: "#1f2233",
  cursor: "#84ffff",
  lineNumber: "#3b4868",
  lineNumberActive: "#84ffff",
  whitespace: "#2a3148",
  widgetBg: "#161a26",
  border: "#2f3754",
  selectedBg: "#20305a",
  selectedFg: "#ffffff",
  accent: "#84ffff",
  inputBg: "#0f111a",
  diffInserted: "#c3e88d22",
  diffRemoved: "#f0717822",
  keyword: "#c792ea",
  func: "#82aaff",
  type: "#eeffff",
  string: "#c3e88d",
  number: "#f78c6c",
  variable: "#f07178",
  parameter: "#f07178",
  property: "#eeffff",
  constant: "#f78c6c",
  operator: "#89ddff",
  comment: "#717cb4",
  commentItalic: true,
  keywordItalic: true,
  namespace: "#eeffff",
  regexp: "#89ddff",
  decorator: "#c792ea",
};

export const oneLight: ThemePalette = {
  name: "one-light",
  base: "vs",
  bg: "#fafafa",
  fg: "#383a42",
  lineHighlight: "#f0f0f1",
  selection: "#cfcfcf",
  cursor: "#526fff",
  lineNumber: "#9d9d9f",
  lineNumberActive: "#383a42",
  whitespace: "#d4d4d4",
  widgetBg: "#ffffff",
  border: "#dcdcdc",
  selectedBg: "#e5e5e6",
  selectedFg: "#1c1d22",
  accent: "#4078f2",
  inputBg: "#ffffff",
  diffInserted: "#50a14f22",
  diffRemoved: "#e4564922",
  keyword: "#a626a4",
  func: "#4078f2",
  type: "#c18401",
  string: "#50a14f",
  number: "#986801",
  variable: "#e45649",
  parameter: "#383a42",
  property: "#e45649",
  constant: "#986801",
  operator: "#383a42",
  comment: "#a0a1a7",
  commentItalic: true,
  namespace: "#c18401",
  regexp: "#e45649",
  decorator: "#a626a4",
};

// material-deep-ocean is built bespoke (matches the PhpStorm Material .icls
// exactly), so it is NOT in customPalettes (which use the generic VS-Code builder).
export const customPalettes: ThemePalette[] = [
  calmDark,
  calmLight,
  oneLight,
];
