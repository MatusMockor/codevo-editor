import { createContext, useContext } from "react";
import type {
  EditorCursorAuthority,
  EditorCursorStorePort,
} from "../../application/editorCursorStore";
import type { NodeRunStatusPresentation } from "../../application/nodeRunWithoutDebuggingPresentation";
import type { IdeActivityState } from "../../domain/ideActivity";

export type EditorDebugEntry =
  "start" | "runWithoutDebugging" | "launchConfigurations" | "attach" | "showViews";

export interface EditorChromeActivity {
  readonly label: string;
  readonly state: IdeActivityState;
  readonly detail: string | null;
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
  readonly debugStart: string;
  readonly runWithoutDebugging: string;
}

export interface EditorChrome {
  readonly activeGroupId: string | null;
  readonly diagnostics: { readonly errors: number; readonly warnings: number };
  readonly problemsOpen: boolean;
  readonly cursorVisible: boolean;
  readonly cursorStore: EditorCursorStorePort | null;
  readonly cursorAuthority: EditorCursorAuthority | null;
  readonly activity: EditorChromeActivity | null;
  readonly nodeRun: NodeRunStatusPresentation | null;
  readonly debugToolbarVisible: boolean;
  readonly statusRows: ReadonlyArray<EditorStatusRow>;
  readonly ideModeOn: boolean;
  readonly trustNeeded: boolean;
  readonly shortcuts: EditorChromeShortcuts;
  toggleProblems(): void;
  showGoToLine(): void;
  openRuntimeView(): void;
  stopNodeRun(): void;
  splitRight(): void;
  splitDown(): void;
  toggleIdeMode(): void;
  trustWorkspace(): void;
  revealInFiles(): void;
  openBranches(): void;
  runDebugEntry(entry: EditorDebugEntry): void;
}

export const EditorChromeContext = createContext<EditorChrome | null>(null);

export function useEditorChrome(): EditorChrome | null {
  return useContext(EditorChromeContext);
}
