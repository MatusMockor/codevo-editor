// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createInitialEditorGroupsState } from "../../domain/editorGroups";
import type { EditorDocument } from "../../domain/workspace";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import type { EditorPanelDocumentsValue } from "./EditorPanelDocumentsContext";
import { useWorkbenchEditorPanelDocuments } from "./useWorkbenchEditorPanelDocuments";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function doc(path: string): EditorDocument {
  return { path, name: path.slice(1), content: "", savedContent: "", language: "typescript" };
}

describe("useWorkbenchEditorPanelDocuments", () => {
  it("routes strip intents to the active group and the quick open", () => {
    const host = {
      activateEditorGroupTab: vi.fn(),
      closeDocumentInEditorGroup: vi.fn(async () => undefined),
      setQuickOpenOpen: vi.fn(),
      pinEditorGroupTab: vi.fn(),
    };
    const values: Array<EditorPanelDocumentsValue | null> = [];
    const groups = (openPaths: string[]) =>
      createInitialEditorGroupsState("group-a", {
        activePath: openPaths[0] ?? null,
        openPaths,
        previewPath: null,
      });
    function Probe({ openPaths }: { readonly openPaths: string[] }) {
      values.push(
        useWorkbenchEditorPanelDocuments(host, "/w", groups(openPaths), openPaths.map(doc), {
          "/a.ts": "modified",
        }),
      );
      return null;
    }

    mounted = mountUi();
    mounted.render(<Probe openPaths={["/a.ts", "/b.ts"]} />);
    const value = values[0];
    expect(value?.documents.map((entry) => [entry.title, entry.gitStatus])).toEqual([
      ["a.ts", "modified"],
      ["b.ts", null],
    ]);

    value?.onActivate("/b.ts");
    value?.onClose("/a.ts");
    value?.onOpenFile();
    value?.onPin("/b.ts");
    expect(host.activateEditorGroupTab).toHaveBeenCalledWith("group-a", "/b.ts");
    expect(host.closeDocumentInEditorGroup).toHaveBeenCalledWith("group-a", "/a.ts");
    expect(host.setQuickOpenOpen).toHaveBeenCalledWith(true);
    expect(host.pinEditorGroupTab).toHaveBeenCalledWith("group-a", "/b.ts");

    mounted.render(<Probe openPaths={[]} />);
    expect(host.activateEditorGroupTab).toHaveBeenCalledTimes(1);
  });
});
