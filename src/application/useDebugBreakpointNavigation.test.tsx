// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { Breakpoint } from "../domain/debug";
import type {
  DebugBreakpointNavigationCapture,
  DebugBreakpointNavigationCaptureReader,
} from "../domain/debugBreakpointNavigationCapture";
import {
  useDebugBreakpointNavigation,
  type DebugBreakpointNavigationCommands,
} from "./useDebugBreakpointNavigation";

const capture: DebugBreakpointNavigationCapture = {
  columnNumber: 1,
  documentPath: "/workspace/src/a.ts",
  focused: true,
  lineNumber: 5,
  modelIdentity: "model-a",
  modelVersion: 3,
  workspaceOwnerKey: "owner-a",
  workspaceRoot: "/workspace",
};

const breakpoints: Breakpoint[] = [
  { id: "before", enabled: true, filePath: "/workspace/src/a.ts", lineNumber: 2 },
  { id: "after", enabled: true, filePath: "/workspace/src/a.ts", lineNumber: 8 },
  { id: "other", enabled: true, filePath: "/workspace/src/b.ts", lineNumber: 3 },
];

function deferred() {
  let resolve!: (value: boolean) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<boolean>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, reject, resolve };
}

function renderHook({
  captures = [capture],
  readCapture,
  getBreakpoints = () => breakpoints,
  isWorkspaceCurrent = () => true,
  openDebugLocation = vi.fn().mockResolvedValue(true),
}: {
  captures?: readonly (DebugBreakpointNavigationCapture | null)[];
  readCapture?: () => DebugBreakpointNavigationCapture | null;
  getBreakpoints?: () => readonly Breakpoint[];
  isWorkspaceCurrent?: (root: string, owner: string) => boolean;
  openDebugLocation?: (
    filePath: string,
    lineNumber: number,
    column?: number,
    shouldCommit?: () => boolean,
  ) => Promise<boolean>;
} = {}) {
  const host = document.createElement("div");
  const root = createRoot(host);
  let index = 0;
  const captureReader: DebugBreakpointNavigationCaptureReader = {
    readDebugBreakpointNavigationCapture: vi.fn(
      readCapture ?? (() => captures[Math.min(index++, captures.length - 1)] ?? null),
    ),
  };
  const latest: { value: DebugBreakpointNavigationCommands | null } = { value: null };
  function Harness() {
    latest.value = useDebugBreakpointNavigation({
      captureReader,
      getBreakpoints,
      isWorkspaceCurrent,
      openDebugLocation,
    });
    return null;
  }
  act(() => root.render(<Harness />));
  return {
    hook: () => latest.value as DebugBreakpointNavigationCommands,
    openDebugLocation,
    unmount: () => act(() => root.unmount()),
  };
}

