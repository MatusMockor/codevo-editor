// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalTheme } from "../../domain/settings";
import { waitForReact } from "../../test/reactTestLifecycle";
import {
  AgentSurfaceTerminal,
  SURFACE_TERMINAL_FOREIGN_ROOT_MESSAGE,
  SURFACE_TERMINAL_GONE_MESSAGE,
  SURFACE_TERMINAL_UNTRUSTED_MESSAGE,
  type AgentSurfaceTerminalProps,
} from "./AgentSurfaceTerminal";
import { agentSurfaceTerminalOwnerKey } from "./agentSurfacePolicy";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";
import { fakeTerminalGateway, installResizeObserver } from "./agentSurfaceTerminalTestSupport";

vi.mock("@xterm/xterm", async () =>
  (await import("./agentSurfaceTerminalTestSupport")).xtermMockModule(),
);
vi.mock("@xterm/addon-fit", async () =>
  (await import("./agentSurfaceTerminalTestSupport")).fitAddonMockModule(),
);

const TABLIST = '[role="tablist"][aria-label="Terminal sessions"]';

describe("AgentSurfaceTerminal", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    installResizeObserver();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("mounts the real tabs panel per thread and starts on the workspace root with a worktree target", async () => {
    const gateway = fakeTerminalGateway();
    render({ terminalGateway: gateway });
    await waitForReact(() => expect(host.querySelector(TABLIST)).not.toBeNull());
    expect(
      host
        .querySelector("[data-agent-surface-terminal]")
        ?.getAttribute("data-agent-surface-terminal"),
    ).toBe(agentSurfaceTerminalOwnerKey("ws-1", "agt-1"));
    await waitForReact(() => expect(gateway.start).toHaveBeenCalledTimes(1));
    expect(gateway.start).toHaveBeenCalledWith(
      "/workspace/app",
      { cols: 80, rows: 24 },
      undefined,
      false,
      { kind: "agentWorktree", threadId: "agt-1" },
    );
    await waitForReact(() => expect(gateway.acknowledgeStart).toHaveBeenCalledWith(1));
  });

  it("uses the workspace-root target for in-place threads and restarts only on thread change", async () => {
    const gateway = fakeTerminalGateway();
    const inPlace = () =>
      surfaceThreadView({
        thread: { threadId: "agt-2", target: { isolation: "in-place", worktreePath: null } },
      } as never);
    render({ terminalGateway: gateway, thread: inPlace() });
    await waitForReact(() => expect(gateway.start).toHaveBeenCalledTimes(1));
    expect(gateway.start).toHaveBeenLastCalledWith(
      "/workspace/app",
      { cols: 80, rows: 24 },
      undefined,
      false,
      { kind: "workspaceRoot" },
    );

    for (let update = 0; update < 5; update += 1) {
      render({ terminalGateway: gateway, thread: inPlace() });
      await act(async () => Promise.resolve());
    }
    expect(gateway.start).toHaveBeenCalledTimes(1);
    expect(gateway.stop).not.toHaveBeenCalled();

    render({ terminalGateway: gateway });
    await waitForReact(() => expect(gateway.start).toHaveBeenCalledTimes(2));
    expect(gateway.stop).toHaveBeenCalledWith(1);
    expect(gateway.start).toHaveBeenLastCalledWith(
      "/workspace/app",
      { cols: 80, rows: 24 },
      undefined,
      false,
      { kind: "agentWorktree", threadId: "agt-1" },
    );
  });

  it("refuses to start for a gone checkout, a foreign repository root or an untrusted workspace", async () => {
    const gateway = fakeTerminalGateway();
    render({ terminalGateway: gateway, thread: surfaceThreadView({ worktreeMissing: true }) });
    expect(host.querySelector(".agent-note--warning")?.textContent).toBe(
      SURFACE_TERMINAL_GONE_MESSAGE,
    );

    render({ terminalGateway: gateway, workspaceRoot: "/workspace/other" });
    expect(host.querySelector(".agent-note--warning")?.textContent).toBe(
      SURFACE_TERMINAL_FOREIGN_ROOT_MESSAGE,
    );

    const onTrustWorkspace = vi.fn();
    render({ terminalGateway: gateway, workspaceTrusted: false, onTrustWorkspace });
    expect(host.querySelector(".agent-note--warning")?.textContent).toContain(
      SURFACE_TERMINAL_UNTRUSTED_MESSAGE,
    );
    act(() => host.querySelector<HTMLElement>('[aria-label="Trust the workspace"]')?.click());
    expect(onTrustWorkspace).toHaveBeenCalledTimes(1);

    await act(async () => Promise.resolve());
    expect(host.querySelector(TABLIST)).toBeNull();
    expect(gateway.start).not.toHaveBeenCalled();
  });

  function render(overrides: Partial<AgentSurfaceTerminalProps> = {}): void {
    act(() => root.render(<AgentSurfaceTerminal {...defaultProps()} {...overrides} />));
  }
});

function defaultProps(): AgentSurfaceTerminalProps {
  return {
    thread: surfaceThreadView(),
    workspaceId: "ws-1",
    workspaceRoot: "/workspace/app",
    workspaceTrusted: true,
    terminalGateway: fakeTerminalGateway(),
    terminalTheme: new Proxy({} as TerminalTheme, { get: () => "#000000" }),
    profileId: null,
    profileLabel: null,
    shellIntegrationEnabled: false,
  };
}
