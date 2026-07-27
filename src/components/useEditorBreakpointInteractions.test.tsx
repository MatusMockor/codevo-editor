// @vitest-environment jsdom

import { act, useState, type Dispatch, type SetStateAction } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Breakpoint, BreakpointCreationOwnership } from "../domain/debug";
import type { BreakpointHitCondition } from "../domain/debug";
import { useEditorBreakpointInteractions } from "./useEditorBreakpointInteractions";

describe("useEditorBreakpointInteractions", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const modelA = {};
  const modelB = {};
  const captured: { current: ReturnType<typeof useEditorBreakpointInteractions> | null } = {
    current: null,
  };
  let props = {
    activeDocumentPath: "/workspace/app.ts" as string | undefined,
    modelIdentity: modelA as object | null,
    workspaceRoot: "/workspace" as string | null,
  };
  const setCondition = vi.fn();
  const mutationError = vi.fn();
  const remove = vi.fn();
  const restoreFocus = vi.fn();
  const setHitCondition = vi.fn();
  const setLogMessage = vi.fn();
  let setList!: Dispatch<SetStateAction<Breakpoint[]>>;
  let currentBreakpoints: Breakpoint[] = [];
  let removeImplementation: (id: string) => void | Promise<void>;
  let setConditionImplementation: (id: string, condition: string | null) => void | Promise<void>;
  let setHitConditionImplementation: (
    id: string,
    hitCondition: BreakpointHitCondition | null,
  ) => void | Promise<void>;
  let setLogMessageImplementation: (id: string, logMessage: string | null) => void | Promise<void>;
  let toggleImplementation: (
    filePath: string,
    lineNumber: number,
  ) => BreakpointCreationOwnership | null | Promise<BreakpointCreationOwnership | null>;

  function Harness() {
    const [breakpoints, setBreakpoints] = useState<Breakpoint[]>([]);
    currentBreakpoints = breakpoints;
    setList = setBreakpoints;
    captured.current = useEditorBreakpointInteractions({
      ...props,
      breakpoints,
      onMutationError: mutationError,
      onRemoveBreakpoint: removeImplementation,
      onSetBreakpointCondition: setConditionImplementation,
      onSetBreakpointHitCondition: setHitConditionImplementation,
      onSetBreakpointLogMessage: setLogMessageImplementation,
      onToggleBreakpoint: toggleImplementation,
      hitConditionSupported: true,
      logMessageSupported: true,
      restoreFocus,
    });
    return null;
  }

  const render = () => act(() => root.render(<Harness />));
  const hook = () => captured.current!;
  const hookBreakpoints = () => currentBreakpoints;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    root = createRoot(host);
    props = {
      activeDocumentPath: "/workspace/app.ts",
      modelIdentity: modelA,
      workspaceRoot: "/workspace",
    };
    setCondition.mockClear();
    mutationError.mockClear();
    remove.mockClear();
    restoreFocus.mockClear();
    setHitCondition.mockClear();
    setLogMessage.mockClear();
    removeImplementation = (id) => {
      remove(id);
      setList((current) => current.filter((entry) => entry.id !== id));
    };
    setConditionImplementation = (id, condition) => {
      setCondition(id, condition);
      setList((current) =>
        current.map((entry) => (entry.id === id ? { ...entry, condition } : entry)),
      );
    };
    setHitConditionImplementation = (id, hitCondition) => {
      setHitCondition(id, hitCondition);
      setList((current) =>
        current.map((entry) => {
          if (entry.id !== id) return entry;
          if (hitCondition) return { ...entry, hitCondition };
          const { hitCondition: _removed, ...rest } = entry;
          return rest;
        }),
      );
    };
    setLogMessageImplementation = (id, logMessage) => {
      setLogMessage(id, logMessage);
      setList((current) =>
        current.map((entry) => {
          if (entry.id !== id) return entry;
          if (logMessage) return { ...entry, logMessage };
          const { logMessage: _removed, ...rest } = entry;
          return rest;
        }),
      );
    };
    toggleImplementation = (filePath, lineNumber) => {
      const breakpointId = `bp-${lineNumber}`;
      setList((current) => [...current, { enabled: true, filePath, id: breakpointId, lineNumber }]);
      return {
        breakpointId,
        filePath,
        isCurrent: () => true,
        lineNumber,
        rollback: () => setList((current) => current.filter((entry) => entry.id !== breakpointId)),
      };
    };
    render();
  });
  afterEach(() => act(() => root.unmount()));

  it("creates, edits, clears and removes through breakpoint domain callbacks", async () => {
    act(() => hook().open("/workspace/app.ts", 3, { x: 1, y: 2 }));
    act(() => hook().edit());
    let create!: Promise<boolean>;
    act(() => {
      create = hook().save("count > 2");
    });
    await act(async () => expect(await create).toBe(true));
    expect(setCondition).toHaveBeenLastCalledWith("bp-3", "count > 2");
    act(() => hook().open("/workspace/app.ts", 3, { x: 1, y: 2 }));
    expect(hook().popover?.breakpoint?.condition).toBe("count > 2");
    act(() => hook().edit());
    let clear!: Promise<boolean>;
    act(() => {
      clear = hook().save("");
    });
    await act(async () => void (await clear));
    expect(setCondition).toHaveBeenLastCalledWith("bp-3", null);
    act(() => hook().open("/workspace/app.ts", 3, { x: 1, y: 2 }));
    act(() => hook().remove());
    expect(remove).toHaveBeenCalledWith("bp-3");
  });

  it("targets an exact inline breakpoint ID while keeping the line breakpoint separate", () => {
    act(() =>
      setList([
        { enabled: true, filePath: "/workspace/app.ts", id: "line", lineNumber: 3 },
        {
          columnNumber: 7,
          enabled: true,
          filePath: "/workspace/app.ts",
          id: "inline-a",
          lineNumber: 3,
        },
        {
          columnNumber: 11,
          enabled: true,
          filePath: "/workspace/app.ts",
          id: "inline-b",
          lineNumber: 3,
        },
      ]),
    );

    act(() => hook().open("/workspace/app.ts", 3, { x: 1, y: 2 }, 11));
    expect(hook().popover).toMatchObject({
      breakpoint: { id: "inline-b" },
      columnNumber: 11,
      lineNumber: 3,
    });
    act(() => hook().remove());
    expect(remove).toHaveBeenCalledWith("inline-b");

    act(() => hook().open("/workspace/app.ts", 3, { x: 1, y: 2 }, 8));
    expect(hook().popover).toBeNull();

    act(() => hook().open("/workspace/app.ts", 3, { x: 1, y: 2 }));
    expect(hook().popover?.breakpoint?.id).toBe("line");
  });

  it("creates, edits and clears hit counts without replacing the expression condition", async () => {
    act(() =>
      setList([
        {
          condition: "count > 2",
          enabled: true,
          filePath: "/workspace/app.ts",
          id: "existing",
          lineNumber: 3,
        },
      ]),
    );
    act(() => hook().open("/workspace/app.ts", 3, { x: 1, y: 2 }));
    act(() => hook().edit("hitCondition"));
    await act(async () => expect(await hook().save(">=5")).toBe(true));
    expect(setHitCondition).toHaveBeenLastCalledWith("existing", {
      count: 5,
      kind: "greaterOrEqual",
    });
    expect(hook().popover).toBeNull();

    act(() => hook().open("/workspace/app.ts", 3, { x: 1, y: 2 }));
    expect(hook().popover?.breakpoint).toMatchObject({
      condition: "count > 2",
      hitCondition: { count: 5, kind: "greaterOrEqual" },
    });
    act(() => hook().edit("hitCondition"));
    await act(async () => expect(await hook().save("")).toBe(true));
    expect(setHitCondition).toHaveBeenLastCalledWith("existing", null);
    expect(setCondition).not.toHaveBeenCalled();
  });

  it("creates a typed hit-count breakpoint and rejects malformed input", async () => {
    act(() => hook().open("/workspace/app.ts", 8, { x: 1, y: 2 }));
    act(() => hook().edit("hitCondition"));
    await act(async () => expect(await hook().save("0")).toBe(false));
    expect(setHitCondition).not.toHaveBeenCalled();

    let create!: Promise<boolean>;
    act(() => void (create = hook().save("%3")));
    await act(async () => expect(await create).toBe(true));
    expect(setHitCondition).toHaveBeenCalledWith("bp-8", { count: 3, kind: "multiple" });
  });

  it("creates, edits, removes and rolls back logpoints without losing composed fields", async () => {
    act(() =>
      setList([
        {
          condition: "ready",
          enabled: true,
          filePath: "/workspace/app.ts",
          hitCondition: { count: 3, kind: "multiple" },
          id: "existing",
          lineNumber: 3,
          logMessage: "old={value}",
        },
      ]),
    );
    act(() => hook().open("/workspace/app.ts", 3, { x: 1, y: 2 }));
    act(() => hook().edit("logMessage"));
    await act(async () => expect(await hook().save("new={value}")).toBe(true));
    expect(setLogMessage).toHaveBeenCalledWith("existing", "new={value}");
    expect(hookBreakpoints()[0]).toMatchObject({
      condition: "ready",
      hitCondition: { count: 3, kind: "multiple" },
      logMessage: "new={value}",
    });

    act(() => hook().open("/workspace/app.ts", 3, { x: 1, y: 2 }));
    act(() => hook().removeLogpoint());
    expect(setLogMessage).toHaveBeenLastCalledWith("existing", null);

    setLogMessageImplementation = async () => {
      throw new Error("configure failed");
    };
    render();
    act(() => hook().open("/workspace/app.ts", 9, { x: 1, y: 2 }));
    act(() => hook().edit("logMessage"));
    await act(async () => expect(await hook().save("value={value}")).toBe(false));
    expect(hookBreakpoints().some((entry) => entry.lineNumber === 9)).toBe(false);
    expect(mutationError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "configure failed" }),
    );
  });

  it("reports rejected remove actions without leaving an unhandled promise", async () => {
    const removeError = new Error("remove failed");
    const clearError = new Error("clear failed");
    removeImplementation = async () => {
      throw removeError;
    };
    setLogMessageImplementation = async () => {
      throw clearError;
    };
    render();
    act(() =>
      setList([
        {
          enabled: true,
          filePath: "/workspace/app.ts",
          id: "existing",
          lineNumber: 3,
          logMessage: "value={value}",
        },
      ]),
    );

    act(() => hook().open("/workspace/app.ts", 3, { x: 1, y: 2 }));
    act(() => hook().remove());
    await act(async () => Promise.resolve());
    act(() => hook().open("/workspace/app.ts", 3, { x: 1, y: 2 }));
    act(() => hook().removeLogpoint());
    await act(async () => Promise.resolve());

    expect(mutationError).toHaveBeenNthCalledWith(1, removeError);
    expect(mutationError).toHaveBeenNthCalledWith(2, clearError);
  });

  it("rejects empty and malformed messages when creating a logpoint", async () => {
    act(() => hook().open("/workspace/app.ts", 11, { x: 1, y: 2 }));
    act(() => hook().edit("logMessage"));
    await act(async () => expect(await hook().save("")).toBe(false));
    await act(async () => expect(await hook().save("broken={")).toBe(false));
    expect(setLogMessage).not.toHaveBeenCalled();
    expect(hookBreakpoints().some((entry) => entry.lineNumber === 11)).toBe(false);
  });

  it("rolls back a pending logpoint create after root and model replacement", async () => {
    const creation = deferred<BreakpointCreationOwnership>();
    const rollback = vi.fn();
    toggleImplementation = () => creation.promise;
    render();
    act(() => hook().open("/workspace/app.ts", 12, { x: 1, y: 2 }));
    act(() => hook().edit("logMessage"));
    let save!: Promise<boolean>;
    act(() => void (save = hook().save("value={value}")));
    props = { ...props, modelIdentity: modelB, workspaceRoot: "/other" };
    render();
    await expect(save).resolves.toBe(false);
    await act(async () =>
      creation.resolve({
        breakpointId: "log-12",
        filePath: "/workspace/app.ts",
        isCurrent: () => true,
        lineNumber: 12,
        rollback,
      }),
    );
    await act(async () => new Promise<void>((resolve) => window.setTimeout(resolve, 0)));
    expect(rollback).toHaveBeenCalledOnce();
    expect(setLogMessage).not.toHaveBeenCalled();
    expect(restoreFocus).not.toHaveBeenCalled();
  });

  it("cleans stale popovers on model, document and root changes", () => {
    act(() => hook().open("/workspace/app.ts", 3, { x: 1, y: 2 }));
    expect(hook().popover).not.toBeNull();
    props = { ...props, modelIdentity: modelB };
    render();
    expect(hook().popover).toBeNull();
    act(() => hook().open("/workspace/app.ts", 3, { x: 1, y: 2 }));
    props = { ...props, activeDocumentPath: "/workspace/other.ts" };
    render();
    expect(hook().popover).toBeNull();
    props = { ...props, activeDocumentPath: "/workspace/app.ts", workspaceRoot: "/other" };
    render();
    expect(hook().popover).toBeNull();
  });

  it("cleans a no-op create so a later plain breakpoint gets no stale condition", async () => {
    toggleImplementation = async () => null;
    render();
    act(() => hook().open("/workspace/app.ts", 4, { x: 1, y: 2 }));
    act(() => hook().edit());
    let create!: Promise<boolean>;
    act(() => {
      create = hook().save("stale > 0");
    });
    await act(async () => expect(await create).toBe(false));
    act(() =>
      setList([{ enabled: true, filePath: "/workspace/app.ts", id: "plain", lineNumber: 4 }]),
    );
    expect(setCondition).not.toHaveBeenCalled();
  });

  it("invalidates an older pending create when another line is opened", async () => {
    const a = deferred<void>();
    const b = deferred<void>();
    toggleImplementation = async (filePath, lineNumber) => {
      await (lineNumber === 3 ? a.promise : b.promise);
      setList((current) => [
        ...current,
        { enabled: true, filePath, id: `bp-${lineNumber}`, lineNumber },
      ]);
      return {
        breakpointId: `bp-${lineNumber}`,
        filePath,
        isCurrent: () => true,
        lineNumber,
        rollback: () =>
          setList((current) => current.filter((entry) => entry.id !== `bp-${lineNumber}`)),
      };
    };
    render();
    act(() => hook().open("/workspace/app.ts", 3, { x: 1, y: 2 }));
    act(() => hook().edit());
    let createA!: Promise<boolean>;
    act(() => void (createA = hook().save("a > 0")));
    act(() => hook().open("/workspace/app.ts", 7, { x: 1, y: 2 }));
    act(() => hook().edit());
    let createB!: Promise<boolean>;
    act(() => void (createB = hook().save("b > 0")));
    await act(async () => b.resolve());
    await act(async () => expect(await createB).toBe(true));
    await act(async () => a.resolve());
    await act(async () => expect(await createA).toBe(false));
    expect(setCondition).toHaveBeenCalledWith("bp-7", "b > 0");
    expect(setCondition).not.toHaveBeenCalledWith("bp-3", "a > 0");
    expect(restoreFocus).toHaveBeenCalledTimes(1);
  });

  it("does not apply or refocus after a pending create is closed", async () => {
    const toggle = deferred<BreakpointCreationOwnership>();
    const rollback = vi.fn(() =>
      setList((current) => current.filter((entry) => entry.id !== "bp-3")),
    );
    toggleImplementation = async (filePath, lineNumber) => {
      const ownership = await toggle.promise;
      setList((current) => [
        ...current,
        { enabled: true, filePath, id: `bp-${lineNumber}`, lineNumber },
      ]);
      return ownership;
    };
    render();
    act(() => hook().open("/workspace/app.ts", 3, { x: 1, y: 2 }));
    act(() => hook().edit());
    let create!: Promise<boolean>;
    act(() => void (create = hook().save("count > 0")));
    act(() => hook().close());
    await expect(create).resolves.toBe(false);
    expect(restoreFocus).toHaveBeenCalledTimes(1);
    await act(async () =>
      toggle.resolve({
        breakpointId: "bp-3",
        filePath: "/workspace/app.ts",
        isCurrent: () => true,
        lineNumber: 3,
        rollback,
      }),
    );
    await act(async () => new Promise<void>((resolve) => window.setTimeout(resolve, 0)));
    expect(setCondition).not.toHaveBeenCalled();
    expect(rollback).toHaveBeenCalledOnce();
    expect(hookBreakpoints()).toEqual([]);
    expect(restoreFocus).toHaveBeenCalledTimes(1);
  });

  it("rolls back its exact created breakpoint when hit-count configuration fails", async () => {
    setHitConditionImplementation = async () => {
      throw new Error("sync failed");
    };
    render();
    act(() => hook().open("/workspace/app.ts", 8, { x: 1, y: 2 }));
    act(() => hook().edit("hitCondition"));
    await act(async () => expect(await hook().save(">=2")).toBe(false));
    expect(hookBreakpoints()).toEqual([]);
    expect(mutationError).toHaveBeenCalledWith(expect.objectContaining({ message: "sync failed" }));
  });

  it("keeps ownership when verification relocates the created breakpoint", async () => {
    toggleImplementation = async (filePath, lineNumber) => {
      setList([
        { enabled: true, filePath, id: "relocated", lineNumber: lineNumber + 1, verified: true },
      ]);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      return {
        breakpointId: "relocated",
        filePath,
        isCurrent: () => true,
        lineNumber,
        rollback: vi.fn(),
      };
    };
    render();
    act(() => hook().open("/workspace/app.ts", 8, { x: 1, y: 2 }));
    act(() => hook().edit("hitCondition"));
    let result = false;
    await act(async () => {
      result = await hook().save(">=2");
    });
    expect(setHitCondition).toHaveBeenCalledWith("relocated", {
      count: 2,
      kind: "greaterOrEqual",
    });
    expect(result).toBe(true);
  });

  it("does not apply or refocus again after a pending existing save is closed", async () => {
    act(() =>
      setList([{ enabled: true, filePath: "/workspace/app.ts", id: "existing", lineNumber: 3 }]),
    );
    act(() => hook().open("/workspace/app.ts", 3, { x: 1, y: 2 }));
    act(() => hook().edit());
    let save!: Promise<boolean>;
    act(() => void (save = hook().save("count > 0")));
    act(() => hook().close());
    await expect(save).resolves.toBe(false);
    expect(setCondition).not.toHaveBeenCalled();
    expect(restoreFocus).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending create on root or model replacement", async () => {
    const toggle = deferred<BreakpointCreationOwnership>();
    toggleImplementation = () => toggle.promise;
    render();
    act(() => hook().open("/workspace/app.ts", 3, { x: 1, y: 2 }));
    act(() => hook().edit());
    let create!: Promise<boolean>;
    act(() => void (create = hook().save("count > 0")));
    props = { ...props, modelIdentity: modelB, workspaceRoot: "/other" };
    render();
    await expect(create).resolves.toBe(false);
    await act(async () =>
      toggle.resolve({
        breakpointId: "bp-3",
        filePath: "/workspace/app.ts",
        isCurrent: () => true,
        lineNumber: 3,
        rollback: vi.fn(),
      }),
    );
    expect(setCondition).not.toHaveBeenCalled();
    expect(restoreFocus).not.toHaveBeenCalled();
  });

  it("does not begin an existing edit after a root and model replacement", async () => {
    act(() =>
      setList([{ enabled: true, filePath: "/workspace/app.ts", id: "existing", lineNumber: 3 }]),
    );
    act(() => hook().open("/workspace/app.ts", 3, { x: 1, y: 2 }));
    act(() => hook().edit());
    let save!: Promise<boolean>;
    act(() => void (save = hook().save("count > 0")));
    props = { ...props, modelIdentity: modelB, workspaceRoot: "/other" };
    render();
    await expect(save).resolves.toBe(false);
    expect(setCondition).not.toHaveBeenCalled();
    expect(restoreFocus).not.toHaveBeenCalled();
  });

  it("does not apply a hit-count edit after a root and model replacement", async () => {
    act(() =>
      setList([{ enabled: true, filePath: "/workspace/app.ts", id: "existing", lineNumber: 3 }]),
    );
    act(() => hook().open("/workspace/app.ts", 3, { x: 1, y: 2 }));
    act(() => hook().edit("hitCondition"));
    let save!: Promise<boolean>;
    act(() => void (save = hook().save(">=2")));
    props = { ...props, modelIdentity: modelB, workspaceRoot: "/other" };
    render();
    await expect(save).resolves.toBe(false);
    expect(setHitCondition).not.toHaveBeenCalled();
    expect(restoreFocus).not.toHaveBeenCalled();
  });

  it("does not refocus when an existing edit completes after context changes", async () => {
    const condition = deferred<void>();
    setConditionImplementation = async (id, value) => {
      setCondition(id, value);
      await condition.promise;
    };
    render();
    act(() =>
      setList([{ enabled: true, filePath: "/workspace/app.ts", id: "existing", lineNumber: 3 }]),
    );
    act(() => hook().open("/workspace/app.ts", 3, { x: 1, y: 2 }));
    act(() => hook().edit());
    let save!: Promise<boolean>;
    act(() => void (save = hook().save("count > 0")));
    await act(async () => Promise.resolve());
    expect(setCondition).toHaveBeenCalledWith("existing", "count > 0");
    props = { ...props, modelIdentity: modelB, workspaceRoot: "/other" };
    render();
    await act(async () => condition.resolve());
    await expect(save).resolves.toBe(false);
    expect(restoreFocus).not.toHaveBeenCalled();
  });

  it("does not begin an existing edit after unmount", async () => {
    act(() =>
      setList([{ enabled: true, filePath: "/workspace/app.ts", id: "existing", lineNumber: 3 }]),
    );
    act(() => hook().open("/workspace/app.ts", 3, { x: 1, y: 2 }));
    act(() => hook().edit());
    let save!: Promise<boolean>;
    act(() => void (save = hook().save("count > 0")));
    act(() => root.unmount());
    await expect(save).resolves.toBe(false);
    expect(setCondition).not.toHaveBeenCalled();
    expect(restoreFocus).not.toHaveBeenCalled();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}
