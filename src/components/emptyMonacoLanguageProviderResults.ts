import type * as Monaco from "monaco-editor";

export function emptyCodeActionList(): Monaco.languages.CodeActionList {
  return { actions: [], dispose: () => undefined };
}

export function emptyCodeLensList(): Monaco.languages.CodeLensList {
  return { dispose: () => undefined, lenses: [] };
}

export function emptyInlayHintList(): Monaco.languages.InlayHintList {
  return { hints: [], dispose: () => undefined };
}

export function emptyLinksList(): Monaco.languages.ILinksList {
  return { dispose: () => undefined, links: [] };
}
