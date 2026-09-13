// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SETTINGS_ROWS } from "../settingsRegistry";
import { searchSettingsRows } from "../settingsSearch";
import { EnvironmentsSettingsPage } from "./EnvironmentsSettingsPage";

const { useRemoteRunnerContext } = vi.hoisted(() => ({ useRemoteRunnerContext: vi.fn() }));
vi.mock("../../remoteRunner/remoteRunnerContext", () => ({ useRemoteRunnerContext }));

const server = {
  id: "server-1",
  name: "Linux",
  host: "192.168.1.110",
  username: "codex",
  port: 22,
  connected: true,
};
function setup(overrides = {}) {
  const surface = {
    servers: [],
    status: "ready",
    error: null,
    connect: vi.fn().mockResolvedValue(server),
    disconnect: vi.fn(),
    remove: vi.fn(),
    ...overrides,
  };
  useRemoteRunnerContext.mockReturnValue(surface);
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(<EnvironmentsSettingsPage />));
  const click = async (text: string) => {
    const button = Array.from(host.querySelectorAll("button")).find(
      (item) => item.textContent?.trim() === text,
    );
    expect(button).toBeDefined();
    await act(async () => button?.click());
  };
  return { host, root, surface, click, close: () => act(() => root.unmount()) };
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
});

describe("EnvironmentsSettingsPage", () => {
  it("opens real SSH configuration with local execution still the default", async () => {
    const view = setup();
    try {
      expect(view.host.textContent).toContain("Default for new threads");
      expect(view.host.textContent).toContain("Existing threads keep their environment");
      await view.click("Add server");
      expect(view.host.querySelectorAll("input")).toHaveLength(4);
      expect(view.host.textContent).toContain("refuses unknown or changed server keys");
      expect(view.surface.connect).not.toHaveBeenCalled();
      await view.click("Cancel");
      expect(view.host.querySelector("form")).toBeNull();
    } finally {
      view.close();
    }
  });

  it("prevents native spelling corrections from changing SSH connection identifiers", async () => {
    const view = setup();
    try {
      await view.click("Add server");
      for (const labelText of ["SSH host", "SSH username"]) {
        const input = Array.from(view.host.querySelectorAll("label"))
          .find((label) => label.textContent?.trim() === labelText)
          ?.querySelector("input");
        expect(input).toBeDefined();
        expect(input?.getAttribute("autocorrect")).toBe("off");
        expect(input?.getAttribute("autocapitalize")).toBe("none");
        expect(input?.getAttribute("spellcheck")).toBe("false");
      }
    } finally {
      view.close();
    }
  });

  it("connects using form input and closes only after success", async () => {
    const view = setup();
    try {
      await view.click("Add server");
      const values = ["My server", "192.168.1.110", "codex", "2222"];
      await act(async () => {
        view.host.querySelectorAll("input").forEach((input, index) => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
            input,
            values[index],
          );
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
      });
      await act(async () =>
        view.host
          .querySelector("form")
          ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
      );
      expect(view.surface.connect).toHaveBeenCalledWith({
        id: expect.any(String),
        name: "My server",
        host: "192.168.1.110",
        username: "codex",
        port: 2222,
      });
      expect(view.host.querySelector("form")).toBeNull();
    } finally {
      view.close();
    }
  });

  it("retains the form and displays a failed SSH connection", async () => {
    const view = setup({
      connect: vi.fn().mockResolvedValue(null),
      error: "Host key verification failed",
    });
    try {
      await view.click("Add server");
      await act(async () =>
        view.host
          .querySelector("form")
          ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
      );
      expect(view.host.querySelector("form")).not.toBeNull();
      expect(view.host.querySelector('[role="alert"]')?.textContent).toBe(
        "Host key verification failed",
      );
    } finally {
      view.close();
    }
  });

  it("disconnects and removes the exact saved server", async () => {
    const view = setup({ servers: [server] });
    try {
      expect(view.host.textContent).toContain("Connected");
      await view.click("Disconnect");
      expect(view.surface.disconnect).toHaveBeenCalledWith(server.id);
      await view.click("Remove");
      expect(view.surface.remove).toHaveBeenCalledWith(server.id);
    } finally {
      view.close();
    }
  });

  it("reconnects with a closed input contract without display status", async () => {
    const view = setup({ servers: [{ ...server, connected: false }] });
    try {
      await view.click("Connect");
      expect(view.surface.connect).toHaveBeenCalledWith({
        id: server.id,
        name: server.name,
        host: server.host,
        username: server.username,
        port: server.port,
      });
    } finally {
      view.close();
    }
  });

  it("blocks duplicate operations while connecting", () => {
    const view = setup({ status: "busy", servers: [server] });
    try {
      expect(
        Array.from(view.host.querySelectorAll("button")).every((button) => button.disabled),
      ).toBe(true);
    } finally {
      view.close();
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
