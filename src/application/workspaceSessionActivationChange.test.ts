import { describe, expect, it } from "vitest";
import { DEFAULT_WORKSPACE_EDITOR_GROUP_ID, defaultWorkspaceSettings } from "../domain/settings";
import type { WorkspaceSessionState } from "../domain/settings";
import {
  isActivationOnlyWorkspaceSessionChange,
  mergeActivationOnlyWorkspaceSession,
} from "./workspaceSessionActivationChange";

const SECOND_GROUP_ID = "group-2";

describe("workspace session activation change", () => {
  it("treats an active-path move between the same open tabs as activation only", () => {
    expect(
      isActivationOnlyWorkspaceSessionChange(
        session({ activePath: "/workspace/a.ts" }),
        session({ activePath: "/workspace/b.ts" }),
      ),
    ).toBe(true);
  });

  it("treats an active-group move as activation only", () => {
    const previous = session({ activePath: "/workspace/a.ts" });
    const next = { ...previous, editor: { ...previous.editor, activeGroupId: SECOND_GROUP_ID } };

    expect(isActivationOnlyWorkspaceSessionChange(previous, next)).toBe(true);
  });

  it("treats a persisted view-state change as activation only", () => {
    const previous = session({ activePath: "/workspace/a.ts" });
    const next: WorkspaceSessionState = {
      ...previous,
      viewStates: {
        [DEFAULT_WORKSPACE_EDITOR_GROUP_ID]: { "/workspace/a.ts": { column: 3, line: 12 } },
      },
    };

    expect(isActivationOnlyWorkspaceSessionChange(previous, next)).toBe(true);
  });

  it("rejects an opened tab", () => {
    expect(
      isActivationOnlyWorkspaceSessionChange(
        session({ activePath: "/workspace/a.ts" }),
        session({ activePath: "/workspace/a.ts", openPaths: ["/workspace/a.ts"] }),
      ),
    ).toBe(false);
  });

  it("rejects a preview-tab change", () => {
    expect(
      isActivationOnlyWorkspaceSessionChange(
        session({ activePath: "/workspace/a.ts" }),
        session({ activePath: "/workspace/a.ts", previewPath: "/workspace/a.ts" }),
      ),
    ).toBe(false);
  });

  it("rejects a sidebar or bottom-panel change", () => {
    const previous = session({ activePath: "/workspace/a.ts" });

    expect(
      isActivationOnlyWorkspaceSessionChange(previous, { ...previous, sidebarView: "git" }),
    ).toBe(false);
    expect(
      isActivationOnlyWorkspaceSessionChange(previous, {
        ...previous,
        bottomPanelView: "problems",
      }),
    ).toBe(previous.bottomPanelView === "problems");
  });

  it("rejects a split-layout change", () => {
    const previous = session({ activePath: "/workspace/a.ts" });
    const next: WorkspaceSessionState = {
      ...previous,
      editor: {
        ...previous.editor,
        groups: {
          ...previous.editor.groups,
          [SECOND_GROUP_ID]: { activePath: null, openPaths: [], previewPath: null },
        },
      },
    };

    expect(isActivationOnlyWorkspaceSessionChange(previous, next)).toBe(false);
  });

  it("merges only activation, navigation and view state onto the committed session", () => {
    const base: WorkspaceSessionState = {
      ...session({ activePath: "/workspace/a.ts" }),
      sidebarView: "git",
    };
    const activation: WorkspaceSessionState = {
      ...session({ activePath: "/workspace/b.ts" }),
      viewStates: {
        [DEFAULT_WORKSPACE_EDITOR_GROUP_ID]: { "/workspace/b.ts": { column: 1, line: 2 } },
      },
    };

    const merged = mergeActivationOnlyWorkspaceSession(base, activation);

    expect(merged.sidebarView).toBe("git");
    expect(merged.editor).toBe(activation.editor);
    expect(merged.viewStates).toBe(activation.viewStates);
  });
});

function session({
  activePath,
  openPaths = ["/workspace/a.ts", "/workspace/b.ts"],
  previewPath = null,
}: {
  activePath: string | null;
  openPaths?: string[];
  previewPath?: string | null;
}): WorkspaceSessionState {
  const baseSession = defaultWorkspaceSettings().session;

  return {
    ...baseSession,
    editor: {
      ...baseSession.editor,
      groups: {
        [DEFAULT_WORKSPACE_EDITOR_GROUP_ID]: { activePath, openPaths, previewPath },
      },
    },
  };
}
