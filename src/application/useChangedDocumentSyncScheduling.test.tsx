// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { EditorDocument } from "../domain/workspace";
import { useEditorSessionState, type EditorSessionState } from "./useEditorSessionState";
import { useChangedDocumentSyncScheduling } from "./useChangedDocumentSyncScheduling";
import type { JavaScriptTypeScriptIncrementalLegacyClaim } from "./javaScriptTypeScriptIncrementalSyncProduction";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const editorDocument = (root: string, name: string): EditorDocument => ({
  content: name,
  language: "php",
  name,
  path: `${root}/${name}`,
  savedContent: name,
});

describe("useChangedDocumentSyncScheduling", () => {
  it("schedules one changed document out of many in constant-time lookup", () => {
    const a = editorDocument("/workspace", "a.php");
    const b = {
      ...editorDocument("/workspace", "b.ts"),
      language: "typescript",
    };
    const c = editorDocument("/workspace", "c.php");
    const harness = renderHarness();

    act(() => {
      harness.session().setDocuments({
        [a.path]: a,
        [b.path]: b,
        [c.path]: c,
      });
      harness.session().reportChangedDocuments([b.path]);
    });

    expect(harness.schedulePhp).toHaveBeenCalledOnce();
    expect(harness.schedulePhp).toHaveBeenCalledWith(b);
    expect(harness.scheduleJavaScriptTypeScript).toHaveBeenCalledOnce();
    expect(harness.scheduleJavaScriptTypeScript).toHaveBeenCalledWith(b);
    harness.unmount();
  });

  it("schedules every document in a programmatic multi-file batch", () => {
    const a = editorDocument("/workspace", "a.php");
    const b = editorDocument("/workspace", "b.php");
    const harness = renderHarness();

    act(() => {
      harness.session().setDocuments({ [a.path]: a, [b.path]: b });
      harness.session().reportChangedDocuments([a.path, b.path]);
    });

    expect(harness.schedulePhp.mock.calls.map(([value]) => value.path)).toEqual([a.path, b.path]);
    expect(harness.scheduleJavaScriptTypeScript.mock.calls.map(([value]) => value.path)).toEqual([
      a.path,
      b.path,
    ]);
    harness.unmount();
  });

  it("does not replay an A event after an A to B to A document replacement", () => {
    const firstA = editorDocument("/workspace-a", "first.php");
    const b = editorDocument("/workspace-b", "b.php");
    const nextA = editorDocument("/workspace-a", "next.php");
    const harness = renderHarness();

    act(() => {
      harness.session().setDocuments({ [firstA.path]: firstA });
      harness.session().reportChangedDocuments([firstA.path]);
      harness.session().setDocuments({ [b.path]: b });
      harness.session().setDocuments({ [nextA.path]: nextA });
    });

    expect(harness.schedulePhp).toHaveBeenCalledTimes(1);
    expect(harness.schedulePhp).toHaveBeenCalledWith(firstA);
    harness.unmount();
  });

  it("suppresses only an exact incrementally admitted revision", async () => {
    const document = {
      ...editorDocument("/workspace", "server.ts"),
      language: "typescript" as const,
    };
    const claim = deferredClaim(7);
    const harness = renderHarness(() => claim.value);

    act(() => {
      harness.session().setDocuments({ [document.path]: document });
      harness.session().reportChangedDocuments([document.path]);
    });
    expect(harness.schedulePhp).toHaveBeenCalledWith(document);
    expect(harness.scheduleJavaScriptTypeScript).not.toHaveBeenCalled();

    await act(async () => {
      claim.resolve(true);
      await claim.settled;
    });
    expect(harness.scheduleJavaScriptTypeScript).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("falls back once with the captured latest document after rejection", async () => {
    const document = {
      ...editorDocument("/workspace", "server.ts"),
      content: "latest snapshot",
      language: "typescript" as const,
    };
    const claim = deferredClaim(8);
    const harness = renderHarness(() => claim.value);

    act(() => {
      harness.session().setDocuments({ [document.path]: document });
      harness.session().reportChangedDocuments([document.path]);
      harness.session().setDocuments({
        [document.path]: { ...document, content: "newer snapshot" },
      });
    });
    await act(async () => {
      claim.resolve(false);
      await claim.settled;
    });

    expect(harness.scheduleJavaScriptTypeScript).toHaveBeenCalledOnce();
    expect(harness.scheduleJavaScriptTypeScript).toHaveBeenCalledWith({
      ...document,
      content: "newer snapshot",
    });
    harness.unmount();
  });
});

function renderHarness(
  claim?: (path: string) => JavaScriptTypeScriptIncrementalLegacyClaim | null,
) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { current: EditorSessionState | null } = { current: null };
  const schedulePhp = vi.fn<(document: EditorDocument) => void>();
  const scheduleJavaScriptTypeScript = vi.fn<(document: EditorDocument) => void>();

  function Probe() {
    const session = useEditorSessionState();
    captured.current = session;
    useChangedDocumentSyncScheduling({
      documentsRef: session.documentsRef,
      incrementalSyncRef: claim
        ? {
            current: {
              claimLegacyChange: claim,
            },
          }
        : undefined,
      scheduleDocumentChange: schedulePhp,
      scheduleJavaScriptTypeScriptDocumentChange: scheduleJavaScriptTypeScript,
      subscribeChangedDocuments: session.subscribeChangedDocuments,
    });
    return null;
  }

  act(() => root.render(<Probe />));

  return {
    scheduleJavaScriptTypeScript,
    schedulePhp,
    session: () => {
      if (!captured.current) {
        throw new Error("hook not mounted");
      }
      return captured.current;
    },
    unmount: () => act(() => root.unmount()),
  };
}

function deferredClaim(revision: number) {
  let settle!: (value: boolean) => void;
  const settled = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  return {
    resolve: settle,
    settled,
    value: Object.freeze({
      revision,
      suppressLegacy: () => settled,
    }),
  };
}
