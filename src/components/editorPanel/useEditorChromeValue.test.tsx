// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultStatusBarItemVisibility } from "../../domain/settings";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import type { EditorChrome } from "./EditorChromeContext";
import { useEditorChromeValue, type EditorChromeInput } from "./useEditorChromeValue";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const results: EditorChrome[] = [];
let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  results.length = 0;
});

function Probe({ input }: { readonly input: EditorChromeInput }) {
  results.push(useEditorChromeValue(input));
  return null;
}

function input(overrides: Partial<EditorChromeInput> = {}): EditorChromeInput {
  return {
    activeGroupId: "editor-main",
    diagnostics: { errors: 0, warnings: 0 },
    panelView: "problems",
    panelVisible: false,
    statusBar: defaultStatusBarItemVisibility(),
    status: {
      workspaceLabel: "orders-api",
      ideActivityLabel: null,
      ideActivitySummary: null,
      ideActivityDetail: "",
    },
    activeLanguage: "TypeScript",
    gitBranch: "main",
    branchRepositoryLabel: null,
    intelligenceMode: "fullSmart",
    largeDocumentStatus: null,
    dirtyCount: 0,
    workspaceTrustLabel: "Trusted",
    workspaceRoot: "/w",
    workspaceTrusted: true,
    cursorStore: null,
    cursorAuthority: null,
    shortcuts: {
      problems: "⇧⌘M",
      find: "⌘F",
      split: "⌘\\",
    },
    actions: {
      showBottomPanelView: vi.fn(),
      hideBottomPanel: vi.fn(),
      showGoToLine: vi.fn(),
      runCommand: vi.fn(),
      toggleIdeMode: vi.fn(),
      trustWorkspace: vi.fn(),
      revealInFiles: vi.fn(),
      openBranches: vi.fn(),
    },
    ...overrides,
  };
}

function render(value: EditorChromeInput): void {
  mounted ??= mountUi();
  mounted.render(<Probe input={value} />);
}

