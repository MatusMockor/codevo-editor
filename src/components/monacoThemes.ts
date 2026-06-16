import type * as Monaco from "monaco-editor";

export function registerMonacoAppThemes(monaco: typeof Monaco): void {
  monaco.editor.defineTheme("mockor-ayu-mirage", {
    base: "vs-dark",
    colors: {
      "activityBar.background": "#1f2430",
      "editor.background": "#1f2430",
      "editor.foreground": "#cbccc6",
      "editor.lineHighlightBackground": "#242b38",
      "editor.selectionBackground": "#33415e",
      "editorCursor.foreground": "#ffcc66",
      "editorGutter.background": "#1f2430",
      "editorLineNumber.activeForeground": "#ffd580",
      "editorLineNumber.foreground": "#707a8c",
      "editorWhitespace.foreground": "#3b4557",
    },
    inherit: true,
    rules: [
      { foreground: "ffcc66", token: "keyword" },
      { foreground: "ffd580", token: "string" },
      { foreground: "bae67e", token: "number" },
      { foreground: "73d0ff", token: "type" },
      { foreground: "95e6cb", token: "function" },
      { foreground: "5ccfe6", token: "variable" },
      { foreground: "707a8c", fontStyle: "italic", token: "comment" },
    ],
  });

  monaco.editor.defineTheme("mockor-material-deep-ocean", {
    base: "vs-dark",
    colors: {
      "activityBar.background": "#0f111a",
      "editor.background": "#0f111a",
      "editor.foreground": "#d8dee9",
      "editor.lineHighlightBackground": "#161b2a",
      "editor.selectionBackground": "#26345c",
      "editorCursor.foreground": "#84ffff",
      "editorGutter.background": "#0f111a",
      "editorLineNumber.activeForeground": "#c792ea",
      "editorLineNumber.foreground": "#54617d",
      "editorWhitespace.foreground": "#2a3148",
    },
    inherit: true,
    rules: [
      { foreground: "c792ea", token: "keyword" },
      { foreground: "c3e88d", token: "string" },
      { foreground: "f78c6c", token: "number" },
      { foreground: "ffcb6b", token: "type" },
      { foreground: "82aaff", token: "function" },
      { foreground: "89ddff", token: "variable" },
      { foreground: "54617d", fontStyle: "italic", token: "comment" },
    ],
  });
}
