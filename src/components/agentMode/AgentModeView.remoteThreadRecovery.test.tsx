// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { agentComposerDraftStore } from "../../application/agentComposerDrafts";
import { remoteAgentProjectKey } from "../../application/remoteAgentProjection";
import type { RemoteRunnerServer } from "../../domain/remoteRunner";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import { waitForReact } from "../../test/reactTestLifecycle";
import { FakeRunnerHost, fakeRunnerFleetGateway } from "../../test/remoteRunnerOutageTestSupport";
import { RemoteRunnerProvider } from "../remoteRunner/RemoteRunnerProvider";
import {
  useRemoteRunnerContext,
  type RemoteRunnerContextValue,
} from "../remoteRunner/remoteRunnerContext";
import { AgentModeView } from "./AgentModeView";
import { SURFACE_FIXTURE_ROOT } from "./agentSurfaceTestFixtures";
import { projectFixture, threadsSurfaceFixture } from "./agentThreadsSurfaceTestFixtures";
import { chromeFixture } from "./agentWorkbenchChromeTestFixtures";
import { NO_SCOPE_STATE, type AgentNavigationSession } from "./useAgentThreadNavigation";

const DRAFT = "Continue the migration on Linux";
const DISCONNECTED_MESSAGE = "Linux is disconnected. This thread lives on the server.";
const WAITING_MESSAGE = "Waiting for the server conversation to load.";

