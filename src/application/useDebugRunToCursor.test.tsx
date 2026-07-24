// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { EditorDocument } from "../domain/workspace";
import type { DebugRunToLocationCandidate } from "./debugSessionContracts";
import { captureRunToCursor, useDebugRunToCursor } from "./useDebugRunToCursor";

const ROOT = "/workspace";

function document(overrides: Partial<EditorDocument> = {}): EditorDocument {
  return {
    content: "const answer = 42;",
    language: "typescript",
    name: "index.ts",
    path: `${ROOT}/src/index.ts`,
    savedContent: "const answer = 42;",
    ...overrides,
  };
}

describe("captureRunToCursor", () => {
  it("captures only clean writable JS/TS documents under the current root", () => {
    const captured = captureRunToCursor(
      ROOT,
      "workspace-1",
      document(),
      { lineNumber: 3, column: 7 },
      () => true,
      () => true,
    );
    expect(captured).toMatchObject({
      rootPath: ROOT,
      workspaceId: "workspace-1",
      filePath: `${ROOT}/src/index.ts`,
      lineNumber: 3,
      columnNumber: 7,
    });
    expect(
      captureRunToCursor(
        ROOT,
        "workspace-1",
        document({ path: `${ROOT}/src/component.jsx` }),
        { lineNumber: 1, column: 1 },
        () => true,
        () => true,
      ),
    ).not.toBeNull();

    for (const candidate of [
      document({ content: "dirty" }),
      document({ readOnly: true }),
      document({ path: "/workspace-other/src/index.ts" }),
      document({ path: `${ROOT}/src/types.d.ts` }),
      document({ path: `${ROOT}/src/index.php`, language: "php" }),
    ]) {
      expect(
        captureRunToCursor(
          ROOT,
          "workspace-1",
          candidate,
          { lineNumber: 1, column: 1 },
          () => true,
          () => true,
        ),
      ).toBeNull();
    }
  });

  it("fails closed for invalid cursor, trust, capability, and throwing guards", () => {
    expect(
      captureRunToCursor(
        ROOT,
        null,
        document(),
        { lineNumber: 1, column: 1 },
        () => true,
        () => true,
      ),
    ).toBeNull();
    for (const position of [
      null,
      { lineNumber: 0, column: 1 },
      { lineNumber: 1, column: 0 },
      { lineNumber: 1.5, column: 1 },
    ]) {
      expect(
        captureRunToCursor(
          ROOT,
          "workspace-1",
          document(),
          position,
          () => true,
          () => true,
        ),
      ).toBeNull();
    }
    expect(
      captureRunToCursor(
        ROOT,
        "workspace-1",
        document(),
        { lineNumber: 1, column: 1 },
        () => false,
        () => true,
      ),
    ).toBeNull();
    expect(
      captureRunToCursor(
        ROOT,
        "workspace-1",
        document(),
        { lineNumber: 1, column: 1 },
        () => true,
        () => false,
      ),
    ).toBeNull();
    expect(
      captureRunToCursor(
        ROOT,
        "workspace-1",
        document(),
        { lineNumber: 1, column: 1 },
        () => {
          throw new Error("trust");
        },
        () => true,
      ),
    ).toBeNull();
  });
});

describe("useDebugRunToCursor", () => {
  it("rechecks document version, cursor, workspace, and trust before session dispatch", async () => {
    const activeDocumentRef = { current: document() };
    const activeEditorPositionRef = { current: { lineNumber: 2, column: 4 } };
    const currentWorkspaceRootRef = { current: ROOT };
    const runToLocation = vi.fn<(candidate: DebugRunToLocationCandidate) => Promise<boolean>>(
      async () => true,
    );
    const reportWarning = vi.fn();
    let api!: ReturnType<typeof useDebugRunToCursor>;
    const host = documentNode();
    const root = createRoot(host);
    function Harness() {
      api = useDebugRunToCursor({
        activeDocumentRef,
        activeEditorPositionRef,
        canRunToLocation: () => true,
        currentWorkspaceRootRef,
        isWorkspaceTrusted: () => true,
        reportWarning,
        runToLocation,
        workspaceId: "workspace-1",
      });
      return null;
    }
    act(() => root.render(<Harness />));
    expect(api.canRunToCursor).toBe(true);

    await act(async () => void (await api.runToCursor()));
    const candidate = runToLocation.mock.calls[0]?.[0];
    expect(candidate).toMatchObject({
      filePath: `${ROOT}/src/index.ts`,
      lineNumber: 2,
      columnNumber: 4,
    });
    expect(candidate?.isCurrent()).toBe(true);
    activeDocumentRef.current = { ...activeDocumentRef.current };
    expect(candidate?.isCurrent()).toBe(false);
    expect(reportWarning).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("reports a bounded generic warning when the session request rejects", async () => {
    const reportWarning = vi.fn();
    let api!: ReturnType<typeof useDebugRunToCursor>;
    const root = createRoot(documentNode());
    function Harness() {
      api = useDebugRunToCursor({
        activeDocumentRef: { current: document() },
        activeEditorPositionRef: { current: { lineNumber: 1, column: 1 } },
        canRunToLocation: () => true,
        currentWorkspaceRootRef: { current: ROOT },
        isWorkspaceTrusted: () => true,
        reportWarning,
        runToLocation: vi.fn().mockRejectedValue(new Error("secret backend detail")),
        workspaceId: "workspace-1",
      });
      return null;
    }
    act(() => root.render(<Harness />));
    await act(async () => void (await api.runToCursor()));
    expect(reportWarning).toHaveBeenCalledExactlyOnceWith("Debug: unable to run to cursor.");
    act(() => root.unmount());
  });
});

function documentNode(): HTMLDivElement {
  return window.document.createElement("div");
}
