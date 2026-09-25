// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorDocument } from "../../domain/workspace";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import {
  useEditorPanelDocumentsValue,
  type EditorPanelDocumentsInput,
  type EditorPanelDocumentsValue,
} from "./EditorPanelDocumentsContext";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const values: Array<EditorPanelDocumentsValue | null> = [];
let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  values.length = 0;
});

function Probe({ input }: { readonly input: EditorPanelDocumentsInput }) {
  values.push(useEditorPanelDocumentsValue(input));
  return null;
}

function doc(content: string): EditorDocument {
  return { path: "/w/a.ts", name: "a.ts", content, savedContent: "a", language: "typescript" };
}

function handlers() {
  return {
    onActivate: vi.fn(),
    onClose: vi.fn(),
    onOpenFile: vi.fn(),
    onEmpty: vi.fn(),
    onPin: vi.fn(),
  };
}

function input(
  content: string,
  callbacks = handlers(),
  ownerKey = "/w",
): EditorPanelDocumentsInput {
  return {
    ownerKey,
    group: { activePath: "/w/a.ts", openPaths: ["/w/a.ts"], previewPath: null },
    documents: [doc(content)],
    fileStatusesByPath: {},
    ...callbacks,
  };
}

describe("useEditorPanelDocumentsValue", () => {
  it("keeps the same value across keystrokes that do not change tab state", () => {
    mounted = mountUi();
    mounted.render(<Probe input={input("a1")} />);
    mounted.render(<Probe input={input("a12")} />);
    mounted.render(<Probe input={input("a123")} />);

    expect(values[1]).toBe(values[0]);
    expect(values[2]).toBe(values[0]);
  });

  it("publishes a new value when the dirty flag flips", () => {
    mounted = mountUi();
    mounted.render(<Probe input={input("a")} />);
    mounted.render(<Probe input={input("a1")} />);

    expect(values[1]).not.toBe(values[0]);
    expect(values[1]?.documents[0]?.dirty).toBe(true);
  });

  it("calls the latest handlers without changing the value", () => {
    const first = handlers();
    const second = handlers();
    mounted = mountUi();
    mounted.render(<Probe input={input("a1", first)} />);
    mounted.render(<Probe input={input("a12", second)} />);
    values[0]?.onActivate("/w/a.ts");
    values[0]?.onClose("/w/a.ts");
    values[0]?.onOpenFile();
    values[0]?.onPin("/w/a.ts");

    expect(values[1]).toBe(values[0]);
    expect(second.onActivate).toHaveBeenCalledWith("/w/a.ts");
    expect(second.onClose).toHaveBeenCalledWith("/w/a.ts");
    expect(second.onOpenFile).toHaveBeenCalledTimes(1);
    expect(second.onPin).toHaveBeenCalledWith("/w/a.ts");
    expect(first.onActivate).not.toHaveBeenCalled();
  });

  it("closes the editor surface when the last document closes, once", () => {
    const callbacks = handlers();
    const empty: EditorPanelDocumentsInput = {
      ...input("a", callbacks),
      group: { activePath: null, openPaths: [], previewPath: null },
      documents: [],
    };
    mounted = mountUi();
    mounted.render(<Probe input={input("a", callbacks)} />);
    mounted.render(<Probe input={empty} />);
    mounted.render(<Probe input={{ ...empty }} />);

    expect(callbacks.onEmpty).toHaveBeenCalledTimes(1);
  });

  it("does not close the surface for a group that starts empty", () => {
    const callbacks = handlers();
    mounted = mountUi();
    mounted.render(
      <Probe
        input={{
          ...input("a", callbacks),
          group: { activePath: null, openPaths: [], previewPath: null },
          documents: [],
        }}
      />,
    );

    expect(callbacks.onEmpty).not.toHaveBeenCalled();
  });

  it("never closes the surface when a workspace switch empties the group", () => {
    const callbacks = handlers();
    const emptyIn = (ownerKey: string): EditorPanelDocumentsInput => ({
      ...input("a", callbacks, ownerKey),
      group: { activePath: null, openPaths: [], previewPath: null },
      documents: [],
    });
    mounted = mountUi();
    mounted.render(<Probe input={input("a", callbacks, "/a")} />);
    mounted.render(<Probe input={emptyIn("/b")} />);
    mounted.render(<Probe input={input("a", callbacks, "/a")} />);
    mounted.render(<Probe input={emptyIn("/a")} />);

    expect(callbacks.onEmpty).toHaveBeenCalledTimes(1);
  });

  it("publishes a new value when a tab's git status changes", () => {
    mounted = mountUi();
    mounted.render(<Probe input={input("a")} />);
    mounted.render(
      <Probe input={{ ...input("a"), fileStatusesByPath: { "/w/a.ts": "modified" } }} />,
    );

    expect(values[1]).not.toBe(values[0]);
    expect(values[1]?.documents[0]?.gitStatus).toBe("modified");
  });

  it("is null without a group", () => {
    mounted = mountUi();
    mounted.render(<Probe input={{ ...input("a"), group: null }} />);

    expect(values[0]).toBeNull();
  });
});