describe("useDebugBreakpointNavigation", () => {
  it("navigates next and previous through exact private targets", () => {
    const next = renderHook();
    expect(next.hook().goToNextBreakpoint()).toBe(true);
    expect(next.openDebugLocation).toHaveBeenCalledWith(
      "/workspace/src/a.ts",
      8,
      1,
      expect.any(Function),
    );
    next.unmount();

    const previous = renderHook();
    expect(previous.hook().goToPreviousBreakpoint()).toBe(true);
    expect(previous.openDebugLocation).toHaveBeenCalledWith(
      "/workspace/src/a.ts",
      2,
      1,
      expect.any(Function),
    );
    previous.unmount();
  });

  it.each([
    ["document", { documentPath: "/workspace/src/b.ts" }],
    ["focus", { focused: false }],
    ["line", { lineNumber: 6 }],
    ["model", { modelIdentity: "model-b" }],
    ["version", { modelVersion: 4 }],
    ["owner", { workspaceOwnerKey: "owner-b" }],
    ["root", { workspaceRoot: "/other" }],
  ])("rejects %s drift across the double capture", (_label, change) => {
    const ui = renderHook({ captures: [capture, { ...capture, ...change }] });
    expect(ui.hook().goToNextBreakpoint()).toBe(false);
    expect(ui.openDebugLocation).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("rejects forged, disabled and workspace-escaping targets", () => {
    const ui = renderHook({
      getBreakpoints: () => [
        { id: "disabled", enabled: false, filePath: "/workspace/src/a.ts", lineNumber: 8 },
        { id: "outside", enabled: true, filePath: "/outside/b.ts", lineNumber: 2 },
        { id: "php", enabled: true, filePath: "/workspace/src/b.php", lineNumber: 2 },
        {
          id: "forged-condition",
          enabled: true,
          filePath: "/workspace/src/b.ts",
          lineNumber: 2,
          condition: "bad\0condition",
        },
        {
          id: "forged-log",
          enabled: true,
          filePath: "/workspace/src/c.ts",
          lineNumber: 2,
          logMessage: "unclosed {",
        },
      ],
    });
    expect(ui.hook().canGoToNextBreakpoint()).toBe(false);
    expect(ui.hook().goToNextBreakpoint()).toBe(false);
    expect(ui.openDebugLocation).not.toHaveBeenCalled();
    ui.unmount();
  });

  it.each([
    ["non-canonical dot alias", "/workspace/./src/a.ts"],
    ["separator alias", "/workspace\\src\\a.ts"],
    ["PHP source", "/workspace/src/a.php"],
    ["TypeScript declaration", "/workspace/src/a.d.ts"],
  ])("rejects an ineligible capture path: %s", (_label, documentPath) => {
    const ui = renderHook({ captures: [{ ...capture, documentPath }] });

    expect(ui.hook().canGoToNextBreakpoint()).toBe(false);
    expect(ui.hook().goToNextBreakpoint()).toBe(false);
    expect(ui.openDebugLocation).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("fails closed when capture, owner, or breakpoint ports throw", () => {
    for (const options of [
      {
        readCapture: () => {
          throw new Error("editor disposed");
        },
      },
      {
        isWorkspaceCurrent: () => {
          throw new Error("owner unavailable");
        },
      },
      {
        getBreakpoints: () => {
          throw new Error("breakpoints unavailable");
        },
      },
    ]) {
      const ui = renderHook(options);
      expect(ui.hook().canGoToNextBreakpoint()).toBe(false);
      expect(ui.hook().goToNextBreakpoint()).toBe(false);
      expect(ui.openDebugLocation).not.toHaveBeenCalled();
      ui.unmount();
    }
  });

  it("rejects an A to B to A owner transition at the double-capture fence", () => {
    const ui = renderHook({
      captures: [capture, { ...capture, workspaceOwnerKey: "owner-b" }, capture],
    });

    expect(ui.hook().goToNextBreakpoint()).toBe(false);
    expect(ui.openDebugLocation).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("makes shouldCommit fail closed after owner or target drift", () => {
    let current = true;
    let live = [...breakpoints];
    const openDebugLocation = vi.fn(
      async (_path: string, _line: number, _column = 1, shouldCommit?: () => boolean) => {
        expect(shouldCommit?.()).toBe(true);
        current = false;
        expect(shouldCommit?.()).toBe(false);
        current = true;
        live = live.filter((breakpoint) => breakpoint.id !== "after");
        expect(shouldCommit?.()).toBe(false);
        return false;
      },
    );
    const ui = renderHook({
      getBreakpoints: () => live,
      isWorkspaceCurrent: () => current,
      openDebugLocation,
    });

    expect(ui.hook().goToNextBreakpoint()).toBe(true);
    expect(openDebugLocation).toHaveBeenCalledOnce();
    ui.unmount();
  });

  it.each([
    ["removal", () => []],
    [
      "disable",
      () =>
        breakpoints.map((breakpoint) =>
          breakpoint.id === "after" ? { ...breakpoint, enabled: false } : breakpoint,
        ),
    ],
    [
      "relocation",
      () =>
        breakpoints.map((breakpoint) =>
          breakpoint.id === "after" ? { ...breakpoint, lineNumber: 9 } : breakpoint,
        ),
    ],
  ] as const)("makes shouldCommit reject target %s", (_label, mutate) => {
    let live: readonly Breakpoint[] = breakpoints;
    const openDebugLocation = vi.fn(
      async (_path: string, _line: number, _column = 1, shouldCommit?: () => boolean) => {
        expect(shouldCommit?.()).toBe(true);
        live = mutate();
        expect(shouldCommit?.()).toBe(false);
        return false;
      },
    );
    const ui = renderHook({ getBreakpoints: () => live, openDebugLocation });

    expect(ui.hook().goToNextBreakpoint()).toBe(true);
    expect(openDebugLocation).toHaveBeenCalledOnce();
    ui.unmount();
  });

  it("projects only location coordinates and never mutates private breakpoint fields", () => {
    const privateBreakpoint = Object.freeze<Breakpoint>({
      condition: "account.ready",
      enabled: true,
      filePath: "/workspace/src/a.ts",
      hitCondition: Object.freeze({ count: 2, kind: "equals" }),
      id: "private",
      lineNumber: 8,
      logMessage: "ready {account.id}",
    });
    const ui = renderHook({ getBreakpoints: () => Object.freeze([privateBreakpoint]) });

    expect(ui.hook().goToNextBreakpoint()).toBe(true);
    expect(ui.openDebugLocation).toHaveBeenCalledWith(
      "/workspace/src/a.ts",
      8,
      1,
      expect.any(Function),
    );
    expect(privateBreakpoint).toEqual({
      condition: "account.ready",
      enabled: true,
      filePath: "/workspace/src/a.ts",
      hitCondition: { count: 2, kind: "equals" },
      id: "private",
      lineNumber: 8,
      logMessage: "ready {account.id}",
    });
    ui.unmount();
  });

  it("single-flights both directions and releases them after async settlement", async () => {
    const opening = deferred();
    const ui = renderHook({ openDebugLocation: vi.fn(() => opening.promise) });
    expect(ui.hook().goToNextBreakpoint()).toBe(true);
    expect(ui.hook().canGoToNextBreakpoint()).toBe(false);
    expect(ui.hook().canGoToPreviousBreakpoint()).toBe(false);
    expect(ui.hook().goToNextBreakpoint()).toBe(false);
    expect(ui.hook().goToPreviousBreakpoint()).toBe(false);
    expect(ui.openDebugLocation).toHaveBeenCalledOnce();

    await act(async () => {
      opening.resolve(true);
      await opening.promise;
    });
    expect(ui.hook().canGoToNextBreakpoint()).toBe(true);
    expect(ui.hook().canGoToPreviousBreakpoint()).toBe(true);
    ui.unmount();
  });

  it.each(["next", "previous"] as const)(
    "releases both directions after %s synchronous and asynchronous failures",
    async (direction) => {
      const asyncFailure = deferred();
      const openDebugLocation = vi
        .fn(
          async (
            _filePath: string,
            _lineNumber: number,
            _column?: number,
            _shouldCommit?: () => boolean,
          ): Promise<boolean> => true,
        )
        .mockImplementationOnce(() => {
          throw new Error("sync failure");
        })
        .mockImplementationOnce(() => asyncFailure.promise)
        .mockResolvedValue(true);
      const ui = renderHook({ openDebugLocation });
      const navigate =
        direction === "next"
          ? () => ui.hook().goToNextBreakpoint()
          : () => ui.hook().goToPreviousBreakpoint();
      const canNavigate =
        direction === "next"
          ? () => ui.hook().canGoToNextBreakpoint()
          : () => ui.hook().canGoToPreviousBreakpoint();

      expect(navigate()).toBe(false);
      expect(canNavigate()).toBe(true);
      expect(navigate()).toBe(true);
      expect(canNavigate()).toBe(false);
      expect(
        direction === "next"
          ? ui.hook().canGoToPreviousBreakpoint()
          : ui.hook().canGoToNextBreakpoint(),
      ).toBe(false);
      await act(async () => {
        asyncFailure.reject(new Error("async failure"));
        await asyncFailure.promise.catch(() => undefined);
      });
      expect(canNavigate()).toBe(true);
      expect(navigate()).toBe(true);
      expect(openDebugLocation).toHaveBeenCalledTimes(3);
      ui.unmount();
    },
  );

  it("makes shouldCommit fail closed if a live breakpoint port throws", () => {
    let throwOnRead = false;
    const openDebugLocation = vi.fn(
      async (_path: string, _line: number, _column = 1, shouldCommit?: () => boolean) => {
        throwOnRead = true;
        expect(shouldCommit?.()).toBe(false);
        return false;
      },
    );
    const ui = renderHook({
      getBreakpoints: () => {
        if (throwOnRead) throw new Error("breakpoints unavailable");
        return breakpoints;
      },
      openDebugLocation,
    });

    expect(ui.hook().goToNextBreakpoint()).toBe(true);
    expect(openDebugLocation).toHaveBeenCalledOnce();
    ui.unmount();
  });
});
