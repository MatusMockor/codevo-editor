// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DebugConsoleCompletionResponse } from "../domain/debugConsoleCompletions";
import type { DebugInspectionOwner } from "../domain/debugVariablePages";
import {
  useDebugConsoleCompletions,
  type UseDebugConsoleCompletionsOptions,
  type UseDebugConsoleCompletionsResult,
} from "./useDebugConsoleCompletions";

const owner: DebugInspectionOwner = {
  frameId: 11,
  pauseGeneration: 3,
  rootKey: "/workspace",
  sessionId: 7,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function response(...labels: string[]): DebugConsoleCompletionResponse {
  return {
    isIncomplete: false,
    items: labels.map((label) => ({ kind: "property", label })),
  };
}

function renderCompletionHook(initial: UseDebugConsoleCompletionsOptions) {
  const host = document.createElement("div");
  const root = createRoot(host);
  const captured: { current: UseDebugConsoleCompletionsResult | null } = { current: null };
  let options = initial;
  function Harness() {
    captured.current = useDebugConsoleCompletions(options);
    return null;
  }
  const render = () => act(() => root.render(<Harness />));
  render();
  return {
    get: () => captured.current as UseDebugConsoleCompletionsResult,
    set(next: Partial<UseDebugConsoleCompletionsOptions>) {
      options = { ...options, ...next };
      render();
    },
    unmount: () => act(() => root.unmount()),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("useDebugConsoleCompletions", () => {
  it("debounces automatic requests after a dot or two-character prefix", async () => {
    vi.useFakeTimers();
    const complete = vi.fn().mockResolvedValue(response("name"));
    const ui = renderCompletionHook({
      complete,
      debugAdapterKind: "node",
      inspectionOwner: owner,
      workspaceOwnerKey: "workspace-A",
    });

    act(() => ui.get().inputChanged({ cursor: 1, expression: "n" }));
    await act(async () => vi.advanceTimersByTime(200));
    expect(complete).not.toHaveBeenCalled();

    act(() => ui.get().inputChanged({ cursor: 2, expression: "na" }));
    expect(ui.get().model.pending).toBe(false);
    await act(async () => vi.advanceTimersByTime(119));
    expect(complete).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(complete).toHaveBeenCalledWith(owner, { kind: "lexical", prefix: "na" });

    act(() => ui.get().inputChanged({ cursor: 8, expression: "account." }));
    await act(async () => vi.advanceTimersByTime(120));
    expect(complete).toHaveBeenLastCalledWith(owner, {
      kind: "member",
      root: { kind: "binding", name: "account" },
      path: [],
      prefix: "",
    });
    ui.unmount();
  });

  it("runs Ctrl+Space requests immediately, including an empty input", async () => {
    const complete = vi.fn().mockResolvedValue(response("console"));
    const ui = renderCompletionHook({
      complete,
      debugAdapterKind: "node",
      inspectionOwner: owner,
      workspaceOwnerKey: "workspace-A",
    });

    await act(async () => ui.get().request({ cursor: 0, expression: "" }));
    expect(complete).toHaveBeenCalledExactlyOnceWith(owner, {
      kind: "lexical",
      prefix: "",
    });
    expect(ui.get().model.items.map(({ label }) => label)).toEqual(["console"]);
    ui.unmount();
  });

  it("is latest-wins for both request sequence and input revision", async () => {
    const first = deferred<DebugConsoleCompletionResponse | null>();
    const second = deferred<DebugConsoleCompletionResponse | null>();
    const complete = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const ui = renderCompletionHook({
      complete,
      debugAdapterKind: "node",
      inspectionOwner: owner,
      workspaceOwnerKey: "workspace-A",
    });

    act(() => ui.get().request({ cursor: 2, expression: "fi" }));
    act(() => ui.get().request({ cursor: 2, expression: "se" }));
    await act(async () => second.resolve(response("second")));
    expect(ui.get().model.items.map(({ label }) => label)).toEqual(["second"]);
    await act(async () => first.resolve(response("first")));
    expect(ui.get().model.items.map(({ label }) => label)).toEqual(["second"]);
    ui.unmount();
  });

  it("caps the surface at 100 and preserves adapter or local incompleteness", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce(response(...Array.from({ length: 101 }, (_, index) => `p${index}`)))
      .mockResolvedValueOnce({
        ...response("single"),
        isIncomplete: true,
      });
    const ui = renderCompletionHook({
      complete,
      debugAdapterKind: "node",
      inspectionOwner: owner,
      workspaceOwnerKey: "workspace-A",
    });

    await act(async () => ui.get().request({ cursor: 2, expression: "pr" }));
    expect(ui.get().model.items).toHaveLength(100);
    expect(ui.get().model.incomplete).toBe(true);
    await act(async () => ui.get().request({ cursor: 2, expression: "si" }));
    expect(ui.get().model.items).toHaveLength(1);
    expect(ui.get().model.incomplete).toBe(true);
    ui.unmount();
  });

  it("fails closed across workspace/root/session/pause/frame A-B-A changes", async () => {
    const pending = deferred<DebugConsoleCompletionResponse | null>();
    const complete = vi.fn().mockReturnValue(pending.promise);
    const ui = renderCompletionHook({
      complete,
      debugAdapterKind: "node",
      inspectionOwner: owner,
      workspaceOwnerKey: "workspace-A",
    });

    act(() => ui.get().request({ cursor: 2, expression: "na" }));
    ui.set({
      inspectionOwner: { ...owner, frameId: 12, rootKey: "/other", sessionId: 8 },
      workspaceOwnerKey: "workspace-B",
    });
    ui.set({ inspectionOwner: { ...owner }, workspaceOwnerKey: "workspace-A" });
    await act(async () => pending.resolve(response("stale")));
    expect(ui.get().model).toEqual({
      incomplete: false,
      items: [],
      pending: false,
      unavailable: null,
    });
    ui.unmount();
  });

  it("accepts only a current issued item using the domain replacement range", async () => {
    const ui = renderCompletionHook({
      complete: vi.fn().mockResolvedValue(response("displayName")),
      debugAdapterKind: "node",
      inspectionOwner: owner,
      workspaceOwnerKey: "workspace-A",
    });
    const input = { cursor: 10, expression: "account.di" };
    await act(async () => ui.get().request(input));
    const item = ui.get().model.items[0]!;

    expect(ui.get().accept(item, { ...input, expression: "account.dx" })).toBeNull();
    expect(ui.get().accept({ ...item, id: "forged" }, input)).toBeNull();
    let accepted: ReturnType<UseDebugConsoleCompletionsResult["accept"]> = null;
    act(() => {
      accepted = ui.get().accept(item, input);
    });
    expect(accepted).toEqual({
      cursor: 19,
      expression: "account.displayName",
    });
    expect(ui.get().model.items).toEqual([]);
    ui.unmount();
  });

  it("is unavailable without leaking errors and refuses non-Node or unowned requests", async () => {
    const complete = vi.fn().mockRejectedValue(new Error("secret adapter failure"));
    const ui = renderCompletionHook({
      complete,
      debugAdapterKind: "node",
      inspectionOwner: owner,
      workspaceOwnerKey: "workspace-A",
    });
    await act(async () => ui.get().request({ cursor: 2, expression: "na" }));
    expect(ui.get().model).toEqual({
      incomplete: false,
      items: [],
      pending: false,
      unavailable: "Suggestions unavailable.",
    });
    expect(JSON.stringify(ui.get().model)).not.toContain("secret");

    ui.set({ debugAdapterKind: "php" });
    await act(async () => ui.get().request({ cursor: 2, expression: "na" }));
    ui.set({ debugAdapterKind: "node", inspectionOwner: null });
    await act(async () => ui.get().request({ cursor: 2, expression: "na" }));
    expect(complete).toHaveBeenCalledOnce();
    ui.unmount();
  });
});
