// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { agentComposerDraftStore } from "../../application/agentComposerDrafts";
import { workbenchAgentPaletteProvider } from "../../application/commandPalette/commandPaletteProvider";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import { waitForReact } from "../../test/reactTestLifecycle";
import { FakeRunnerHost, fakeRunnerFleetGateway } from "../../test/remoteRunnerOutageTestSupport";
import { retryableLazy } from "../retryableLazy";
import { RemoteRunnerProvider } from "../remoteRunner/RemoteRunnerProvider";
import { AgentModeView } from "./AgentModeView";
import { AGENT_SERVER_RECONNECTING_GRACE_MS } from "./agentServerReachabilityPresentation";
import { SURFACE_FIXTURE_ROOT } from "./agentSurfaceTestFixtures";
import { projectFixture, threadsSurfaceFixture } from "./agentThreadsSurfaceTestFixtures";
import { chromeFixture } from "./agentWorkbenchChromeTestFixtures";

const DRAFT = "Keep going with the migration";
const LazyAgentWorkspace = retryableLazy<ComponentProps<typeof AgentModeView>>(
  () => Promise.resolve({ default: AgentModeView }),
  "agent workspace",
);

describe("agent workspace while a server is not reachable", () => {
  let host: HTMLDivElement;
  let root: Root;
  let consoleError: MockInstance<typeof console.error>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    agentComposerDraftStore.reset();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    consoleError = vi.spyOn(console, "error");
  });

  afterEach(() => {
    act(() => root.unmount());
    expect(
      consoleError.mock.calls
        .map((args) =>
          args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(" "),
        )
        .filter((entry) => /Maximum update depth|Too many re-renders/.test(entry)),
    ).toEqual([]);
    host.remove();
    agentComposerDraftStore.reset();
    vi.restoreAllMocks();
  });

  async function mount(hosts: readonly FakeRunnerHost[], selected: FakeRunnerHost) {
    const fleet = fakeRunnerFleetGateway(hosts);
    await act(async () =>
      root.render(
        <RemoteRunnerProvider gateway={fleet.gateway}>
          <LazyAgentWorkspace
            agents={{
              ...threadsSurfaceFixture(),
              providerManagement: unconfiguredAgentProviderManagement(),
            }}
            projects={[projectFixture()]}
            workspaceRoot={SURFACE_FIXTURE_ROOT}
            overflowRootPaths={[]}
            providerEnabled={{ claudeCode: true, codex: true }}
            chrome={chromeFixture()}
            onTrustProject={() => undefined}
            onReleaseProject={() => undefined}
            onOpenEnvironmentSettings={() => undefined}
          />
        </RemoteRunnerProvider>,
      ),
    );
    const label = `${selected.options.name} app`;
    await waitForReact(() => {
      const palette = workbenchAgentPaletteProvider.current();
      expect(palette?.projects.find((entry) => entry.label === label)).toBeDefined();
    });
    const palette = workbenchAgentPaletteProvider.current();
    const project = palette!.projects.find((entry) => entry.label === label)!;
    act(() => {
      palette!.switchProject(project.key);
    });
    await waitForReact(() => expect(row(selected)).not.toBeNull());
    act(() => row(selected)!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await waitForReact(() =>
      expect(
        host.querySelector(`section[aria-label="Agent thread ${selected.threadId}"]`),
      ).not.toBeNull(),
    );
    for (const entry of hosts) entry.emit("connected");
    await settle(400);
    return fleet;
  }

  async function settle(milliseconds: number): Promise<void> {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
    });
  }

  function row(runner: FakeRunnerHost): HTMLElement | null {
    return host.querySelector<HTMLElement>(`[data-thread-id="${runner.threadId}"]`);
  }

  function rowStatus(runner: FakeRunnerHost): string | null {
    return row(runner)?.querySelector(".cv-card-row__status-label")?.textContent ?? null;
  }

  function promptField(): HTMLTextAreaElement {
    const field = host.querySelector<HTMLTextAreaElement>("#agent-prompt");
    expect(field).not.toBeNull();
    return field ?? document.createElement("textarea");
  }

  function type(text: string): void {
    const field = promptField();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        field,
        text,
      );
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("blocks a send during the outage with a named reason and keeps the draft", async () => {
    const linux = new FakeRunnerHost({
      id: "linux",
      name: "Linux",
      capabilities: { pendingMessages: true, taskSteering: true },
    });
    const fleet = await mount([linux], linux);
    linux.goDown();
    await settle(700);

    type(DRAFT);
    const send = host.querySelector<HTMLButtonElement>('button[aria-label="Queue message"]');
    expect(send).not.toBeNull();
    expect(send?.disabled).toBe(false);
    await act(async () => send?.click());
    await settle(100);

    expect(promptField().value).toBe(DRAFT);
    expect(host.textContent).toContain(
      "Message not sent: Linux is reconnecting. Your draft is kept.",
    );
    expect(host.textContent).not.toContain("The runner is unreachable.");
    expect(fleet.spies.enqueueMessage).not.toHaveBeenCalled();
    expect(fleet.spies.steerTask).not.toHaveBeenCalled();
    expect(fleet.spies.continueTask).not.toHaveBeenCalled();

    await settle(AGENT_SERVER_RECONNECTING_GRACE_MS);
    expect(host.textContent).toContain("Linux is reconnecting…");
    expect(promptField().value).toBe(DRAFT);

    linux.comeBack();
    await settle(700);

    expect(host.textContent).not.toContain("Linux is reconnecting…");
    expect(host.textContent).not.toContain("Message not sent");
    expect(promptField().value).toBe(DRAFT);
  }, 60_000);

  it("marks only the rail rows of the unreachable server", async () => {
    const linux = new FakeRunnerHost({ id: "linux", name: "Linux" });
    const mac = new FakeRunnerHost({ id: "mac", name: "Mac" });
    await mount([linux, mac], linux);
    await waitForReact(() => expect(row(mac)).not.toBeNull());
    expect(rowStatus(linux)).toBe("Working");
    expect(rowStatus(mac)).toBe("Working");

    linux.goDown();
    await settle(700);

    expect(rowStatus(linux)).toBe("Waiting for server");
    expect(rowStatus(mac)).toBe("Working");
    expect(host.textContent).toContain("Waiting for Linux…");

    linux.comeBack();
    await settle(700);

    expect(rowStatus(linux)).toBe("Working");
    expect(rowStatus(mac)).toBe("Working");
    expect(host.textContent).not.toContain("Waiting for Linux…");
  }, 60_000);
});
