import { createContext, useContext } from "react";
import type {
  EditorCursorAuthority,
  EditorCursorStorePort,
} from "../../application/editorCursorStore";

export interface EditorChromeActivity {
  readonly kind: "busy" | "problem";
  readonly text: string;
  readonly title: string;
}

export type EditorStatusRowId =
  "language" | "project" | "branch" | "trust" | "mode" | "largeFile" | "unsaved";

export interface EditorStatusRow {
  readonly id: EditorStatusRowId;
  readonly label: string;
  readonly value: string;
}

export interface EditorChromeShortcuts {
  readonly problems: string;
  readonly find: string;
  readonly split: string;
}

export interface EditorChrome {
  readonly activeGroupId: string | null;
  readonly diagnostics: { readonly errors: number; readonly warnings: number };
  readonly problemsOpen: boolean;
  readonly cursorVisible: boolean;
  readonly cursorStore: EditorCursorStorePort | null;
  readonly cursorAuthority: EditorCursorAuthority | null;
  readonly activity: EditorChromeActivity | null;
  readonly statusRows: ReadonlyArray<EditorStatusRow>;
  readonly ideModeOn: boolean;
  readonly trustNeeded: boolean;
  readonly shortcuts: EditorChromeShortcuts;
  toggleProblems(): void;
  showGoToLine(): void;
  openRuntimeView(): void;
  splitRight(): void;
  splitDown(): void;
  toggleIdeMode(): void;
  trustWorkspace(): void;
  revealInFiles(): void;
  openBranches(): void;
}

export const EditorChromeContext = createContext<EditorChrome | null>(null);

export function useEditorChrome(): EditorChrome | null {
  return useContext(EditorChromeContext);
}
