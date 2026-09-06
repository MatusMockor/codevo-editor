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
  bg: "#13151a",
  fg: "#bcd6f5",
  lineHighlight: "#1a1d23",
  selection: "#4fcdb338",
  cursor: "#4fcdb3",
  lineNumber: "#6a7180",
  lineNumberActive: "#9aa0ab",
  whitespace: "#292d35",
  widgetBg: "#1a1d23",
  border: "#1a1d23",
  selectedBg: "#20232a",
  selectedFg: "#f1f3f7",
  accent: "#4fcdb3",
  inputBg: "#0f1014",
  diffInserted: "#4cc38a21",
  diffRemoved: "#ef6f6f21",
  keyword: "#7fa3ff",
  func: "#e6d39a",
  type: "#7fd1c2",
  string: "#d5a37f",
  number: "#b5cea8",
  variable: "#bcd6f5",
  parameter: "#cbb9a3",
  property: "#a5c4ee",
  constant: "#c9a97f",
  operator: "#9aa0ab",
  comment: "#6b7a6b",
  commentItalic: true,
  namespace: "#7fd1c2",
  regexp: "#d5a37f",
  decorator: "#7fa3ff",
};

export const calmLight: ThemePalette = {
  name: "calm-light",
  base: "vs",
  bg: "#f0f2f5",
  fg: "#2c3e5e",
  lineHighlight: "#ffffff",
  selection: "#15907c38",
  cursor: "#15907c",
  lineNumber: "#99a1ad",
  lineNumberActive: "#6c7482",
  whitespace: "#dbdfe6",
  widgetBg: "#ffffff",
  border: "#ffffff",
  selectedBg: "#e5e8ed",
  selectedFg: "#171a1f",
  accent: "#15907c",
  inputBg: "#eaedf1",
  diffInserted: "#1f9d5f21",
  diffRemoved: "#d645451f",
  keyword: "#7b3fd6",
  func: "#3b64c9",
  type: "#b46a00",
  string: "#4f8a41",
  number: "#a35c1c",
  variable: "#2c3e5e",
  parameter: "#6b5f45",
  property: "#2f5f78",
  constant: "#a35c1c",
  operator: "#6c7482",
  comment: "#9098a0",
  commentItalic: true,
  namespace: "#b46a00",
  regexp: "#4f8a41",
  decorator: "#7b3fd6",
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
