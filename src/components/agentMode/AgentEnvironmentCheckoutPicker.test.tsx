// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TauriRemoteRunnerGateway } from "../../infrastructure/tauriRemoteRunnerGateway";
import { RemoteRunnerContext } from "../remoteRunner/remoteRunnerContext";
import { RemoteRunnerProvider } from "../remoteRunner/RemoteRunnerProvider";
import { AgentComposerCompactMenu } from "./AgentComposerCompactMenu";
import {
  AgentEnvironmentCheckoutPicker,
  type AgentEnvironmentCheckoutPickerProps,
} from "./AgentEnvironmentCheckoutPicker";

describe("AgentEnvironmentCheckoutPicker", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  function props(
    overrides: Partial<AgentEnvironmentCheckoutPickerProps> = {},
  ): AgentEnvironmentCheckoutPickerProps {
    return {
      disabled: false,
      isolation: "in-place",
      onIsolationChange: vi.fn(),
      onOpenEnvironmentSettings: vi.fn(),
      remote: false,
      worktreeAvailable: true,
      worktreeOnly: false,
      ...overrides,
    };
  }

  function render(overrides: Partial<AgentEnvironmentCheckoutPickerProps> = {}) {
    const next = props(overrides);
    act(() => root.render(<AgentEnvironmentCheckoutPicker {...next} />));
    return next;
  }

  function trigger(): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]');
    expect(element).not.toBeNull();
    return element ?? document.createElement("button");
  }

  function menu(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[role="menu"][aria-label="Workspace"]');
  }

  function rows(): HTMLButtonElement[] {
    return [
      ...document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitemradio"]'),
    ];
  }

  function row(text: string): HTMLButtonElement | undefined {
    return rows().find((node) => node.textContent?.includes(text));
  }

  function press(target: Element | null, key: string): void {
    act(() => {
      target?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }));
    });
  }

  it("shows the checkout on the trigger and groups Run on and Checkout", () => {
    render();
    expect(trigger().textContent).toBe("Local checkout");
    expect(trigger().getAttribute("aria-label")).toBe("Workspace: This computer, Local checkout");
    act(() => trigger().click());
    const labels = [...(menu()?.querySelectorAll(".cv-menu__label") ?? [])].map(
      (node) => node.textContent,
    );
    expect(labels).toEqual(["Run on", "Checkout"]);
    const checked = rows()
      .filter((node) => node.getAttribute("aria-checked") === "true")
      .map((node) => node.textContent);
    expect(checked).toEqual([
      expect.stringContaining("This computer"),
      expect.stringContaining("Local checkout"),
    ]);
    expect(row("Remote server")?.getAttribute("aria-disabled")).toBe("true");
  });

  it("switches to a new worktree and offers Manage environments", () => {
    const current = render();
    act(() => trigger().click());
    act(() => row("New worktree")?.click());
    expect(current.onIsolationChange).toHaveBeenCalledWith("worktree");
    expect(menu()).toBeNull();
    const worktree = render({ isolation: "worktree" });
    expect(trigger().textContent).toBe("New worktree");
    act(() => trigger().click());
    const manage = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitem"]'),
    ].find((node) => node.textContent === "Manage environments");
    act(() => manage?.click());
    expect(worktree.onOpenEnvironmentSettings).toHaveBeenCalledOnce();
    expect(menu()).toBeNull();
  });

  it("refreshes isolation when it opens and omits settings without a handler", () => {
    const onRefreshIsolation = vi.fn();
    render({ onOpenEnvironmentSettings: undefined, onRefreshIsolation });
    act(() => trigger().click());
    expect(onRefreshIsolation).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toContain("Manage environments");
  });

  it("disables Local checkout when the project requires a worktree", () => {
    const current = render({ isolation: "worktree", worktreeOnly: true, worktreeAvailable: false });
    act(() => trigger().click());
    expect(row("Local checkout")?.getAttribute("aria-disabled")).toBe("true");
    act(() => row("Local checkout")?.click());
    expect(current.onIsolationChange).not.toHaveBeenCalled();
    expect(row("New worktree")?.getAttribute("aria-checked")).toBe("true");
  });

  it("hides New worktree when worktrees are unavailable", () => {
    render({ worktreeAvailable: false });
    act(() => trigger().click());
    expect(row("New worktree")).toBeUndefined();
  });

  it("is keyboard operable: arrow opens, rows rove, Enter selects, Escape restores focus", () => {
    const current = render();
    trigger().focus();
    press(trigger(), "ArrowDown");
    expect(menu()).not.toBeNull();
    expect(document.activeElement).toBe(row("This computer"));
    press(menu(), "ArrowDown");
    expect(document.activeElement).toBe(row("Local checkout"));
    press(menu(), "ArrowDown");
    expect(document.activeElement).toBe(row("New worktree"));
    press(document.activeElement, "Enter");
    expect(current.onIsolationChange).toHaveBeenCalledWith("worktree");
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    act(() => trigger().click());
    press(menu(), "End");
    expect(document.activeElement?.textContent).toBe("Manage environments");
    press(document.activeElement, "Escape");
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(current.onOpenEnvironmentSettings).not.toHaveBeenCalled();
  });

  it("closes only its own menu on Escape inside the compact panel", () => {
    act(() =>
      root.render(
        <AgentComposerCompactMenu disabled={false}>
          <AgentEnvironmentCheckoutPicker {...props()} />
        </AgentComposerCompactMenu>,
      ),
    );
    act(() =>
      host.querySelector<HTMLButtonElement>('[aria-label="More composer controls"]')?.click(),
    );
    act(() => trigger().click());
    press(document.activeElement, "Escape");
    expect(menu()).toBeNull();
    expect(host.querySelector('[aria-label="Composer controls"]')).not.toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("closes when it becomes disabled", () => {
    render();
    act(() => trigger().click());
    render({ disabled: true });
    expect(menu()).toBeNull();
    expect(trigger().disabled).toBe(true);
  });

  it("selects a connected server through shared context and returns to this computer", async () => {
    const gateway = new TauriRemoteRunnerGateway(
      vi.fn().mockResolvedValue([
        {
          id: "linux",
          name: "Linux server",
          host: "192.168.1.110",
          username: "codex",
          port: 22,
          connected: true,
        },
        {
          id: "offline",
          name: "Offline server",
          host: "192.168.1.111",
          username: "codex",
          port: 22,
          connected: false,
        },
      ]),
    );
    await act(async () =>
      root.render(
        <RemoteRunnerProvider gateway={gateway}>
          <AgentEnvironmentCheckoutPicker {...props()} />
        </RemoteRunnerProvider>,
      ),
    );
    act(() => trigger().click());
    expect(row("Remote server")).toBeUndefined();
    const offline = row("Offline server");
    expect(offline?.getAttribute("aria-disabled")).toBe("true");
    act(() => offline?.click());
    expect(menu()).not.toBeNull();
    act(() => row("Linux server")?.click());
    expect(menu()).toBeNull();
    expect(trigger().getAttribute("aria-label")).toBe("Workspace: Linux server, Local checkout");
    expect(trigger().textContent).toBe("Linux server · Local checkout");
    act(() => trigger().click());
    expect(row("Linux server")?.getAttribute("aria-checked")).toBe("true");
    act(() => row("This computer")?.click());
    expect(trigger().getAttribute("aria-label")).toBe("Workspace: This computer, Local checkout");
  });

  it("never presents a missing selected server as this computer", () => {
    const selectServer = vi.fn();
    act(() =>
      root.render(
        <RemoteRunnerContext.Provider
          value={{
            gateway: new TauriRemoteRunnerGateway(vi.fn()),
            servers: [],
            status: "ready",
            error: null,
            selectedServerId: "removed-server",
            selectServer,
            refresh: vi.fn(),
            connect: vi.fn(),
            disconnect: vi.fn(),
            remove: vi.fn(),
          }}
        >
          <AgentEnvironmentCheckoutPicker {...props({ remote: true })} />
        </RemoteRunnerContext.Provider>,
      ),
    );
    expect(trigger().textContent).toBe("Server unavailable · Server checkout");
    expect(trigger().querySelector(".lucide-server")).not.toBeNull();
    act(() => trigger().click());
    expect(row("This computer")?.getAttribute("aria-checked")).toBe("false");
    act(() => row("This computer")?.click());
    expect(selectServer).toHaveBeenCalledExactlyOnceWith(null);
  });
});
