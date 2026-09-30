// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THIS_COMPUTER, type AgentMachine } from "../../domain/agentWorkspaceLocation";
import { TauriRemoteRunnerGateway } from "../../infrastructure/tauriRemoteRunnerGateway";
import { RemoteRunnerProvider } from "../remoteRunner/RemoteRunnerProvider";
import { useRemoteRunnerContext } from "../remoteRunner/remoteRunnerContext";
import { AgentRunOnPicker } from "./AgentRunOnPicker";

describe("AgentRunOnPicker", () => {
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
  });

  function trigger(): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>("#agent-run-on");
    expect(element).not.toBeNull();
    return element ?? document.createElement("button");
  }

  function row(label: string): HTMLButtonElement | undefined {
    return [
      ...document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitemradio"]'),
    ].find((node) => node.querySelector(".cv-menu__text")?.firstChild?.textContent === label);
  }

  function menu(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[role="menu"][aria-label="Run on"]');
  }

  function SelectedMachine({ onOpenEnvironmentSettings }: { onOpenEnvironmentSettings(): void }) {
    const runner = useRemoteRunnerContext();
    const selected = runner?.servers.find((server) => server.id === runner.selectedServerId);
    const machine: AgentMachine =
      selected === undefined ? THIS_COMPUTER : { kind: "server", name: selected.name };
    return (
      <AgentRunOnPicker
        disabled={false}
        machine={machine}
        onOpenEnvironmentSettings={onOpenEnvironmentSettings}
      />
    );
  }

  it("selects a connected server, refuses an offline one and returns to this computer", async () => {
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
    const onOpenEnvironmentSettings = vi.fn();
    await act(async () =>
      root.render(
        <RemoteRunnerProvider gateway={gateway}>
          <SelectedMachine onOpenEnvironmentSettings={onOpenEnvironmentSettings} />
        </RemoteRunnerProvider>,
      ),
    );
    expect(trigger().textContent).toBe("This computer");
    expect(trigger().getAttribute("aria-label")).toBe("Run on: This computer");
    act(() => trigger().click());
    expect(menu()?.querySelector(".cv-menu__label")?.textContent).toBe("Run on");
    const offline = row("Offline server");
    expect(offline?.getAttribute("aria-disabled")).toBe("true");
    expect(offline?.textContent).toContain("Connect in settings");
    act(() => offline?.click());
    expect(menu()).not.toBeNull();
    act(() => row("Linux server")?.click());
    expect(menu()).toBeNull();
    expect(trigger().getAttribute("aria-label")).toBe("Run on: Linux server");
    expect(trigger().textContent).toBe("Linux server");
    expect(trigger().querySelector(".lucide-server")).not.toBeNull();
    act(() => trigger().click());
    expect(row("Linux server")?.getAttribute("aria-checked")).toBe("true");
    act(() => row("This computer")?.click());
    expect(trigger().getAttribute("aria-label")).toBe("Run on: This computer");
    act(() => trigger().click());
    const manage = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitem"]'),
    ].find((node) => node.textContent === "Manage environments");
    act(() => manage?.click());
    expect(onOpenEnvironmentSettings).toHaveBeenCalledOnce();
  });
});
