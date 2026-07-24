// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  MAX_DEBUG_HOVER_EXPRESSION_BYTES,
  MAX_DEBUG_HOVER_SOURCE_BYTES,
} from "../domain/debugHoverExpression";
import type {
  DebugWatchAtCursorCapture,
  DebugWatchAtCursorCaptureReader,
} from "../domain/debugWatchAtCursorCapture";
import { useDebugWatchAtCursor, type DebugWatchAtCursorCommands } from "./useDebugWatchAtCursor";

const baseCapture: DebugWatchAtCursorCapture = {
  content: "const selected = draft.user.name;",
  documentPath: "/workspace/src/app.ts",
  modelIdentity: "group-a:model-1",
  modelVersion: 7,
  position: { column: 29, lineNumber: 1 },
  workspaceOwnerKey: "owner-a",
  workspaceRoot: "/workspace",
};

interface HookOptions {
  readonly captures?: readonly (DebugWatchAtCursorCapture | null)[];
  readonly isWorkspaceCurrent?: (workspaceRoot: string, workspaceOwnerKey: string) => boolean;
  readonly watches?: {
    add(expression: string): boolean;
    canAdd(expression: string): boolean;
  };
  readonly openDebugPanel?: () => void;
}

function renderHook(options: HookOptions = {}) {
  const host = document.createElement("div");
  const root = createRoot(host);
  const add = options.watches?.add ?? vi.fn(() => true);
  const canAdd = options.watches?.canAdd ?? vi.fn(() => true);
  const openDebugPanel = options.openDebugPanel ?? vi.fn();
  const captures = options.captures ?? [baseCapture, baseCapture];
  let readIndex = 0;
  const captureReader: DebugWatchAtCursorCaptureReader = {
    readDebugWatchAtCursorCapture: vi.fn(() => captures[readIndex++] ?? null),
  };
  const captured: { value: DebugWatchAtCursorCommands | null } = { value: null };

  function Harness() {
    captured.value = useDebugWatchAtCursor({
      captureReader,
      isWorkspaceCurrent: options.isWorkspaceCurrent ?? (() => true),
      openDebugPanel,
      watches: { add, canAdd },
    });
    return null;
  }

  act(() => root.render(<Harness />));
  return {
    add,
    canAdd,
    captureReader,
    hook: () => captured.value as DebugWatchAtCursorCommands,
    openDebugPanel,
    unmount: () => act(() => root.unmount()),
  };
}

