// @vitest-environment jsdom

import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentMenuCommandSurface } from "./useAgentThreadMenuCommands";
import { useAgentThreadMenuCommands } from "./useAgentThreadMenuCommands";
import { agentProjectGroups } from "./agentModePresentation";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";
import { projectFixture, threadsSurfaceFixture } from "./agentThreadsSurfaceTestFixtures";
import {
  AGENT_END_SESSION_STOP_TEXT,
  AgentEndSessionConfirmationBanner,
} from "./AgentEndSessionConfirmationBanner";

let mounted: { readonly root: Root; readonly host: HTMLElement } | null = null;

function render(element: ReactElement): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted = { root, host };
  act(() => root.render(element));
  return host;
}

function button(host: HTMLElement, name: string): HTMLButtonElement {
  const match = [...host.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === name,
  );
  expect(match).toBeInstanceOf(HTMLButtonElement);
  return match as HTMLButtonElement;
}

afterEach(() => {
  const current = mounted;
  mounted = null;
  if (current === null) return;
  act(() => current.root.unmount());
  current.host.remove();
});

describe("AgentEndSessionConfirmationBanner", () => {
  it("renders nothing without a pending confirmation", () => {
    const host = render(<AgentEndSessionConfirmationBanner confirmation={null} />);
    expect(host.childElementCount).toBe(0);
  });

  it("names the target thread and warns that ending may stop Claude's background tasks", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const host = render(
      <AgentEndSessionConfirmationBanner
        confirmation={{
          threadId: "agt-2",
          title: "Nightly build",
          background: "live",
          onConfirm,
          onCancel,
        }}
      />,
    );
    expect(AGENT_END_SESSION_STOP_TEXT).toBe(
      "Ending the session may stop background tasks Claude started.",
    );
    expect(host.textContent).toContain(
      'End Claude\'s session for "Nightly build"? Background tasks are still running in this session. Ending the session may stop background tasks Claude started.',
    );
    act(() => button(host, "End session").click());
    act(() => button(host, "Keep running").click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("words an unanswered background check truthfully", () => {
    const host = render(
      <AgentEndSessionConfirmationBanner
        confirmation={{
          threadId: "agt-1",
          title: "Refactor the parser",
          background: "unknown",
          onConfirm: vi.fn(),
          onCancel: vi.fn(),
        }}
      />,
    );
    expect(host.textContent).toContain(
      'End Claude\'s session for "Refactor the parser"? Codevo could not check whether background tasks are running in this session. Ending the session may stop background tasks Claude started.',
    );
  });

  it("shows the thread menu's End Claude session confirmation when wired to the menu commands", async () => {
    const endSession = vi.fn(async () => "ended" as const);
    const agents: AgentMenuCommandSurface = threadsSurfaceFixture({
      threads: [surfaceThreadView()],
      endSession,
      inspectSessionBackground: async () => "live" as const,
    });
    let request: (() => void) | null = null;
    function MenuHost() {
      const menu = useAgentThreadMenuCommands({
        agents,
        groups: agentProjectGroups([projectFixture()], agents.threads, []),
        revealPath: async () => undefined,
        reportNotice: () => undefined,
        onTrustProject: () => undefined,
        onCloseProject: () => undefined,
        onReleaseProject: () => undefined,
        onThreadRemoved: () => undefined,
        onOpenTerminalSessions: () => undefined,
        startNewThread: () => undefined,
      });
      request = () => menu.handleThreadMenuCommand("agt-1", { kind: "endSession" });
      return <AgentEndSessionConfirmationBanner confirmation={menu.endSessionConfirmation} />;
    }
    const host = render(<MenuHost />);
    expect(host.textContent).toBe("");
    await act(async () => request?.());
    expect(host.textContent).toContain('"Refactor the parser"');
    expect(host.textContent).toContain(AGENT_END_SESSION_STOP_TEXT);
    await act(async () => button(host, "End session").click());
    expect(endSession).toHaveBeenCalledWith("agt-1");
    expect(host.textContent).toBe("");
  });
});
