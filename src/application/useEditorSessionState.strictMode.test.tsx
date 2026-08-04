// @vitest-environment jsdom

import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { LARGE_SMART_DOCUMENT_CHARACTER_LIMIT } from "../domain/largeDocumentPolicy";
import type { EditorDocument } from "../domain/workspace";
import { useEditorSessionState, type EditorSessionState } from "./useEditorSessionState";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const LARGE_PATH = "/workspace/large.ts";
const LARGE_CONTENT = "x".repeat(LARGE_SMART_DOCUMENT_CHARACTER_LIMIT + 1024);

function largeDirtyDocument(content: string): EditorDocument {
  return {
    content,
    language: "typescript",
    name: "large.ts",
    path: LARGE_PATH,
    savedContent: "saved",
  };
}

interface Harness {
  session: () => EditorSessionState;
  unmount: () => void;
}

function renderEditorSessionState(strictMode: boolean): Harness {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { current: EditorSessionState | null } = { current: null };

  function Probe() {
    captured.current = useEditorSessionState();
    return null;
  }

  act(() => {
    root.render(
      strictMode ? (
        <StrictMode>
          <Probe />
        </StrictMode>
      ) : (
        <Probe />
      ),
    );
  });

  return {
    session: () => captured.current as EditorSessionState,
    unmount: () => {
      act(() => root.unmount());
    },
  };
}

async function settleDebounce(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 180);
    });
  });
}

describe("useEditorSessionState under React StrictMode effect replay", () => {
  it("publishes a normal document update after a StrictMode mount replay", () => {
    const harness = renderEditorSessionState(true);

    act(() => {
      harness.session().setDocuments({ [LARGE_PATH]: largeDirtyDocument("small") });
    });

    expect(harness.session().documents[LARGE_PATH]?.content).toBe("small");
    harness.unmount();
  });

  it("publishes a policy-large content change after a StrictMode mount replay", async () => {
    const harness = renderEditorSessionState(true);

    act(() => {
      harness.session().setDocuments({ [LARGE_PATH]: largeDirtyDocument(LARGE_CONTENT) });
    });
    await settleDebounce();

    act(() => {
      harness.session().setDocuments({ [LARGE_PATH]: largeDirtyDocument(`${LARGE_CONTENT}a`) });
    });

    expect(harness.session().documents[LARGE_PATH]?.content).toBe(`${LARGE_CONTENT}a`);

    act(() => {
      harness.session().setDocuments({ [LARGE_PATH]: largeDirtyDocument(`${LARGE_CONTENT}ab`) });
    });
    await settleDebounce();

    expect(harness.session().documents[LARGE_PATH]?.content).toBe(`${LARGE_CONTENT}ab`);
    harness.unmount();
  });

  it("publishes the dirty transition of a policy-large document without waiting", () => {
    const harness = renderEditorSessionState(true);
    const clean: EditorDocument = {
      content: LARGE_CONTENT,
      language: "typescript",
      name: "large.ts",
      path: LARGE_PATH,
      savedContent: LARGE_CONTENT,
    };

    act(() => {
      harness.session().setDocuments({ [LARGE_PATH]: clean });
    });
    act(() => {
      harness.session().setDocuments({ [LARGE_PATH]: { ...clean, content: `${LARGE_CONTENT}a` } });
    });

    expect(harness.session().documents[LARGE_PATH]?.content).toBe(`${LARGE_CONTENT}a`);
    harness.unmount();
  });

  it("publishes a normal document update without StrictMode", () => {
    const harness = renderEditorSessionState(false);

    act(() => {
      harness.session().setDocuments({ [LARGE_PATH]: largeDirtyDocument("small") });
    });

    expect(harness.session().documents[LARGE_PATH]?.content).toBe("small");
    harness.unmount();
  });
});
