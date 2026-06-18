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
  func: "#8aa9c9",
  type: "#d8b878",
  string: "#8fbcae",
  number: "#d8b878",
  variable: "#c2c8d2",
  parameter: "#c2c8d2",
  property: "#c2c8d2",
  constant: "#d8b878",
  operator: "#8b94a3",
  comment: "#5e6573",
  commentItalic: true,
  namespace: "#d8b878",
  regexp: "#8fbcae",
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
  func: "#3d7c8a",
  type: "#9a7016",
  string: "#2a7d6f",
  number: "#9a7016",
  variable: "#3a4654",
  parameter: "#3a4654",
  property: "#3a4654",
  constant: "#9a7016",
  operator: "#5d6b7a",
  comment: "#74808f",
  commentItalic: true,
  namespace: "#9a7016",
  regexp: "#2a7d6f",
};

export const ayuMirage: ThemePalette = {
  name: "ayu-mirage",
  base: "vs-dark",
  bg: "#1f2430",
  fg: "#cccac2",
  lineHighlight: "#242b38",
  selection: "#33415e",
  cursor: "#ffcc66",
  lineNumber: "#707a8c",
  lineNumberActive: "#ffd580",
  whitespace: "#3b4557",
  widgetBg: "#242b38",
  border: "#3a4453",
  selectedBg: "#2f3a4f",
  selectedFg: "#fff3d4",
  accent: "#ffcc66",
  inputBg: "#1f2430",
  diffInserted: "#95e6cb22",
  diffRemoved: "#f2877922",
  keyword: "#ffad66",
  func: "#ffd173",
  type: "#73d0ff",
  string: "#d5ff80",
  number: "#ffcc66",
  variable: "#cccac2",
  parameter: "#dfbfff",
  property: "#f28779",
  constant: "#ffcc66",
  operator: "#f29e74",
  comment: "#5c6773",
  commentItalic: true,
  namespace: "#73d0ff",
  regexp: "#95e6cb",
};

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
};

// material-deep-ocean is built bespoke (matches the PhpStorm Material .icls
// exactly), so it is NOT in customPalettes (which use the generic VS-Code builder).
export const customPalettes: ThemePalette[] = [
  calmDark,
  calmLight,
  ayuMirage,
  oneLight,
];