describe("useDebugWatchAtCursor", () => {
  it("adds the parser-approved expression from the synchronous dirty live buffer", () => {
    const ui = renderHook();

    expect(ui.hook().addToWatchAtCursor()).toBe(true);
    expect(ui.canAdd).toHaveBeenCalledWith("draft.user.name");
    expect(ui.add).toHaveBeenCalledWith("draft.user.name");
    expect(ui.openDebugPanel).toHaveBeenCalledOnce();
    expect(ui.captureReader.readDebugWatchAtCursorCapture).toHaveBeenCalledTimes(2);
    ui.unmount();
  });

  it.each([
    ["const value = account?.profile.name;", 32, "account?.profile.name"],
    ["const value = invoice . total;", 26, "invoice . total"],
    ["const value = κόσμος.τιμή;", 23, "κόσμος.τιμή"],
  ])("reuses the side-effect-safe parser for %s", (content, column, expression) => {
    const capture = { ...baseCapture, content, position: { column, lineNumber: 1 } };
    const ui = renderHook({ captures: [capture, capture] });

    expect(ui.hook().addToWatchAtCursor()).toBe(true);
    expect(ui.add).toHaveBeenCalledWith(expression);
    ui.unmount();
  });

  it.each([
    ["getUser().name", 11],
    ["users[0].name", 10],
    ["user.name()", 6],
    ["const value = `user.name`;", 18],
    ["return user", 8],
  ])("rejects unsupported or masked source without mutating Watches: %s", (content, column) => {
    const capture = { ...baseCapture, content, position: { column, lineNumber: 1 } };
    const ui = renderHook({ captures: [capture] });

    expect(ui.hook().addToWatchAtCursor()).toBe(false);
    expect(ui.canAdd).not.toHaveBeenCalled();
    expect(ui.add).not.toHaveBeenCalled();
    expect(ui.openDebugPanel).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("fails closed at parser source and expression bounds", () => {
    const oversizedSource = {
      ...baseCapture,
      content: `value${" ".repeat(MAX_DEBUG_HOVER_SOURCE_BYTES)}`,
      position: { column: 2, lineNumber: 1 },
    };
    const oversizedExpression = {
      ...baseCapture,
      content: "x".repeat(MAX_DEBUG_HOVER_EXPRESSION_BYTES + 1),
      position: { column: 1, lineNumber: 1 },
    };

    for (const capture of [oversizedSource, oversizedExpression]) {
      const ui = renderHook({ captures: [capture] });
      expect(ui.hook().canAddAtCursor()).toBe(false);
      expect(ui.canAdd).not.toHaveBeenCalled();
      ui.unmount();
    }
  });

  it.each([
    ["content", { content: "const selected = replacement.user.name;" }],
    ["document", { documentPath: "/workspace/src/other.ts" }],
    ["model", { modelIdentity: "group-b:model-2" }],
    ["version", { modelVersion: 8 }],
    ["cursor", { position: { column: 28, lineNumber: 1 } }],
    ["owner", { workspaceOwnerKey: "owner-b" }],
    ["root", { workspaceRoot: "/other-workspace" }],
  ])("rejects %s drift between the two atomic reads", (_label, change) => {
    const ui = renderHook({ captures: [baseCapture, { ...baseCapture, ...change }] });

    expect(ui.hook().addToWatchAtCursor()).toBe(false);
    expect(ui.add).not.toHaveBeenCalled();
    expect(ui.openDebugPanel).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("rejects same-root owner replacement and A to B to A owner reuse", () => {
    let currentOwner = "owner-a";
    const isWorkspaceCurrent = vi.fn((_root: string, owner: string) => {
      const current = owner === currentOwner;
      currentOwner = "owner-b";
      return current;
    });
    const ui = renderHook({ isWorkspaceCurrent });

    expect(ui.hook().addToWatchAtCursor()).toBe(false);
    expect(isWorkspaceCurrent).toHaveBeenNthCalledWith(1, "/workspace", "owner-a");
    expect(isWorkspaceCurrent).toHaveBeenNthCalledWith(2, "/workspace", "owner-a");
    expect(ui.add).not.toHaveBeenCalled();
    ui.unmount();
  });

  it.each(["duplicate", "count-limit", "payload-limit"])(
    "delegates %s rejection to authoritative Watch canAdd without opening the panel",
    () => {
      const canAdd = vi.fn(() => false);
      const ui = renderHook({ watches: { add: vi.fn(() => true), canAdd } });

      expect(ui.hook().addToWatchAtCursor()).toBe(false);
      expect(canAdd).toHaveBeenCalledWith("draft.user.name");
      expect(ui.add).not.toHaveBeenCalled();
      expect(ui.openDebugPanel).not.toHaveBeenCalled();
      ui.unmount();
    },
  );

  it.each(["inactive", "running", "stopped", "untrusted"])(
    "adds through Watches while %s without owning any direct evaluator",
    () => {
      const ui = renderHook();

      expect(ui.hook().addToWatchAtCursor()).toBe(true);
      expect(ui.add).toHaveBeenCalledWith("draft.user.name");
      expect(ui.openDebugPanel).toHaveBeenCalledOnce();
      ui.unmount();
    },
  );

  it("revalidates the live capture and canAdd policy independently for enablement and run", () => {
    const captures = [baseCapture, baseCapture, baseCapture, baseCapture];
    let accepted = true;
    const canAdd = vi.fn(() => accepted);
    const ui = renderHook({ captures, watches: { add: vi.fn(() => true), canAdd } });

    expect(ui.hook().canAddAtCursor()).toBe(true);
    accepted = false;
    expect(ui.hook().addToWatchAtCursor()).toBe(false);
    expect(ui.add).not.toHaveBeenCalled();
    expect(ui.openDebugPanel).not.toHaveBeenCalled();
    expect(ui.captureReader.readDebugWatchAtCursorCapture).toHaveBeenCalledTimes(4);
    ui.unmount();
  });

  it("does not open the panel when an atomic Watch add loses to a newer state", () => {
    const add = vi.fn(() => false);
    const ui = renderHook({ watches: { add, canAdd: vi.fn(() => true) } });

    expect(ui.hook().addToWatchAtCursor()).toBe(false);
    expect(add).toHaveBeenCalledWith("draft.user.name");
    expect(ui.openDebugPanel).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("accepts the conventional caret immediately after the member expression", () => {
    const capture = {
      ...baseCapture,
      content: "const value = user.name;",
      position: { column: 24, lineNumber: 1 },
    };
    const ui = renderHook({ captures: [capture, capture] });

    expect(ui.hook().addToWatchAtCursor()).toBe(true);
    expect(ui.add).toHaveBeenCalledWith("user.name");
    ui.unmount();
  });
});
