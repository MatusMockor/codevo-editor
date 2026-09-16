// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TauriRemoteRunnerGateway } from "../../infrastructure/tauriRemoteRunnerGateway";
import { RemoteRunnerContext } from "../remoteRunner/remoteRunnerContext";
import { RemoteRunnerProvider } from "../remoteRunner/RemoteRunnerProvider";
import {
  AgentExecutionEnvironmentPicker,
  type AgentExecutionEnvironmentPickerProps,
} from "./AgentExecutionEnvironmentPicker";

describe("AgentExecutionEnvironmentPicker", () => {
  let host: HTMLDivElement;
  let root: Root;
  const onOpenEnvironmentSettings = vi.fn();

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    onOpenEnvironmentSettings.mockClear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it("defaults to this computer and cannot choose unavailable remote execution", () => {
    render();
    expect(trigger().textContent).toBe("This computer");
    click(trigger());
    expect(host.querySelector('[aria-checked="true"]')?.textContent).toContain("This computer");
    const remote = host.querySelector<HTMLButtonElement>("button:disabled");
    expect(remote?.textContent).toBe("Remote serverComing soon");
    click(remote!);
    expect(host.querySelector('[role="menu"]')).not.toBeNull();
    expect(onOpenEnvironmentSettings).not.toHaveBeenCalled();
    expect(trigger().textContent).toBe("This computer");
  });

  it("selects a connected server through shared context and returns to the local default", async () => {
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
          <AgentExecutionEnvironmentPicker
            disabled={false}
            locked={false}
            onOpenEnvironmentSettings={onOpenEnvironmentSettings}
          />
        </RemoteRunnerProvider>,
      ),
    );
    expect(trigger().textContent).toBe("This computer");
    click(trigger());
    const options = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
    const offline = options.find((option) => option.textContent?.includes("Offline server"));
    expect(offline?.disabled).toBe(true);
    click(offline!);
    expect(trigger().textContent).toBe("This computer");
    click(options.find((option) => option.textContent?.includes("Linux server"))!);
    expect(trigger().textContent).toBe("Linux server");
    expect(host.querySelector('[role="menu"]')).toBeNull();
    click(trigger());
    expect(host.querySelector('[aria-checked="true"]')?.textContent).toContain("Linux server");
    click(
      Array.from(host.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')).find(
        (option) => option.textContent?.includes("This computer"),
      )!,
    );
    expect(trigger().textContent).toBe("This computer");
    expect(onOpenEnvironmentSettings).not.toHaveBeenCalled();
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
          <AgentExecutionEnvironmentPicker
            disabled={false}
            locked={false}
            onOpenEnvironmentSettings={onOpenEnvironmentSettings}
          />
        </RemoteRunnerContext.Provider>,
      ),
    );
    expect(trigger().textContent).toBe("Server unavailable");
    expect(trigger().querySelector(".lucide-server")).not.toBeNull();
    click(trigger());
    const local = host.querySelector<HTMLButtonElement>('[role="menuitemradio"]')!;
    expect(local.getAttribute("aria-checked")).toBe("false");
    expect(selectServer).not.toHaveBeenCalled();
    click(local);
    expect(selectServer).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("focuses the local option, skips unavailable server, and restores focus on Escape", () => {
    render();
    key(trigger(), "ArrowDown");
    expect(document.activeElement?.getAttribute("aria-checked")).toBe("true");
    key(document.activeElement!, "ArrowDown");
    expect(document.activeElement?.textContent).toBe("Manage environments");
    key(document.activeElement!, "ArrowUp");
    expect(document.activeElement?.getAttribute("aria-checked")).toBe("true");
    key(document.activeElement!, "End");
    expect(document.activeElement?.textContent).toBe("Manage environments");
    key(document.activeElement!, "Home");
    key(document.activeElement!, "Escape");
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("opens settings only through its action and closes the menu", () => {
    render();
    click(trigger());
    click(host.querySelector<HTMLButtonElement>('[role="menuitem"]')!);
    expect(onOpenEnvironmentSettings).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });

  it("closes on outside click and focus leaving the component", () => {
    render();
    click(trigger());
    act(() => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(host.querySelector('[role="menu"]')).toBeNull();
    click(trigger());
    const outside = document.createElement("button");
    document.body.append(outside);
    act(() => outside.focus());
    expect(host.querySelector('[role="menu"]')).toBeNull();
    outside.remove();
  });

  it("closes when disabled and shows a static machine for an existing task", () => {
    render();
    click(trigger());
    render({ disabled: true });
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(trigger().disabled).toBe(true);
    render({ locked: true });
    expect(host.querySelector("button")).toBeNull();
    expect(host.textContent).toBe("This computer");
  });

  it("keeps an existing server task locked to its execution environment", () => {
    render({ locked: true, executionServerId: "linux" });
    expect(host.querySelector("button")).toBeNull();
    expect(host.textContent).toBe("Server");
    expect(host.querySelector('[title="This task runs on Server"]')).not.toBeNull();
    render({ locked: true, executionServerId: null });
    expect(host.textContent).toBe("This computer");
  });

  it("positions above a bottom composer and bounds the menu to the viewport", () => {
    render();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top: window.innerHeight - 28,
      bottom: window.innerHeight,
      left: 40,
      right: 140,
      width: 100,
      height: 28,
      x: 40,
      y: window.innerHeight - 28,
      toJSON: () => ({}),
    });
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(220);
    click(trigger());
    expect(host.querySelector('[data-placement="up"]')).not.toBeNull();
    const menu = host.querySelector<HTMLElement>('[role="menu"]');
    expect(menu?.style.bottom).toBe("32px");
    expect(Number.parseFloat(menu?.style.maxHeight ?? "")).toBeLessThanOrEqual(320);
  });

  function render(overrides: Partial<AgentExecutionEnvironmentPickerProps> = {}) {
    act(() =>
      root.render(
        <AgentExecutionEnvironmentPicker
          disabled={false}
          locked={false}
          onOpenEnvironmentSettings={onOpenEnvironmentSettings}
          {...overrides}
        />,
      ),
    );
  }
  function trigger() {
    return host.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
  }
  function click(element: HTMLElement) {
    act(() => element.click());
  }
  function key(element: Element, key: string) {
    act(() =>
      element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })),
    );
  }
});
