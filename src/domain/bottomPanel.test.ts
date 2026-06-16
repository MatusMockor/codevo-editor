import { describe, expect, it } from "vitest";
import { bottomPanelLabel, type BottomPanelView } from "./bottomPanel";

describe("bottomPanelLabel", () => {
  it.each<[BottomPanelView, string]>([
    ["problems", "Problems"],
    ["terminal", "Terminal"],
  ])("labels the %s view", (view, label) => {
    expect(bottomPanelLabel(view)).toBe(label);
  });
});
