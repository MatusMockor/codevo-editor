import { describe, expect, it } from "vitest";
import { rovingIndex } from "./roving";

describe("rovingIndex", () => {
  it("moves and wraps along the vertical axis", () => {
    expect(rovingIndex("ArrowDown", 0, 3, "vertical")).toBe(1);
    expect(rovingIndex("ArrowDown", 2, 3, "vertical")).toBe(0);
    expect(rovingIndex("ArrowUp", 0, 3, "vertical")).toBe(2);
    expect(rovingIndex("ArrowRight", 0, 3, "vertical")).toBeNull();
  });

  it("moves and wraps along the horizontal axis", () => {
    expect(rovingIndex("ArrowRight", 1, 3, "horizontal")).toBe(2);
    expect(rovingIndex("ArrowLeft", 0, 3, "horizontal")).toBe(2);
    expect(rovingIndex("ArrowDown", 0, 3, "horizontal")).toBeNull();
  });

  it("accepts both axes for radio groups", () => {
    expect(rovingIndex("ArrowDown", 0, 3, "both")).toBe(1);
    expect(rovingIndex("ArrowLeft", 0, 3, "both")).toBe(2);
  });

  it("jumps with Home and End and starts from nothing focused", () => {
    expect(rovingIndex("Home", 2, 3, "vertical")).toBe(0);
    expect(rovingIndex("End", 0, 3, "vertical")).toBe(2);
    expect(rovingIndex("ArrowDown", -1, 3, "vertical")).toBe(0);
    expect(rovingIndex("ArrowUp", -1, 3, "vertical")).toBe(2);
  });

  it("ignores other keys and empty collections", () => {
    expect(rovingIndex("a", 0, 3, "vertical")).toBeNull();
    expect(rovingIndex("ArrowDown", 0, 0, "vertical")).toBeNull();
  });
});
