// @vitest-environment jsdom

import { memo, useContext } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorDocument } from "../../domain/workspace";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import {
  EditorPanelDocumentsContext,
  useEditorPanelDocumentsValue,
} from "./EditorPanelDocumentsContext";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let mounted: MountedUi | null = null;
const NO_STATUSES = Object.freeze({});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const StripConsumer = memo(function StripConsumer({ onRender }: { onRender(): void }) {
  useContext(EditorPanelDocumentsContext);
  onRender();
  return null;
});

function Host({ content, onStripRender }: { readonly content: string; onStripRender(): void }) {
  const value = useEditorPanelDocumentsValue({
    ownerKey: "/w",
    group: { activePath: "/w/large.ts", openPaths: ["/w/large.ts", "/w/b.ts"], previewPath: null },
    documents: [
      {
        path: "/w/large.ts",
        name: "large.ts",
        content,
        savedContent: "x",
        language: "typescript",
      } satisfies EditorDocument,
      {
        path: "/w/b.ts",
        name: "b.ts",
        content: "b",
        savedContent: "b",
        language: "typescript",
      } satisfies EditorDocument,
    ],
    onActivate: () => undefined,
    onClose: () => undefined,
    onOpenFile: () => undefined,
    onEmpty: () => undefined,
    onPin: () => undefined,
    fileStatusesByPath: NO_STATUSES,
  });
  return (
    <EditorPanelDocumentsContext.Provider value={value}>
      <StripConsumer onRender={onStripRender} />
    </EditorPanelDocumentsContext.Provider>
  );
}

describe("editor panel render work per keystroke", () => {
  it("re-renders the tab strip consumer once for the first dirty flip and never for 200 further keystrokes", () => {
    const onStripRender = vi.fn();
    const base = "x".repeat(300_000);
    mounted = mountUi();
    mounted.render(<Host content="x" onStripRender={onStripRender} />);
    for (let index = 0; index < 200; index += 1) {
      mounted.render(<Host content={`${base}${index}`} onStripRender={onStripRender} />);
    }

    expect(onStripRender).toHaveBeenCalledTimes(2);
  });
});