describe("useEditorChromeValue", () => {
  it("is stable while inputs are structurally equal", () => {
    const shared = input();
    render(shared);
    render({
      ...shared,
      diagnostics: { ...shared.diagnostics },
      shortcuts: { ...shared.shortcuts },
      status: { ...shared.status },
      statusBar: { ...shared.statusBar },
      actions: { ...shared.actions },
    });

    expect(results[1]).toBe(results[0]);
  });

  it("changes when a readout changes and keeps the status rows otherwise", () => {
    const shared = input();
    render(shared);
    render({ ...shared, diagnostics: { errors: 2, warnings: 0 } });
    render({ ...shared, diagnostics: { errors: 2, warnings: 0 }, dirtyCount: 1 });

    expect(results[1]).not.toBe(results[0]);
    expect(results[1]?.statusRows).toBe(results[0]?.statusRows);
    expect(results[2]?.statusRows.find((row) => row.id === "unsaved")?.value).toBe("1 file");
  });

  it("calls the latest actions without producing a new value", () => {
    const first = input();
    const second = input();
    render(first);
    render({ ...first, actions: second.actions });
    results[1]?.showGoToLine();

    expect(results[1]).toBe(results[0]);
    expect(second.actions.showGoToLine).toHaveBeenCalledTimes(1);
    expect(first.actions.showGoToLine).not.toHaveBeenCalled();
  });

  it("toggles Problems: shows the drawer view, or hides it when Problems is already open", () => {
    const closed = input();
    render(closed);
    results[0]?.toggleProblems();
    expect(closed.actions.showBottomPanelView).toHaveBeenCalledWith("problems");

    const open = input({ panelVisible: true });
    render(open);
    expect(results[1]?.problemsOpen).toBe(true);
    results[1]?.toggleProblems();
    expect(open.actions.hideBottomPanel).toHaveBeenCalledTimes(1);
  });

  it("does not report Problems open while another panel view is visible", () => {
    const terminal = input({ panelVisible: true, panelView: "terminal" });
    render(terminal);

    expect(results[0]?.problemsOpen).toBe(false);
    results[0]?.toggleProblems();
    expect(terminal.actions.showBottomPanelView).toHaveBeenCalledWith("problems");
  });

  it("hides IDE activity when idle or when both index and IDE engine readouts are switched off", () => {
    render(input());
    expect(results[0]?.activity).toBeNull();

    const busy = {
      workspaceLabel: null,
      ideActivityLabel: "IDE: Indexing 40 of 100 (40%)",
      ideActivitySummary: { kind: "busy" as const, text: "Indexing 40%…" },
      ideActivityDetail: "PHPactor: stopped",
    };
    render(input({ status: busy }));
    expect(results[1]?.activity).toEqual({
      kind: "busy",
      text: "Indexing 40%…",
      title: "Indexing 40%…\nPHPactor: stopped",
    });

    render(
      input({
        status: busy,
        statusBar: { ...defaultStatusBarItemVisibility(), index: false, languageServer: false },
      }),
    );
    expect(results[2]?.activity).toBeNull();
  });

  it("puts a failure reason in the activity tooltip and hides settled engines", () => {
    render(
      input({
        status: {
          workspaceLabel: null,
          ideActivityLabel: "IDE: TS Server crashed for this project",
          ideActivitySummary: {
            kind: "problem",
            text: "TypeScript crashed",
            reason: "tsserver exited with code 1",
          },
          ideActivityDetail: "TypeScript: crashed",
        },
      }),
    );
    expect(results[0]?.activity).toEqual({
      kind: "problem",
      text: "TypeScript crashed",
      title: "TypeScript crashed\ntsserver exited with code 1\nTypeScript: crashed",
    });

    render(
      input({
        status: {
          workspaceLabel: null,
          ideActivityLabel: "IDE: TS Server running for this project",
          ideActivitySummary: null,
          ideActivityDetail: "TS Server: running",
        },
      }),
    );
    expect(results[1]?.activity).toBeNull();

    render(
      input({
        status: {
          workspaceLabel: null,
          ideActivityLabel: null,
          ideActivitySummary: { kind: "busy", text: "Indexing…" },
          ideActivityDetail: "",
        },
      }),
    );
    expect(results[2]?.activity).toEqual({ kind: "busy", text: "Indexing…", title: "Indexing…" });
  });

  it("derives cursor visibility, IDE mode and trust from settings and the workspace", () => {
    render(
      input({
        intelligenceMode: "basic",
        statusBar: { ...defaultStatusBarItemVisibility(), cursorPosition: false },
        workspaceTrusted: false,
      }),
    );

    expect(results[0]?.cursorVisible).toBe(false);
    expect(results[0]?.ideModeOn).toBe(false);
    expect(results[0]?.trustNeeded).toBe(true);
    render(input({ workspaceRoot: null, workspaceTrusted: false }));
    expect(results[1]?.trustNeeded).toBe(false);
  });

  it("routes split, runtime, IDE mode, trust and reveal to the actions", () => {
    const value = input();
    render(value);
    results[0]?.splitRight();
    results[0]?.splitDown();
    results[0]?.openRuntimeView();
    results[0]?.toggleIdeMode();
    results[0]?.trustWorkspace();
    results[0]?.revealInFiles();

    expect(value.actions.runCommand).toHaveBeenNthCalledWith(1, "editor.splitRight");
    expect(value.actions.runCommand).toHaveBeenNthCalledWith(2, "editor.splitDown");
    expect(value.actions.showBottomPanelView).toHaveBeenCalledWith("runtime");
    expect(value.actions.toggleIdeMode).toHaveBeenCalledTimes(1);
    expect(value.actions.trustWorkspace).toHaveBeenCalledTimes(1);
    expect(value.actions.revealInFiles).toHaveBeenCalledTimes(1);
  });
});
