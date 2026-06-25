import { describe, expect, it } from "vitest";
import { createDoubleShiftDetector } from "./doubleShiftDetector";

function shiftEvent(
  overrides: Partial<Pick<
    KeyboardEvent,
    "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey" | "repeat"
  >> = {},
): KeyboardEvent {
  return {
    key: "Shift",
    shiftKey: true,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    repeat: false,
    ...overrides,
  } as KeyboardEvent;
}

describe("createDoubleShiftDetector", () => {
  it("does not trigger on a single Shift press", () => {
    const detector = createDoubleShiftDetector({ windowMs: 300 });

    expect(detector.handleKeyDown(shiftEvent(), 0)).toBe(false);
  });

  it("triggers when Shift is pressed twice within the window", () => {
    const detector = createDoubleShiftDetector({ windowMs: 300 });

    expect(detector.handleKeyDown(shiftEvent(), 0)).toBe(false);
    expect(detector.handleKeyDown(shiftEvent(), 200)).toBe(true);
  });

  it("does not trigger when the second press is outside the window", () => {
    const detector = createDoubleShiftDetector({ windowMs: 300 });

    expect(detector.handleKeyDown(shiftEvent(), 0)).toBe(false);
    expect(detector.handleKeyDown(shiftEvent(), 500)).toBe(false);
  });

  it("requires two consecutive Shift presses with nothing in between", () => {
    const detector = createDoubleShiftDetector({ windowMs: 300 });

    expect(detector.handleKeyDown(shiftEvent(), 0)).toBe(false);
    expect(detector.handleKeyDown(shiftEvent({ key: "a", shiftKey: false }), 50)).toBe(
      false,
    );
    expect(detector.handleKeyDown(shiftEvent(), 100)).toBe(false);
  });

  it("ignores Shift held as a modifier for another key", () => {
    const detector = createDoubleShiftDetector({ windowMs: 300 });

    // Shift+A is not a bare Shift tap.
    expect(detector.handleKeyDown(shiftEvent({ key: "A" }), 0)).toBe(false);
    expect(detector.handleKeyDown(shiftEvent({ key: "A" }), 100)).toBe(false);
  });

  it("ignores auto-repeat Shift events", () => {
    const detector = createDoubleShiftDetector({ windowMs: 300 });

    expect(detector.handleKeyDown(shiftEvent(), 0)).toBe(false);
    expect(detector.handleKeyDown(shiftEvent({ repeat: true }), 50)).toBe(false);
  });

  it("does not trigger when another modifier accompanies Shift", () => {
    const detector = createDoubleShiftDetector({ windowMs: 300 });

    expect(detector.handleKeyDown(shiftEvent({ metaKey: true }), 0)).toBe(false);
    expect(detector.handleKeyDown(shiftEvent({ metaKey: true }), 100)).toBe(false);
  });

  it("resets after a successful trigger so a third tap does not re-fire", () => {
    const detector = createDoubleShiftDetector({ windowMs: 300 });

    expect(detector.handleKeyDown(shiftEvent(), 0)).toBe(false);
    expect(detector.handleKeyDown(shiftEvent(), 100)).toBe(true);
    expect(detector.handleKeyDown(shiftEvent(), 150)).toBe(false);
  });

  it("can be reset manually", () => {
    const detector = createDoubleShiftDetector({ windowMs: 300 });

    expect(detector.handleKeyDown(shiftEvent(), 0)).toBe(false);
    detector.reset();
    expect(detector.handleKeyDown(shiftEvent(), 100)).toBe(false);
  });
});
