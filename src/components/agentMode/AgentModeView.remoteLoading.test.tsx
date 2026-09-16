// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import { AgentModeView } from "./AgentModeView";
import { surfaceThreadView, SURFACE_FIXTURE_ROOT } from "./agentSurfaceTestFixtures";
import { projectFixture, threadsSurfaceFixture } from "./agentThreadsSurfaceTestFixtures";
import { chromeFixture } from "./agentWorkbenchChromeTestFixtures";
import { NO_SCOPE_STATE, type AgentNavigationSession } from "./useAgentThreadNavigation";

describe("restoring a server conversation before inventory arrives", () => {
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

  it.each(["remote-thread:linux:runner:conversation", "remote-thread:%ZZ:runner:conversation"])(
    "locks unresolved target and refuses submission for %s",
    async (threadId) => {
      const startThread = vi.fn();
      const sendFollowUp = vi.fn();
      const session: AgentNavigationSession = {
        current: {
          selectedThreadId: threadId,
          selectedThreadOwnerKey: "pending",
          scopeState: NO_SCOPE_STATE,
        },
      };
      await act(async () =>
        root.render(
          <AgentModeView
            agents={{
              ...threadsSurfaceFixture({
                threads: [surfaceThreadView()],
                startThread,
                sendFollowUp,
              }),
              providerManagement: unconfiguredAgentProviderManagement(),
            }}
            projects={[projectFixture()]}
            workspaceRoot={SURFACE_FIXTURE_ROOT}
            overflowRootPaths={[]}
            providerEnabled={{ claudeCode: true, codex: true }}
            chrome={chromeFixture()}
            navigationSession={session}
            onTrustProject={() => undefined}
            onReleaseProject={() => undefined}
            onOpenEnvironmentSettings={() => undefined}
          />,
        ),
      );
      expect(host.querySelector(".agent-environment__locked")?.textContent).toBe("Server");
      expect(host.querySelector('[aria-label="Run on: This computer"]')).toBeNull();
      expect(host.textContent).toContain("Waiting for the server conversation to load.");
      const textarea = host.querySelector<HTMLTextAreaElement>(".agent-composer textarea")!;
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
          textarea,
          "Must stay on Linux",
        );
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(
        host.querySelector<HTMLButtonElement>('.agent-composer button[type="submit"]')?.disabled,
      ).toBe(true);
      act(() =>
        host
          .querySelector(".agent-composer")!
          .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
      );
      expect(startThread).not.toHaveBeenCalled();
      expect(sendFollowUp).not.toHaveBeenCalled();
    },
  );
});
