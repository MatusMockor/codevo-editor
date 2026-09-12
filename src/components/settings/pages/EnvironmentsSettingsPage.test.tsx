// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { SETTINGS_ROWS } from "../settingsRegistry";
import { searchSettingsRows } from "../settingsSearch";
import { EnvironmentsSettingsPage } from "./EnvironmentsSettingsPage";

describe("EnvironmentsSettingsPage", () => {
  it("shows the local default and blocks unavailable server configuration", () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement("div");
    const root = createRoot(host);

    try {
      act(() => root.render(<EnvironmentsSettingsPage />));

      expect(host.textContent).toContain("Default for new threads");
      expect(host.textContent).toContain("Existing threads keep their environment");
      expect(host.textContent).toContain("No servers connected");
      expect(host.textContent).toContain("Remote task execution is not available");
      const addServer = host.querySelector("button");
      expect(addServer?.textContent).toContain("Add server");
      expect(addServer?.disabled).toBe(true);
      expect(host.querySelectorAll("input")).toHaveLength(0);
    } finally {
      act(() => root.unmount());
    }
  });

  it("finds local and remote environments without an open workspace", () => {
    expect(searchSettingsRows("computer", SETTINGS_ROWS, false).map(({ row }) => row.id)).toContain(
      "environments.local",
    );
    expect(searchSettingsRows("ssh", SETTINGS_ROWS, false).map(({ row }) => row.id)).toContain(
      "environments.servers",
    );
  });
});
