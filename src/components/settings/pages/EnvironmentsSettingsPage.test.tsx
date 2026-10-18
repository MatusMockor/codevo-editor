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
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  act(() => root.render(<EnvironmentsSettingsPage />));
  const click = async (text: string) => {
    const button = Array.from(host.querySelectorAll("button")).find(
      (item) => item.textContent?.trim() === text,
    );
    expect(button).toBeDefined();
    await act(async () => button?.click());
  };
  const byLabel = (label: string) => {
    const element = host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
    expect(element).not.toBeNull();
    return element as HTMLButtonElement;
  };
  const press = async (label: string) => {
    await act(async () => byLabel(label).click());
  };
  const status = () =>
    host.querySelector(".settings-environments__status")?.getAttribute("data-status");
  return {
    host,
    root,
    surface,
    click,
    byLabel,
    press,
    status,
    close: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
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

  it("disconnects the exact saved server with the switch", async () => {
    const view = setup({ servers: [server] });
    try {
      expect(view.status()).toBe("connected");
      expect(view.host.textContent).toContain("Connected");
      expect(view.host.textContent).toContain("codex@192.168.1.110:22");
      const toggle = view.byLabel("Linux connection");
      expect(toggle.getAttribute("role")).toBe("switch");
      expect(toggle.getAttribute("aria-checked")).toBe("true");
      await view.press("Linux connection");
      expect(view.surface.disconnect).toHaveBeenCalledWith(server.id);
      expect(view.surface.remove).not.toHaveBeenCalled();
    } finally {
      view.close();
    }
  });

  it("reconnects with a closed input contract without display status", async () => {
    const view = setup({ servers: [{ ...server, connected: false }] });
    try {
      expect(view.status()).toBe("disconnected");
      expect(view.byLabel("Linux connection").getAttribute("aria-checked")).toBe("false");
      await view.press("Linux connection");
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

  it("shows connecting and locks the switch and trash while this server connects", async () => {
    let settle: (value: typeof server | null) => void = () => undefined;
    const pending = new Promise<typeof server | null>((resolve) => {
      settle = resolve;
    });
    const view = setup({
      servers: [{ ...server, connected: false }],
      connect: vi.fn().mockReturnValue(pending),
    });
    try {
      await view.press("Linux connection");
      expect(view.status()).toBe("connecting");
      expect(view.host.textContent).toContain("Connecting…");
      expect(view.byLabel("Linux connection").disabled).toBe(true);
      expect(view.byLabel("Remove Linux").disabled).toBe(true);
      await act(async () => settle(server));
      expect(view.status()).toBe("disconnected");
      expect(view.byLabel("Linux connection").disabled).toBe(false);
      expect(view.byLabel("Remove Linux").disabled).toBe(false);
    } finally {
      view.close();
    }
  });

  it("shows the failure reason and returns the switch to off when connecting fails", async () => {
    const view = setup({
      servers: [{ ...server, connected: false }],
      connect: vi.fn().mockResolvedValue(null),
      error: "server unreachable",
    });
    try {
      await view.press("Linux connection");
      expect(view.status()).toBe("error");
      expect(view.host.querySelector(".settings-environments__status")?.textContent).toBe(
        "Could not connect - server unreachable",
      );
      const toggle = view.byLabel("Linux connection");
      expect(toggle.getAttribute("aria-checked")).toBe("false");
      expect(toggle.disabled).toBe(false);
    } finally {
      view.close();
    }
  });

  it("asks for confirmation before removing and cancels without removing", async () => {
    const view = setup({ servers: [server] });
    try {
      expect(view.byLabel("Remove Linux").textContent).toBe("");
      await view.press("Remove Linux");
      expect(view.surface.remove).not.toHaveBeenCalled();
      expect(view.host.textContent).toContain(
        "Remove Linux? Threads stay on the server; you can add it again later.",
      );
      expect(document.activeElement?.textContent).toBe("Cancel");
      await view.press("Remove Linux");
      expect(view.host.querySelectorAll(".settings-environments__confirm")).toHaveLength(1);
      await view.click("Cancel");
      expect(view.host.querySelector(".settings-environments__confirm")).toBeNull();
      expect(document.activeElement).toBe(view.byLabel("Remove Linux"));
      expect(view.surface.remove).not.toHaveBeenCalled();
    } finally {
      view.close();
    }
  });

  it("closes the removal confirmation on Escape without removing", async () => {
    const view = setup({ servers: [server] });
    try {
      await view.press("Remove Linux");
      const confirm = view.host.querySelector(".settings-environments__confirm");
      expect(confirm).not.toBeNull();
      const escape = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      });
      await act(async () => document.activeElement?.dispatchEvent(escape));
      expect(escape.defaultPrevented).toBe(true);
      expect(view.host.querySelector(".settings-environments__confirm")).toBeNull();
      expect(document.activeElement).toBe(view.byLabel("Remove Linux"));
      expect(view.surface.remove).not.toHaveBeenCalled();
    } finally {
      view.close();
    }
  });

  it("closes the confirmation and keeps focus in the row when connecting starts", async () => {
    const view = setup({
      servers: [{ ...server, connected: false }],
      connect: vi.fn().mockReturnValue(new Promise(() => undefined)),
    });
    try {
      await view.press("Remove Linux");
      expect(document.activeElement?.textContent).toBe("Cancel");
      await view.press("Linux connection");
      expect(view.status()).toBe("connecting");
      expect(view.host.querySelector(".settings-environments__confirm")).toBeNull();
      expect(view.byLabel("Remove Linux").disabled).toBe(true);
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement).toBe(view.byLabel("Linux"));
    } finally {
      view.close();
    }
  });

  it("closes the confirmation when another operation locks the row", async () => {
    const view = setup({ servers: [server] });
    try {
      await view.press("Remove Linux");
      useRemoteRunnerContext.mockReturnValue({ ...view.surface, status: "busy" });
      act(() => view.root.render(<EnvironmentsSettingsPage />));
      expect(view.host.querySelector(".settings-environments__confirm")).toBeNull();
      expect(document.activeElement).toBe(view.byLabel("Linux"));
      useRemoteRunnerContext.mockReturnValue(view.surface);
      act(() => view.root.render(<EnvironmentsSettingsPage />));
      expect(view.host.querySelector(".settings-environments__confirm")).toBeNull();
      expect(view.surface.remove).not.toHaveBeenCalled();
    } finally {
      view.close();
    }
  });

  it("shows a pending automatic startup connection and locks its controls", () => {
    const view = setup({
      servers: [{ ...server, connected: false }],
      connectingServerIds: [server.id],
    });
    try {
      expect(view.status()).toBe("connecting");
      expect(view.host.textContent).toContain("Connecting…");
      const toggle = view.byLabel("Linux connection");
      expect(toggle.getAttribute("aria-checked")).toBe("true");
      expect(toggle.disabled).toBe(true);
      expect(view.byLabel("Remove Linux").disabled).toBe(true);
    } finally {
      view.close();
    }
  });

  it("removes the exact saved server once after confirmation", async () => {
    const view = setup({ servers: [server] });
    try {
      await view.press("Remove Linux");
      await view.click("Remove");
      expect(view.surface.remove).toHaveBeenCalledTimes(1);
      expect(view.surface.remove).toHaveBeenCalledWith(server.id);
      expect(view.host.querySelector(".settings-environments__confirm")).toBeNull();
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
