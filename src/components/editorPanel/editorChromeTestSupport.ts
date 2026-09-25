import { vi } from "vitest";
import type { EditorChrome } from "./EditorChromeContext";

export function chromeFixture(overrides: Partial<EditorChrome> = {}): EditorChrome {
  return {
    activeGroupId: "editor-main",
    diagnostics: { errors: 1, warnings: 1 },
    problemsOpen: false,
    cursorVisible: true,
    cursorStore: null,
    cursorAuthority: null,
    activity: null,
    nodeRun: null,
    debugToolbarVisible: false,
    statusRows: [],
    ideModeOn: true,
    trustNeeded: false,
    shortcuts: {
      problems: "⇧⌘M",
      find: "⌘F",
      split: "⌘\\",
      debugStart: "F5",
      runWithoutDebugging: "⌃F5",
    },
    toggleProblems: vi.fn(),
    showGoToLine: vi.fn(),
    openRuntimeView: vi.fn(),
    stopNodeRun: vi.fn(),
    splitRight: vi.fn(),
    splitDown: vi.fn(),
    toggleIdeMode: vi.fn(),
    trustWorkspace: vi.fn(),
    revealInFiles: vi.fn(),
    openBranches: vi.fn(),
    runDebugEntry: vi.fn(),
    ...overrides,
  };
}
