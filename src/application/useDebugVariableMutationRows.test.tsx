// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { DebugVariable } from "../domain/debug";
import type { DebugInspectionOwner, DebugVariablePagesState } from "../domain/debugVariablePages";
import { useDebugVariableMutationRows } from "./useDebugVariableMutationRows";

const owner: DebugInspectionOwner = {
  rootKey: "/workspace",
  sessionId: 1,
  pauseGeneration: 2,
  frameId: 3,
};

function initialState(): DebugVariablePagesState {
  return {
    owner,
    references: {
      20: {
        pages: {
          0: {
            start: 0,
            variables: [{ name: "count", value: "42", variablesReference: 30, canSetValue: true }],
            nextStart: null,
          },
        },
        pending: {},
        errors: {},
        limit: null,
      },
      30: {
        pages: {
          0: {
            start: 0,
            variables: [{ name: "child", value: "old", variablesReference: 0 }],
            nextStart: null,
          },
        },
        pending: {},
        errors: {},
        limit: null,
      },
    },
    pendingCount: 0,
    totalVariables: 2,
    totalBytes: 15,
  };
}

function renderRows() {
  const setVariable =
    vi.fn<(reference: number, name: string, value: string) => Promise<DebugVariable | null>>();
  const variablePagesRef = { current: initialState() };
  const variablePageRequestsRef = { current: new Map<string, string>() };
  const captured: { rows: ReturnType<typeof useDebugVariableMutationRows> | null } = {
    rows: null,
  };
  const host = document.createElement("div");
  const root = createRoot(host);
  function Harness() {
    captured.rows = useDebugVariableMutationRows({
      setVariable,
      setVariablePages: (next) => {
        variablePagesRef.current =
          typeof next === "function" ? next(variablePagesRef.current) : next;
      },
      variablePageRequestsRef,
      variablePagesRef,
    });
    return null;
  }
  act(() => root.render(<Harness />));
  return {
    select: () => captured.rows!.forRow(owner, 20, 0, 0),
    setVariable,
    unmount: () => act(() => root.unmount()),
    variablePagesRef,
    variablePageRequestsRef,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("useDebugVariableMutationRows", () => {
  it("exposes only a row-bound value/commit closure and reconciles after current success", async () => {
    const ui = renderRows();
    const row = ui.select();
    const result = {
      name: "count",
      value: "43",
      variablesReference: 40,
      canSetValue: true as const,
    };
    ui.setVariable.mockResolvedValueOnce(result);
    expect(Object.keys(row ?? {}).sort()).toEqual(["commit", "currentValue"]);
    expect(row?.currentValue).toBe("42");
    await expect(row?.commit("43")).resolves.toEqual(result);
    expect(ui.setVariable).toHaveBeenCalledExactlyOnceWith(20, "count", "43");
    expect(ui.variablePagesRef.current.references[20]?.pages[0]?.variables[0]).toEqual(result);
    expect(ui.variablePagesRef.current.references[30]).toBeUndefined();
    ui.unmount();
  });

  it("does not patch or return a reply after the exact row identity drifts", async () => {
    const ui = renderRows();
    const row = ui.select()!;
    const reply = deferred<DebugVariable | null>();
    ui.setVariable.mockReturnValueOnce(reply.promise);
    const pending = row.commit("43");
    const before = ui.variablePagesRef.current;
    ui.variablePagesRef.current = {
      ...before,
      references: {
        ...before.references,
        20: {
          ...before.references[20]!,
          pages: {
            0: {
              ...before.references[20]!.pages[0]!,
              variables: [{ name: "count", value: "foreign", variablesReference: 0 }],
            },
          },
        },
      },
    };
    reply.resolve({ name: "count", value: "43", variablesReference: 0 });
    await expect(pending).resolves.toBeNull();
    expect(ui.variablePagesRef.current.references[20]?.pages[0]?.variables[0]?.value).toBe(
      "foreign",
    );
    ui.unmount();
  });

  it("does not patch on null or adapter error", async () => {
    const ui = renderRows();
    const row = ui.select()!;
    const before = ui.variablePagesRef.current;
    ui.setVariable.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("rejected"));
    await expect(row.commit("43")).resolves.toBeNull();
    expect(ui.variablePagesRef.current).toBe(before);
    await expect(row.commit("44")).rejects.toThrow("rejected");
    expect(ui.variablePagesRef.current).toBe(before);
    ui.unmount();
  });
});
