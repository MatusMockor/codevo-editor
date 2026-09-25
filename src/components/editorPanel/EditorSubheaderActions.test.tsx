// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorCursorStore } from "../../application/editorCursorStore";
import { editorCursorAuthority } from "../../application/editorCursorAuthority";
import { createLegacyEditorSessionOwnerKey } from "../../domain/editorSessionOwnerKey";
import { click, mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { EditorChromeContext, type EditorChrome } from "./EditorChromeContext";
import { chromeFixture } from "./editorChromeTestSupport";
import { EditorSubheaderActions } from "./EditorSubheaderActions";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function renderActions(chrome: EditorChrome, onFind = vi.fn()) {
  mounted = mountUi();
  mounted.render(
    <EditorChromeContext.Provider value={chrome}>
      <EditorSubheaderActions groupId="editor-main" onFind={onFind} />
    </EditorChromeContext.Provider>,
  );
  return mounted.host;
}

describe("EditorSubheaderActions", () => {
  it("labels the problems counts and toggles the Problems drawer", () => {
    const chrome = chromeFixture({ diagnostics: { errors: 1, warnings: 4 } });
    const host = renderActions(chrome);
    const diag = host.querySelector<HTMLButtonElement>(
      'button[aria-label="1 error, 4 warnings. Show problems"]',
    );

    expect(diag?.textContent).toBe("14");
    expect(diag?.title).toBe("Problems ⇧⌘M");
    click(diag as Element);
    expect(chrome.toggleProblems).toHaveBeenCalledTimes(1);
  });

  it("pins the actions while Problems is open and marks the button pressed", () => {
    const host = renderActions(chromeFixture({ problemsOpen: true }));

    expect(host.querySelector(".cv-esub__acts")?.classList.contains("cv-esub__acts--pinned")).toBe(
      true,
    );
    expect(host.querySelector('button[aria-pressed="true"][title="Problems ⇧⌘M"]')).not.toBeNull();
  });

  it("shows the cursor position from the store for the exact authority and opens Go to Line", () => {
    const store = new EditorCursorStore();
    const authority = editorCursorAuthority(
      createLegacyEditorSessionOwnerKey("/w"),
      "editor-main",
      "/w/a.ts",
    );
    expect(authority).not.toBeNull();
    const lease = authority === null ? null : store.activate(authority);
    expect(lease).not.toBeNull();
    const chrome = chromeFixture({ cursorStore: store, cursorAuthority: authority });
    const host = renderActions(chrome);

    act(() => {
      if (lease !== null) store.publish(lease, { lineNumber: 25, column: 16 });
    });
    const pos = host.querySelector<HTMLButtonElement>('button[aria-label="Ln 25, Col 16"]');
    expect(pos?.textContent).toBe("Ln 25, Col 16");
    click(pos as Element);
    expect(chrome.showGoToLine).toHaveBeenCalledTimes(1);
  });

  it("hides a cursor position published for a different document", () => {
    const store = new EditorCursorStore();
    const ownerKey = createLegacyEditorSessionOwnerKey("/w");
    const other = editorCursorAuthority(ownerKey, "editor-main", "/w/b.ts");
    const lease = other === null ? null : store.activate(other);
    const host = renderActions(
      chromeFixture({
        cursorStore: store,
        cursorAuthority: editorCursorAuthority(ownerKey, "editor-main", "/w/a.ts"),
      }),
    );

    act(() => {
      if (lease !== null) store.publish(lease, { lineNumber: 3, column: 1 });
    });
    expect(host.querySelector(".cv-esub__pos")).toBeNull();
  });

  it("hides the cursor position when the visibility setting is off", () => {
    const host = renderActions(chromeFixture({ cursorVisible: false }));

    expect(host.querySelector(".cv-esub__pos")).toBeNull();
  });

  it("shows IDE activity only while it is not idle and opens the Runtime view", () => {
    const chrome = chromeFixture({
      activity: { label: "Indexing 40%", state: "scanning", detail: "PHPactor: Off" },
    });
    const host = renderActions(chrome);
    const activity = host.querySelector<HTMLButtonElement>('button[aria-label="Indexing 40%"]');

    expect(activity?.title).toBe("Indexing 40%\nPHPactor: Off");
    click(activity as Element);
    expect(chrome.openRuntimeView).toHaveBeenCalledTimes(1);
  });

  it("shows a running Node program with Stop", () => {
    const chrome = chromeFixture({
      nodeRun: { canStop: true, label: "Running dev", phase: "running", stopLabel: "Stop dev" },
    });
    const host = renderActions(chrome);
    click(host.querySelector('button[aria-label="Stop dev"]') as Element);

    expect(host.textContent).toContain("Running dev");
    expect(chrome.stopNodeRun).toHaveBeenCalledTimes(1);
  });

  it("finds in the file and splits the editor", () => {
    const onFind = vi.fn();
    const chrome = chromeFixture();
    const host = renderActions(chrome, onFind);
    click(host.querySelector('button[aria-label="Find in file"]') as Element);
    click(host.querySelector('button[aria-label="Split editor"]') as Element);

    expect(onFind).toHaveBeenCalledTimes(1);
    expect(chrome.splitRight).toHaveBeenCalledTimes(1);
  });

  it("opens the More editor actions menu from its button", () => {
    const host = renderActions(chromeFixture());
    const more = host.querySelector<HTMLButtonElement>('button[aria-label="More editor actions"]');

    expect(more?.getAttribute("aria-expanded")).toBe("false");
    click(more as Element);
    expect(more?.getAttribute("aria-expanded")).toBe("true");
    expect(
      document.body.querySelector('[role="menu"][aria-label="More editor actions"]'),
    ).not.toBeNull();
    expect(host.querySelector(".cv-esub__acts")?.classList.contains("cv-esub__acts--pinned")).toBe(
      true,
    );
  });

  it("renders nothing for a group that is not active", () => {
    mounted = mountUi();
    mounted.render(
      <EditorChromeContext.Provider value={chromeFixture({ activeGroupId: "editor-2" })}>
        <EditorSubheaderActions groupId="editor-main" onFind={vi.fn()} />
      </EditorChromeContext.Provider>,
    );

    expect(mounted.host.querySelector(".cv-esub__acts")).toBeNull();
  });

  it("renders 100 cursor moves without committing the chrome host or its siblings", () => {
    const store = new EditorCursorStore();
    const authority = editorCursorAuthority(
      createLegacyEditorSessionOwnerKey("/workspace"),
      "editor-main",
      "/workspace/src/index.ts",
    );
    const lease = authority === null ? null : store.activate(authority);
    expect(lease).not.toBeNull();
    const commits = { editorSurface: 0, panel: 0, host: 0 };
    const subscribeActive = vi.spyOn(store, "subscribeActive");
    const chrome = chromeFixture({ cursorStore: store, cursorAuthority: authority });

    function EditorSurfaceProbe() {
      commits.editorSurface += 1;
      return <main>editor</main>;
    }

    function PanelProbe() {
      commits.panel += 1;
      return <section>panel</section>;
    }

    function HostProbe() {
      commits.host += 1;
      return (
        <EditorChromeContext.Provider value={chrome}>
          <EditorSurfaceProbe />
          <PanelProbe />
          <EditorSubheaderActions groupId="editor-main" onFind={vi.fn()} />
        </EditorChromeContext.Provider>
      );
    }

    mounted = mountUi();
    mounted.render(<HostProbe />);
    const afterMount = { ...commits };
    for (let index = 1; index <= 100; index += 1) {
      act(() => {
        expect(lease !== null && store.publish(lease, { column: index, lineNumber: index })).toBe(
          true,
        );
      });
    }

    expect(mounted.host.querySelector(".cv-esub__pos")?.textContent).toBe("Ln 100, Col 100");
    expect(commits).toEqual(afterMount);
    expect(subscribeActive).toHaveBeenCalledTimes(1);
  });
});
