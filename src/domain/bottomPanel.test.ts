import { describe, expect, it } from "vitest";
import { bottomPanelLabel, type BottomPanelView } from "./bottomPanel";

describe("bottomPanelLabel", () => {
  it.each<[BottomPanelView, string]>([
    ["index", "Index"],
    ["problems", "Problems"],
    ["history", "History"],
    ["terminal", "Terminal"],
    ["runtime", "Runtime"],
  ])("labels the %s view", (view, label) => {
    expect(bottomPanelLabel(view)).toBe(label);
  });
});
