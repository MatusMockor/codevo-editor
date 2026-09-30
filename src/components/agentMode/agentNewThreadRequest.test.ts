import { describe, expect, it } from "vitest";
import {
  agentNewThreadTooltip,
  shouldCreateNewThreadInCurrentProject,
} from "./agentNewThreadRequest";

describe("shouldCreateNewThreadInCurrentProject", () => {
  it("creates directly with at most one project or on shift-click", () => {
    expect(shouldCreateNewThreadInCurrentProject(false, 0)).toBe(true);
    expect(shouldCreateNewThreadInCurrentProject(false, 1)).toBe(true);
    expect(shouldCreateNewThreadInCurrentProject(true, 2)).toBe(true);
    expect(shouldCreateNewThreadInCurrentProject(false, 2)).toBe(false);
  });
});

describe("agentNewThreadTooltip", () => {
  it("names only the shortcut with one project", () => {
    expect(agentNewThreadTooltip("New thread (⌘N)", 1, "app")).toBe("New thread (⌘N)");
  });

  it("adds the shift-click line for the current project with several projects", () => {
    expect(agentNewThreadTooltip("New thread (⌘N)", 2, "app")).toBe(
      "New thread (⌘N)\nShift-click: new thread in app",
    );
  });

  it("omits the shift-click line when there is no current project", () => {
    expect(agentNewThreadTooltip("New thread (⌘N)", 3, null)).toBe("New thread (⌘N)");
  });
});
