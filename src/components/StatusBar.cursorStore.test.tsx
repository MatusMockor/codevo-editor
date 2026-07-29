// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { EditorCursorStore } from "../application/editorCursorStore";
import { createLegacyEditorSessionOwnerKey } from "../domain/editorSessionOwnerKey";
import { defaultStatusBarItemVisibility } from "../domain/settings";
import { StatusBar } from "./StatusBar";

describe("StatusBar cursor store", () => {
  it("renders 100 cursor moves without committing workbench siblings", () => {
    const store = new EditorCursorStore();
    const lease = store.activate({
      documentPath: "/workspace/src/index.ts",
      groupId: "group-1",
      ownerKey: createLegacyEditorSessionOwnerKey("/workspace"),
    });
    if (!lease) throw new Error("Expected cursor authority activation");

    const commits = { editorSurface: 0, panel: 0, sidebar: 0, workbench: 0 };
    const subscribeActive = vi.spyOn(store, "subscribeActive");
    const container = document.createElement("div");
    const root = createRoot(container);

    function EditorSurfaceProbe() {
      commits.editorSurface += 1;
      return <main>editor</main>;
    }

    function SidebarProbe() {
      commits.sidebar += 1;
      return <aside>sidebar</aside>;
    }

    function PanelProbe() {
      commits.panel += 1;
      return <section>panel</section>;
    }

    function WorkbenchProbe() {
      commits.workbench += 1;
      return (
        <>
          <SidebarProbe />
          <EditorSurfaceProbe />
          <PanelProbe />
          <StatusBar
            activeLanguage="typescript"
            activePath="/workspace/src/index.ts"
            cursorAuthority={lease}
            cursorStore={store}
            dirtyCount={0}
            ideActivityLabel={null}
            ideActivityState={null}
            intelligenceMode="lightSmart"
            message={null}
            onChangeVisibility={() => {}}
            statusBar={defaultStatusBarItemVisibility()}
            workspaceInfoLabel="workspace"
            workspaceRoot="/workspace"
            workspaceTrustLabel="Trusted"
          />
        </>
      );
    }

    act(() => root.render(<WorkbenchProbe />));
    const afterMount = { ...commits };

    for (let index = 1; index <= 100; index += 1) {
      act(() => {
        expect(store.publish(lease, { column: index, lineNumber: index })).toBe(true);
      });
    }

    expect(container.querySelector<HTMLButtonElement>(".status-cursor-position")?.textContent).toBe(
      "Ln 100, Col 100",
    );
    expect(commits).toEqual(afterMount);
    expect(subscribeActive).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });
});
