// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeEditorGroupTab,
  closeEmptiedEditorGroups,
  createEditorGroup,
  createInitialEditorGroupsState,
  editorGroupsReducer,
  type EditorGroupsState,
} from "../domain/editorGroups";
import { createEditorSessionOwnerKey } from "../domain/editorSessionOwnerKey";
import type { EditorDocument } from "../domain/workspace";
import { EditorArea } from "./EditorArea";

const GREET = "/project/src/greet.ts";
const GREET_DOCUMENT: EditorDocument = {
  content: "",
  language: "typescript",
  name: "greet.ts",
  path: GREET,
  savedContent: "",
};

describe("EditorArea closing a split copy from its tab", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: EditorGroupsState | null;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    latest = null;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function splitGreet(activeGroupId: string): EditorGroupsState {
    const opened = createInitialEditorGroupsState(
      "editor-main",
      createEditorGroup({ activePath: GREET, openPaths: [GREET], previewPath: null }),
    );
    const split = editorGroupsReducer(opened, {
      type: "split-group",
      newGroupId: "editor-1",
      direction: "right",
    });
    return editorGroupsReducer(split, { type: "activate-group", groupId: activeGroupId });
  }

  function Harness({ initial }: { readonly initial: EditorGroupsState }) {
    const [state, setState] = useState(initial);
    latest = state;
    return (
      <EditorArea
        activeTabsInStrip
        documents={[GREET_DOCUMENT]}
        editorSessionOwnerKey={createEditorSessionOwnerKey("project", "/project")}
        onActivateGroup={(groupId) =>
          setState((current) => editorGroupsReducer(current, { type: "activate-group", groupId }))
        }
        onActivateTab={(groupId, path) =>
          setState((current) =>
            editorGroupsReducer(editorGroupsReducer(current, { type: "activate-group", groupId }), {
              type: "activate-tab",
              groupId,
              path,
            }),
          )
        }
        onCloseTab={(groupId, path) =>
          setState((current) =>
            closeEmptiedEditorGroups(
              current,
              closeEditorGroupTab(current, groupId, path).state,
              "editor-main",
            ),
          )
        }
        onMoveTab={() => undefined}
        onPinTab={() => undefined}
        onReorderTab={() => undefined}
        onResizeSplit={() => undefined}
        projectId="project"
        renderContent={(surface, groupId) => `${groupId}:${surface.kind}`}
        state={state}
      />
    );
  }

  it("closes the inactive right group's tab with a real pointer sequence", () => {
    act(() => root.render(<Harness initial={splitGreet("editor-main")} />));
    const closeButton = host.querySelector<HTMLButtonElement>(
      "[data-editor-group-id='editor-1'] button[aria-label='Close greet.ts']",
    );
    expect(closeButton).not.toBeNull();

    act(() => {
      closeButton?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    act(() => {
      closeButton?.focus();
    });
    act(() => {
      closeButton?.click();
    });

    expect(Object.keys(latest?.groups ?? {})).toEqual(["editor-main"]);
    expect(latest?.groups["editor-main"]?.activePath).toBe(GREET);
  });

  it("activates the inactive group through its tab click with a real pointer sequence", () => {
    act(() => root.render(<Harness initial={splitGreet("editor-main")} />));
    const tab = host.querySelector<HTMLButtonElement>(
      "[data-editor-group-id='editor-1'] button[role='tab']",
    );
    expect(tab).not.toBeNull();

    act(() => {
      tab?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(latest?.activeGroupId).toBe("editor-main");
    act(() => {
      tab?.click();
    });

    expect(latest?.activeGroupId).toBe("editor-1");
  });

  it("still activates the inactive group from a pointer press on its editor", () => {
    act(() => root.render(<Harness initial={splitGreet("editor-main")} />));
    const panel = host.querySelector("[data-editor-group-id='editor-1'] .editor-panel");

    act(() => {
      panel?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });

    expect(latest?.activeGroupId).toBe("editor-1");
  });
});
