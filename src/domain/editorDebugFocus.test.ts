import { describe, expect, it } from "vitest";
import {
  debugViewsPlacement,
  editorDebugFocusReducer,
  EDITOR_DEBUG_FOCUS_OWNER_LIMIT,
  initialEditorDebugFocusState,
  type EditorDebugFocusEvent,
  type EditorDebugFocusState,
} from "./editorDebugFocus";

function run(events: ReadonlyArray<EditorDebugFocusEvent>) {
  let state: EditorDebugFocusState = initialEditorDebugFocusState;
  const effects: string[] = [];
  for (const event of events) {
    const step = editorDebugFocusReducer(state, event);
    state = step.state;
    effects.push(step.effect);
  }
  return { state, effects };
}

describe("editorDebugFocusReducer", () => {
  it("maximizes once when a session starts in a docked panel and restores when it ends", () => {
    const { effects } = run([
      { kind: "owner", ownerKey: "/a" },
      { kind: "session", sessionId: 7, maximized: false },
      { kind: "session", sessionId: 7, maximized: true },
      { kind: "session", sessionId: null, maximized: true },
    ]);

    expect(effects).toEqual(["none", "maximize", "none", "restore"]);
  });

  it("does nothing when the panel was already maximized", () => {
    const { effects } = run([
      { kind: "owner", ownerKey: "/a" },
      { kind: "session", sessionId: 7, maximized: true },
      { kind: "session", sessionId: null, maximized: true },
    ]);

    expect(effects).toEqual(["none", "none", "none"]);
  });

  it("never re-maximizes a session the user restored and never restores after a manual change", () => {
    const { effects } = run([
      { kind: "owner", ownerKey: "/a" },
      { kind: "session", sessionId: 7, maximized: false },
      { kind: "layoutChanged" },
      { kind: "session", sessionId: 7, maximized: false },
      { kind: "session", sessionId: null, maximized: false },
    ]);

    expect(effects).toEqual(["none", "maximize", "none", "none", "none"]);
  });

  it("drops a pending restore when the workspace changes (A -> B -> A)", () => {
    const { effects, state } = run([
      { kind: "owner", ownerKey: "/a" },
      { kind: "session", sessionId: 7, maximized: false },
      { kind: "owner", ownerKey: "/b" },
      { kind: "session", sessionId: null, maximized: true },
      { kind: "owner", ownerKey: "/a" },
      { kind: "session", sessionId: null, maximized: true },
    ]);

    expect(effects).toEqual(["none", "maximize", "none", "none", "none", "none"]);
    expect(state.maximizedByDebug).toBe(false);
  });

  it("keeps a restored session restored after switching workspaces (A -> B -> A)", () => {
    const { effects } = run([
      { kind: "owner", ownerKey: "/a" },
      { kind: "session", sessionId: 7, maximized: false },
      { kind: "layoutChanged" },
      { kind: "session", sessionId: 7, maximized: false },
      { kind: "owner", ownerKey: "/b" },
      { kind: "session", sessionId: null, maximized: false },
      { kind: "owner", ownerKey: "/a" },
      { kind: "session", sessionId: 7, maximized: false },
      { kind: "session", sessionId: null, maximized: false },
    ]);

    expect(effects).toEqual([
      "none",
      "maximize",
      "none",
      "none",
      "none",
      "none",
      "none",
      "none",
      "none",
    ]);
  });

  it("forgets the oldest remembered workspace first once the memory is full", () => {
    const events: EditorDebugFocusEvent[] = [
      { kind: "owner", ownerKey: "/a" },
      { kind: "session", sessionId: 7, maximized: true },
    ];
    for (let index = 0; index < EDITOR_DEBUG_FOCUS_OWNER_LIMIT; index += 1) {
      events.push({ kind: "owner", ownerKey: `/other-${index}` });
      events.push({ kind: "session", sessionId: 100 + index, maximized: true });
    }
    events.push({ kind: "owner", ownerKey: "/other-1" });
    events.push({ kind: "session", sessionId: 101, maximized: false });
    events.push({ kind: "owner", ownerKey: "/a" });
    events.push({ kind: "session", sessionId: 7, maximized: false });
    const { effects } = run(events);

    expect(effects[effects.length - 3]).toBe("none");
    expect(effects[effects.length - 1]).toBe("maximize");
  });

  it("treats a new session id as a new session", () => {
    const { effects } = run([
      { kind: "owner", ownerKey: "/a" },
      { kind: "session", sessionId: 7, maximized: false },
      { kind: "layoutChanged" },
      { kind: "session", sessionId: 8, maximized: false },
    ]);

    expect(effects).toEqual(["none", "maximize", "none", "maximize"]);
  });
});

describe("debugViewsPlacement", () => {
  it("shows the side column only in focus mode while debugging or while the Debug console is open", () => {
    expect(debugViewsPlacement({ maximized: true, phase: "active", drawerView: null })).toBe(
      "side",
    );
    expect(debugViewsPlacement({ maximized: true, phase: "idle", drawerView: "debug" })).toBe(
      "side",
    );
    expect(debugViewsPlacement({ maximized: true, phase: "idle", drawerView: "problems" })).toBe(
      "hidden",
    );
    expect(debugViewsPlacement({ maximized: false, phase: "active", drawerView: "debug" })).toBe(
      "hidden",
    );
  });
});