describe("a selected server thread whose server is disconnected or removed", () => {
  let host: HTMLDivElement;
  let root: Root;
  let consoleError: MockInstance<typeof console.error>;
  let context: RemoteRunnerContextValue | null;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    agentComposerDraftStore.reset();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    context = null;
    consoleError = vi.spyOn(console, "error");
  });

  afterEach(() => {
    act(() => root.unmount());
    expect(
      consoleError.mock.calls
        .map((args) => args.map((arg) => String(arg)).join(" "))
        .filter((entry) => /Maximum update depth|Too many re-renders/.test(entry)),
    ).toEqual([]);
    host.remove();
    agentComposerDraftStore.reset();
    vi.restoreAllMocks();
  });

  function ContextProbe() {
    context = useRemoteRunnerContext();
    return null;
  }

  function remote(): RemoteRunnerContextValue {
    expect(context).not.toBeNull();
    return context!;
  }

  function sessionFor(threadId: string, projectId: string): AgentNavigationSession {
    const projectKey = remoteAgentProjectKey("linux", "runner", projectId);
    return {
      current: {
        selectedThreadId: threadId,
        selectedThreadOwnerKey: JSON.stringify({
          rootKey: projectKey,
          ownerId: projectKey,
          repositoryRoot: projectKey,
        }),
        scopeState: NO_SCOPE_STATE,
      },
    };
  }

  async function mount(
    gateway: ReturnType<typeof fakeRunnerFleetGateway>["gateway"],
    threadId: string,
    projectId = "project",
  ): Promise<void> {
    await act(async () =>
      root.render(
        <RemoteRunnerProvider gateway={gateway}>
          <ContextProbe />
          <AgentModeView
            agents={{
              ...threadsSurfaceFixture(),
              providerManagement: unconfiguredAgentProviderManagement(),
            }}
            projects={[projectFixture()]}
            workspaceRoot={SURFACE_FIXTURE_ROOT}
            overflowRootPaths={[]}
            providerEnabled={{ claudeCode: true, codex: true }}
            chrome={chromeFixture()}
            navigationSession={sessionFor(threadId, projectId)}
            onTrustProject={() => undefined}
            onReleaseProject={() => undefined}
            onOpenEnvironmentSettings={() => undefined}
          />
        </RemoteRunnerProvider>,
      ),
    );
  }

  function disconnectedLinux(): FakeRunnerHost {
    const linux = new FakeRunnerHost({ id: "linux", name: "Linux", connected: false });
    linux.up = false;
    return linux;
  }

  function button(label: string): HTMLButtonElement | null {
    return (
      [...host.querySelectorAll<HTMLButtonElement>(".cv-composer-banner button")].find(
        (candidate) => candidate.textContent === label,
      ) ?? null
    );
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

  function sendButton(): HTMLButtonElement | null {
    return host.querySelector<HTMLButtonElement>('.agent-composer button[type="submit"]');
  }

  function runOnLabel(): string | null {
    return host.querySelector("#agent-run-on")?.getAttribute("aria-label") ?? null;
  }

  function threadSection(threadId: string): Element | null {
    return host.querySelector(`section[aria-label="Agent thread ${threadId}"]`);
  }

  async function expectNewLocalThread(): Promise<void> {
    await vi.waitFor(
      async () => {
        await act(async () => Promise.resolve());
        expect(
          host.querySelector('form.agent-composer[aria-label="New agent thread"]'),
        ).not.toBeNull();
      },
      { timeout: 3_000 },
    );
    expect([null, "Run on: This computer"]).toContain(runOnLabel());
    expect(host.textContent).not.toContain(WAITING_MESSAGE);
    expect(host.querySelector(".cv-composer-banner")?.textContent ?? "").not.toContain(
      "This thread lives on the server",
    );
    expect(host.querySelector(".agent-composer__lock")?.textContent ?? "").not.toContain(
      "Runs on:Server",
    );
    expect(host.querySelector("button#agent-launch-model")?.textContent).not.toContain(
      "Server default",
    );
    expect(promptField().disabled).toBe(false);
  }

  it("shows a bounded disconnected banner, keeps the draft, and connects that exact server", async () => {
    const linux = disconnectedLinux();
    const fleet = fakeRunnerFleetGateway([linux]);
    await mount(fleet.gateway, linux.threadId);

    await waitForReact(() => expect(host.textContent).toContain(DISCONNECTED_MESSAGE));
    expect(host.textContent).not.toContain(WAITING_MESSAGE);
    expect(button("Connect")?.disabled).toBe(false);
    expect(button("New thread")).not.toBeNull();
    type(DRAFT);
    expect(sendButton()?.disabled).toBe(true);
    expect(agentComposerDraftStore.readDraft(linux.threadId)).toBe(DRAFT);

    linux.up = true;
    fleet.spies.connectServer.mockClear();
    await act(async () => button("Connect")?.click());

    expect(fleet.spies.connectServer).toHaveBeenCalledTimes(1);
    expect(fleet.spies.connectServer).toHaveBeenCalledWith({
      id: "linux",
      name: "Linux",
      host: "linux",
      username: "codex",
      port: 22,
    });
    await waitForReact(() => expect(threadSection(linux.threadId)).not.toBeNull());
    expect(host.textContent).not.toContain(DISCONNECTED_MESSAGE);
    expect(promptField().value).toBe(DRAFT);
  });

  it("reports a failed connect in the banner instead of waiting", async () => {
    const linux = disconnectedLinux();
    const fleet = fakeRunnerFleetGateway([linux]);
    await mount(fleet.gateway, linux.threadId);
    await waitForReact(() => expect(button("Connect")?.disabled).toBe(false));

    await act(async () => button("Connect")?.click());

    await waitForReact(() =>
      expect(host.querySelector('.cv-composer-banner [role="alert"]')?.textContent).toContain(
        "unreachable",
      ),
    );
    expect(host.textContent).toContain(DISCONNECTED_MESSAGE);
    expect(host.textContent).not.toContain(WAITING_MESSAGE);
    expect(button("Connect")?.disabled).toBe(false);
  });

  it("opens a new thread in the current project from the banner without losing the draft", async () => {
    const linux = disconnectedLinux();
    const fleet = fakeRunnerFleetGateway([linux]);
    await mount(fleet.gateway, linux.threadId);
    await waitForReact(() => expect(button("New thread")).not.toBeNull());
    type(DRAFT);

    act(() => button("New thread")?.click());

    await expectNewLocalThread();
    expect(agentComposerDraftStore.readDraft(linux.threadId)).toBe(DRAFT);
  });

  it("clears the selection to a new local thread when the server is no longer registered", async () => {
    const fleet = fakeRunnerFleetGateway([]);
    await mount(fleet.gateway, "remote-thread:linux:runner:first");

    await expectNewLocalThread();
    expect(threadSection("remote-thread:linux:runner:first")).toBeNull();
  });

  it("waits for the server list before deciding the server was removed", async () => {
    const fleet = fakeRunnerFleetGateway([]);
    let release: (servers: readonly RemoteRunnerServer[]) => void = () => undefined;
    fleet.spies.listServers.mockImplementationOnce(
      () =>
        new Promise<RemoteRunnerServer[]>((resolve) => {
          release = (servers) => resolve([...servers]);
        }),
    );
    await mount(fleet.gateway, "remote-thread:linux:runner:first");

    await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 50)));
    expect(host.textContent).toContain(WAITING_MESSAGE);
    expect(runOnLabel()).not.toBe("Run on: This computer");

    await act(async () => release([]));

    await expectNewLocalThread();
  });

  it("falls back to This computer when the selected server is removed in Settings", async () => {
    const linux = disconnectedLinux();
    const hosts = [linux];
    const fleet = fakeRunnerFleetGateway(hosts);
    await mount(fleet.gateway, linux.threadId);
    await waitForReact(() => expect(host.textContent).toContain(DISCONNECTED_MESSAGE));
    act(() => remote().selectServer("linux"));
    expect(remote().selectedServerId).toBe("linux");

    hosts.splice(0, hosts.length);
    await act(async () => remote().remove("linux"));

    await expectNewLocalThread();
    expect(remote().selectedServerId).toBeNull();
  });

  it("does not reselect the thread when it appears after the fallback", async () => {
    const linux = new FakeRunnerHost({ id: "linux", name: "Linux" });
    const hosts: FakeRunnerHost[] = [];
    const fleet = fakeRunnerFleetGateway(hosts);
    await mount(fleet.gateway, linux.threadId);
    await expectNewLocalThread();

    hosts.push(linux);
    await act(async () => remote().refresh());

    await waitForReact(() =>
      expect(host.querySelector(`[data-thread-id="${linux.threadId}"]`)).not.toBeNull(),
    );
    expect(threadSection(linux.threadId)).toBeNull();
    expect(runOnLabel()).toBe("Run on: This computer");
  });

  it("leaves the waiting state when the server drops while the conversation loads", async () => {
    const linux = new FakeRunnerHost({ id: "linux", name: "Linux" });
    const fleet = fakeRunnerFleetGateway([linux]);
    fleet.spies.getRunner.mockImplementation(() => new Promise(() => undefined));
    await mount(fleet.gateway, linux.threadId);
    await waitForReact(() => expect(host.textContent).toContain(WAITING_MESSAGE));

    await act(async () => remote().disconnect("linux"));

    await waitForReact(() => expect(host.textContent).toContain(DISCONNECTED_MESSAGE));
    expect(host.textContent).not.toContain(WAITING_MESSAGE);
    expect(button("Connect")).not.toBeNull();
  });

  it("opens a new thread when the connected server no longer has the conversation", async () => {
    const linux = new FakeRunnerHost({ id: "linux", name: "Linux" });
    const fleet = fakeRunnerFleetGateway([linux]);
    const deleted = linux.threadId.replace(/:first$/, ":deleted");
    await mount(fleet.gateway, deleted, "archived-project");
    await waitForReact(() =>
      expect(host.querySelector(`[data-thread-id="${linux.threadId}"]`)).not.toBeNull(),
    );
    expect(host.textContent).toContain(WAITING_MESSAGE);

    await expectNewLocalThread();
    expect(threadSection(deleted)).toBeNull();
  });
});
