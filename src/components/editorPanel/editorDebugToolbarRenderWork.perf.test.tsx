// @vitest-environment jsdom

import { memo, Profiler } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultStatusBarItemVisibility } from "../../domain/settings";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import type { DebugCopyValuePanelSurfaces, DebugPanelProps } from "../DebugPanel";
import { debugPanelTestProps } from "../debug/debugPanelTestProps";
import { usePrivateDebugRegions } from "../debug/usePrivateDebugRegions";
import { EditorChromeContext } from "./EditorChromeContext";
import { EditorDebugToolbarContext } from "./EditorDebugToolbarContext";
import { EditorSubheader } from "./EditorSubheader";
import { useEditorChromeValue } from "./useEditorChromeValue";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const STOPPED: DebugPanelProps["snapshot"] = {
  state: {
    kind: "stopped",
    sessionId: 7,
    reason: "breakpoint",
    frames: [],
  } as unknown as DebugPanelProps["snapshot"]["state"],
  lastSeq: 1,
};

const MemoSubheader = memo(function MemoSubheader({ onRender }: { onRender(): void }) {
  return (
    <Profiler id="subheader" onRender={onRender}>
      <EditorSubheader
        documentPath="/w/src/a.ts"
        groupId="editor-main"
        onFind={noop}
        rootPath="/w"
        symbols={null}
      />
    </Profiler>
  );
});

function Host({
  debugProps,
  keystroke,
  onSubheaderRender,
}: {
  readonly debugProps: DebugPanelProps;
  readonly keystroke: number;
  onSubheaderRender(): void;
}) {
  const surfaces = { keystroke } as unknown as DebugCopyValuePanelSurfaces;
  const regions = usePrivateDebugRegions(debugProps, surfaces);
  const chrome = useEditorChromeValue({
    activeGroupId: "editor-main",
    diagnostics: { errors: 0, warnings: 0 },
    panelView: "problems",
    panelVisible: false,
    statusBar: defaultStatusBarItemVisibility(),
    status: {
      workspaceLabel: "w",
      ideActivityLabel: null,
      ideActivityState: "idle",
      ideActivityDetail: "",
    },
    activeLanguage: "TypeScript",
    gitBranch: "main",
    branchRepositoryLabel: null,
    intelligenceMode: "fullSmart",
    largeDocumentStatus: null,
    dirtyCount: 1,
    workspaceTrustLabel: "Trusted",
    workspaceRoot: "/w",
    workspaceTrusted: true,
    nodeRun: null,
    debugToolbarVisible: true,
    cursorStore: null,
    cursorAuthority: null,
    shortcuts: { problems: "P", find: "F", split: "S", debugStart: "F5", runWithoutDebugging: "R" },
    actions: {
      showBottomPanelView: noop,
      hideBottomPanel: noop,
      maximizePanel: noop,
      showGoToLine: noop,
      stopNodeRun: noop,
      runCommand: noop,
      toggleIdeMode: noop,
      trustWorkspace: noop,
      revealInFiles: noop,
      openBranches: noop,
    },
  });
  return (
    <EditorChromeContext.Provider value={chrome}>
      <EditorDebugToolbarContext.Provider value={regions.toolbar}>
        <MemoSubheader onRender={onSubheaderRender} />
      </EditorDebugToolbarContext.Provider>
    </EditorChromeContext.Provider>
  );
}

function noop(): void {}

describe("editor sub-header render work during a debug session", () => {
  it("does not re-render the sub-header for keystrokes while the debug state is unchanged", () => {
    const onSubheaderRender = vi.fn();
    const debugProps = debugPanelTestProps({ snapshot: STOPPED });
    mounted = mountUi();
    mounted.render(
      <Host debugProps={debugProps} keystroke={0} onSubheaderRender={onSubheaderRender} />,
    );
    expect(
      mounted.host.querySelector('[role="toolbar"][aria-label="Debug session"]'),
    ).not.toBeNull();
    onSubheaderRender.mockClear();

    for (let keystroke = 1; keystroke <= 50; keystroke += 1) {
      mounted.render(
        <Host
          debugProps={debugProps}
          keystroke={keystroke}
          onSubheaderRender={onSubheaderRender}
        />,
      );
    }

    expect(onSubheaderRender).not.toHaveBeenCalled();
  });

  it("re-renders the debug toolbar when the debug state changes", () => {
    const onSubheaderRender = vi.fn();
    mounted = mountUi();
    mounted.render(
      <Host
        debugProps={debugPanelTestProps({ snapshot: STOPPED })}
        keystroke={0}
        onSubheaderRender={onSubheaderRender}
      />,
    );
    const status = () => mounted?.host.querySelector('[data-testid="debug-status"]')?.textContent;
    const before = status();

    mounted.render(
      <Host
        debugProps={debugPanelTestProps({
          snapshot: {
            state: { kind: "running", sessionId: 7 },
            lastSeq: 2,
          } as DebugPanelProps["snapshot"],
        })}
        keystroke={1}
        onSubheaderRender={onSubheaderRender}
      />,
    );

    expect(status()).not.toBe(before);
  });
});
