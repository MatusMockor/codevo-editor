import { describe, expect, it } from "vitest";
import { agentNewThreadRoute, agentNewThreadTooltip } from "./agentNewThreadRequest";

describe("agentNewThreadRoute", () => {
  it("creates directly in the active project on a plain request", () => {
    expect(
      agentNewThreadRoute({ shiftKey: false, activeProjectRootKey: "/app", projectCount: 2 }),
    ).toEqual({
      kind: "create",
      projectRootKey: "/app",
    });
    expect(
      agentNewThreadRoute({ shiftKey: false, activeProjectRootKey: "/app", projectCount: 1 }),
    ).toEqual({
      kind: "create",
      projectRootKey: "/app",
    });
  });

  it("opens the picker without an active project", () => {
    expect(
      agentNewThreadRoute({ shiftKey: false, activeProjectRootKey: null, projectCount: 2 }),
    ).toEqual({
      kind: "picker",
    });
  });

  it("opens the picker on shift with several projects", () => {
    expect(
      agentNewThreadRoute({ shiftKey: true, activeProjectRootKey: "/app", projectCount: 2 }),
    ).toEqual({
      kind: "picker",
    });
  });

  it("keeps creating directly on shift when there is nothing to choose from", () => {
    expect(
      agentNewThreadRoute({ shiftKey: true, activeProjectRootKey: "/app", projectCount: 1 }),
    ).toEqual({
      kind: "create",
      projectRootKey: "/app",
    });
  });
});

describe("agentNewThreadTooltip", () => {
  it("names the active project and the picker chord with several projects", () => {
    expect(
      agentNewThreadTooltip({
        shortcut: "Cmd+N",
        pickerShortcut: "Cmd+Shift+N",
        projectLabel: "app",
        projectCount: 2,
      }),
    ).toBe("New thread in app (⌘N) · ⇧⌘N: choose project");
  });

  it("omits the picker chord with a single project", () => {
    expect(
      agentNewThreadTooltip({
        shortcut: "Cmd+N",
        pickerShortcut: "Cmd+Shift+N",
        projectLabel: "app",
        projectCount: 1,
      }),
    ).toBe("New thread in app (⌘N)");
  });

  it("falls back to the plain label without an active project", () => {
    expect(
      agentNewThreadTooltip({
        shortcut: "Cmd+N",
        pickerShortcut: "Cmd+Shift+N",
        projectLabel: null,
        projectCount: 3,
      }),
    ).toBe("New thread (⌘N)");
  });

  it("omits unbound chords", () => {
    expect(
      agentNewThreadTooltip({
        shortcut: "",
        pickerShortcut: "",
        projectLabel: "app",
        projectCount: 2,
      }),
    ).toBe("New thread in app");
  });
});
