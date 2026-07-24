import { describe, expect, it } from "vitest";
import { createDebugVariablePagesState } from "../domain/debugVariablePages";
import { createDebugInlineValueContext } from "./debugInlineValueContext";

const owner = { rootKey: "/workspace", sessionId: 7, pauseGeneration: 3, frameId: 12 };
const snapshot = {
  lastSeq: 4,
  state: {
    kind: "stopped" as const,
    sessionId: 7,
    reason: "breakpoint" as const,
    topFrame: {
      frameId: 11,
      name: "top",
      filePath: "/workspace/top.ts",
      lineNumber: 2,
      column: 1,
    },
    frames: [
      {
        frameId: 11,
        name: "top",
        filePath: "/workspace/top.ts",
        lineNumber: 2,
        column: 1,
      },
      {
        frameId: 12,
        name: "caller",
        filePath: "/workspace/caller.ts",
        lineNumber: 9,
        column: 3,
      },
    ],
  },
};

describe("createDebugInlineValueContext", () => {
  it("uses the exact inspection-owner frame rather than the top frame", () => {
    expect(
      createDebugInlineValueContext({
        debugAdapterKind: "node",
        isWorkspaceTrusted: true,
        inspectionOwner: owner,
        scopes: [],
        snapshot,
        variablePages: createDebugVariablePagesState(owner),
      }),
    ).toEqual(expect.objectContaining({ filePath: "/workspace/caller.ts", lineNumber: 9, owner }));
  });

  it("fails closed after resume, for another adapter, or when the frame is absent", () => {
    const base = {
      debugAdapterKind: "node" as const,
      isWorkspaceTrusted: true,
      inspectionOwner: owner,
      scopes: [],
      snapshot,
      variablePages: createDebugVariablePagesState(owner),
    };
    expect(
      createDebugInlineValueContext({
        ...base,
        snapshot: { lastSeq: 5, state: { kind: "running", sessionId: 7 } },
      }),
    ).toBeNull();
    expect(createDebugInlineValueContext({ ...base, debugAdapterKind: "php" })).toBeNull();
    expect(createDebugInlineValueContext({ ...base, isWorkspaceTrusted: false })).toBeNull();
    expect(
      createDebugInlineValueContext({
        ...base,
        inspectionOwner: { ...owner, sessionId: 8 },
      }),
    ).toBeNull();
    expect(
      createDebugInlineValueContext({
        ...base,
        inspectionOwner: { ...owner, frameId: 0 },
      }),
    ).toBeNull();
    expect(
      createDebugInlineValueContext({
        ...base,
        inspectionOwner: { ...owner, frameId: 99 },
      }),
    ).toBeNull();
  });
});
