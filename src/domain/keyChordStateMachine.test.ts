import { describe, expect, it } from "vitest";
import { KeyChordStateMachine, keyChordLookupFromKeymap } from "./keyChordStateMachine";

const keymap = {
  child: "Cmd+K Cmd+C",
  childTwo: "Cmd+K Cmd+U",
  leader: "Cmd+K",
  save: "Cmd+S",
};

function machine(): KeyChordStateMachine {
  return new KeyChordStateMachine(
    keyChordLookupFromKeymap(keymap, ["child", "childTwo", "leader", "save"]),
    1_000,
  );
}

describe("KeyChordStateMachine", () => {
  it("dispatches an unambiguous single stroke immediately", () => {
    const chord = machine();
    expect(chord.handleStroke("Cmd+S", 100)).toEqual({
      commandIds: ["save"],
      sequence: "Cmd+S",
      type: "dispatch",
    });
    expect(chord.state).toEqual({ status: "idle" });
  });

  it("waits on a prefix and dispatches the exact second stroke", () => {
    const chord = machine();
    expect(chord.handleStroke("Cmd+K", 100)).toEqual({
      expiresAt: 1_100,
      prefix: "Cmd+K",
      type: "awaitingSecond",
    });
    expect(chord.handleStroke("Cmd+C", 200)).toEqual({
      commandIds: ["child"],
      sequence: "Cmd+K Cmd+C",
      type: "dispatch",
    });
    expect(chord.state).toEqual({ status: "idle" });
  });

  it("dispatches an ambiguous leader only after its deadline", () => {
    const chord = machine();
    chord.handleStroke("Cmd+K", 100);
    expect(chord.expire(1_099)).toEqual({ type: "unmatched" });
    expect(chord.expire(1_100)).toEqual({
      commandIds: ["leader"],
      sequence: "Cmd+K",
      type: "dispatch",
    });
    expect(chord.expire(2_000)).toEqual({ type: "unmatched" });
  });

  it("cancels a wrong second stroke without reinterpreting or dispatching it", () => {
    const chord = machine();
    chord.handleStroke("Cmd+K", 100);
    expect(chord.handleStroke("Cmd+S", 200)).toEqual({
      reason: "wrong-second-stroke",
      type: "cancelled",
    });
    expect(chord.state).toEqual({ status: "idle" });
  });

  it("fails safe on repeat and invalid strokes", () => {
    const chord = machine();
    chord.handleStroke("Cmd+K", 100);
    expect(chord.handleStroke("Cmd+C", 200, { repeat: true })).toEqual({
      reason: "repeat",
      type: "cancelled",
    });
    chord.handleStroke("Cmd+K", 250);
    expect(chord.handleStroke("Cmd+Cmd+C", 300)).toEqual({
      reason: "wrong-second-stroke",
      type: "cancelled",
    });
    expect(chord.state).toEqual({ status: "idle" });
  });

  it("cancels a prefix-only chord on timeout and rejects non-finite clocks", () => {
    const prefixOnly = new KeyChordStateMachine(
      keyChordLookupFromKeymap({ child: "Cmd+K Cmd+C" }),
      1_000,
    );
    prefixOnly.handleStroke("Cmd+K", 100);
    expect(prefixOnly.expire(Number.NaN)).toEqual({ type: "unmatched" });
    expect(prefixOnly.expire(1_100)).toEqual({ reason: "timeout", type: "cancelled" });
  });

  it.each(["escape", "blur", "keymap-replaced", "editor-replaced", "unmount"] as const)(
    "exposes deterministic %s reset semantics",
    (reason) => {
      const chord = machine();
      chord.handleStroke("Cmd+K", 100);
      expect(chord.reset(reason)).toEqual({ reason, type: "cancelled" });
      expect(chord.state).toEqual({ status: "idle" });
    },
  );

  it("validates timeout policy at construction", () => {
    const lookup = keyChordLookupFromKeymap(keymap);
    expect(() => new KeyChordStateMachine(lookup, 0)).toThrow(RangeError);
    expect(() => new KeyChordStateMachine(lookup, Number.NaN)).toThrow(RangeError);
  });

  it("dispatches a synced Cmd chord from Ctrl strokes on Windows", () => {
    const chord = new KeyChordStateMachine(
      keyChordLookupFromKeymap({ comment: "Cmd+K Cmd+C" }, ["comment"], "windows"),
      1_000,
    );
    expect(chord.handleStroke("Ctrl+K", 100).type).toBe("awaitingSecond");
    expect(chord.handleStroke("Ctrl+C", 200)).toEqual({
      commandIds: ["comment"],
      sequence: "Ctrl+K Ctrl+C",
      type: "dispatch",
    });
  });
});
