// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { DebugVariable } from "../domain/debug";
import type { DebugInspectionOwner, DebugVariablePagesState } from "../domain/debugVariablePages";
import { createDebugVariablePagesState } from "../domain/debugVariablePages";
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
            variables: [{ name: "child", value: "old", variablesReference: 0, canSetValue: true }],
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
  const loadVariablePage = vi.fn().mockResolvedValue(undefined);
  const variablePagesRef = { current: initialState() };
  const captured: { rows: ReturnType<typeof useDebugVariableMutationRows> | null } = {
    rows: null,
  };
  const host = document.createElement("div");
  const root = createRoot(host);
  function Harness() {
    captured.rows = useDebugVariableMutationRows({
      loadVariablePage,
      setVariable: async (...args) => {
        try {
          const result = await setVariable(...args);
          if (result) variablePagesRef.current = createDebugVariablePagesState(owner);
          return result;
        } catch (error) {
          variablePagesRef.current = createDebugVariablePagesState(owner);
          throw error;
        }
      },
      variablePagesRef,
    });
    return null;
  }
  act(() => root.render(<Harness />));
  return {
    loadVariablePage,
    select: () => captured.rows!.forRow(owner, 20, 0, 0),
    selectNested: () => captured.rows!.forRow(owner, 30, 0, 0),
    setVariable,
    unmount: () => act(() => root.unmount()),
    variablePagesRef,
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
    expect(ui.variablePagesRef.current.references[20]).toBeUndefined();
    expect(ui.variablePagesRef.current.references[30]).toBeUndefined();
    expect(ui.loadVariablePage).toHaveBeenCalledWith(owner, 20, 0, "named");
    await Promise.resolve();
    expect(ui.loadVariablePage).toHaveBeenCalledWith(owner, 20, 0, "indexed");
    ui.unmount();
  });

  it("invalidates unrelated roots after a dispatched nested mutation", async () => {
    const ui = renderRows();
    const row = ui.selectNested();
    const result = {
      name: "child",
      value: "new",
      variablesReference: 0,
      canSetValue: true as const,
    };
    ui.setVariable.mockResolvedValueOnce(result);

    await expect(row?.commit("new")).resolves.toEqual(result);

    expect(ui.variablePagesRef.current.references).toEqual({});
    ui.unmount();
  });

  it("returns the verified reply but invalidates the whole owner after row identity drifts", async () => {
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
    await expect(pending).resolves.toEqual({
      name: "count",
      value: "43",
      variablesReference: 0,
    });
    expect(ui.variablePagesRef.current.references).toEqual({});
    ui.unmount();
  });

  it("preserves cache on pre-dispatch null but invalidates after a dispatched error", async () => {
    const ui = renderRows();
    const row = ui.select()!;
    const before = ui.variablePagesRef.current;
    ui.setVariable.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("rejected"));
    await expect(row.commit("43")).resolves.toBeNull();
    expect(ui.variablePagesRef.current).toBe(before);
    await expect(row.commit("44")).rejects.toThrow("rejected");
    expect(ui.variablePagesRef.current.references).toEqual({});
    expect(ui.loadVariablePage).toHaveBeenCalledWith(owner, 20, 0, "named");
    ui.unmount();
  });
});
