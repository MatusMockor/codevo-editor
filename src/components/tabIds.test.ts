import { describe, expect, it } from "vitest";
import { getTabId, getTabPanelId } from "./tabIds";

describe("tabIds", () => {
  it("qualifies matching tab and panel IDs by group", () => {
    expect(getTabId("/same.ts", "left")).toBe("tab-006c006500660074-002f00730061006d0065002e00740073");
    expect(getTabPanelId("/same.ts", "left")).toBe("tabpanel-006c006500660074-002f00730061006d0065002e00740073");
    expect(getTabId("/same.ts", "right")).not.toBe(getTabId("/same.ts", "left"));
  });

  it("cannot collide literal underscores with encoded path characters", () => {
    expect(getTabId("/a")).not.toBe(getTabId("_2f_a"));
    expect(getTabPanelId("/a")).not.toBe(getTabPanelId("_2f_a"));
  });

  it("retains the legacy unqualified form for isolated callers", () => {
    expect(getTabId("/same.ts")).toBe("tab-002f00730061006d0065002e00740073");
    expect(getTabPanelId("/same.ts")).toBe("tabpanel-002f00730061006d0065002e00740073");
  });
});
