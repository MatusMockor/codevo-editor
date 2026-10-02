// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTasksNotice, AgentThreadView } from "../../application/agentThreadPorts";
import {
  agentThreadAttention,
  agentThreadUnread,
  type AgentThread,
  type AgentTurnStatus,
} from "../../domain/agentThread";
import type { RemoteRunnerDescriptor, RemoteRunnerServer } from "../../domain/remoteRunner";
import type {
  RemoteListeningPort,
  RemotePortCloseRequest,
  RemotePortListRequest,
  RemotePortOpenRequest,
} from "../../domain/remotePortPreviewWire";
import type { TextClipboardGateway } from "../../domain/textClipboard";
import { TauriRemotePortPreviewGateway } from "../../infrastructure/tauriRemotePortPreviewGateway";
import { RemotePortPreviewMenu } from "./RemotePortPreviewMenu";
import { REMOTE_PORTS_AGENT_LIFETIME_NOTE } from "./remotePortPreviewPresentation";
import {
  agentRemotePortOwner,
  useAgentServerPorts,
  type AgentServerPorts,
  type AgentServerPortsInput,
} from "./useAgentServerPorts";

const RUNNER_ID = "7389088c-29b8-4cec-9a15-e825e1fb2f66";
const TASK_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const OWNER = { ownerId: "workspace-a", ownerGeneration: 3 };
const SERVER: RemoteRunnerServer = {
  id: "linux",
  name: "build-box",
  host: "build.example",
  username: "dev",
  port: 22,
  connected: true,
};

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(reason: unknown): void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function listening(
  port: number,
  source: RemoteListeningPort["source"] = "agent",
  address: RemoteListeningPort["address"] = "loopback-v4",
  process = "node",
): RemoteListeningPort {
  return { port, address, source, process };
}

function fakeRunnerIpc() {
  const state = {
    ports: [listening(3000)] as RemoteListeningPort[],
    forwards: new Map<number, number>(),
    listFailure: null as string | null,
    listGate: null as Deferred<void> | null,
    openGate: null as Deferred<void> | null,
    openFailure: null as string | null,
  };
  const calls: { command: string; request: unknown }[] = [];
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    const request = args?.request;
    calls.push({ command, request });
    switch (command) {
      case "remote_port_list": {
        if (state.listGate !== null) await state.listGate.promise;
        if (state.listFailure !== null) throw state.listFailure;
        return {
          ports: state.ports.map((entry) => {
            const localPort = state.forwards.get(entry.port);
            return {
              ...entry,
              forward: localPort === undefined ? null : { localPort, state: "open" },
            };
          }),
          truncated: false,
          scannedAt: "2026-10-02T09:15:00.000Z",
        };
      }
      case "remote_port_open": {
        const open = request as RemotePortOpenRequest;
        if (state.openGate !== null) await state.openGate.promise;
        if (state.openFailure !== null) throw state.openFailure;
        if (!state.ports.some((entry) => entry.port === open.port))
          throw `Nothing is listening on port ${open.port} for this server conversation.`;
        state.forwards.set(open.port, open.port + 40000);
        return { localPort: open.port + 40000 };
      }
      case "remote_port_close": {
        state.forwards.delete((request as RemotePortCloseRequest).port);
        return null;
      }
      default:
        throw new Error(`Unexpected command ${command}`);
    }
  });
  const commands = (name: string) => calls.filter((call) => call.command === name);
  return { state, invoke, calls, commands };
}

function descriptor(portPreview: boolean): RemoteRunnerDescriptor {
  return {
    protocolVersion: 1,
    runnerId: RUNNER_ID,
    name: "runner",
    capabilities: { taskExecution: true, eventReplay: true, portPreview },
  };
}

const TASK_B = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

function serverThread(
  status: AgentTurnStatus = { kind: "running" },
  taskId = TASK_ID,
): AgentThreadView {
  const local = localThread(status);
  return {
    ...local,
    execution: {
      kind: "remote",
      serverId: SERVER.id,
      runnerId: RUNNER_ID,
      projectId: "app",
      conversationId: "conversation-1",
      latestTaskId: taskId,
      resume: null,
    },
  };
}

function localThread(status: AgentTurnStatus = { kind: "running" }): AgentThreadView {
  const thread: AgentThread = {
    threadId: "agt-1",
    owner: {
      rootKey: "/workspace/app",
      ownerId: "agent-root:app",
      repositoryRoot: "/workspace/app",
    },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "claudeCode", sessionId: null },
    title: "Dev server",
    pinned: false,
    archived: false,
    createdAtEpochMs: 1,
    updatedAtEpochMs: 1,
    turns: [
      {
        turnId: "agt-1-t1",
        prompt: "start the dev server",
        status,
        startedAtEpochMs: 1,
        endedAtEpochMs: null,
        events: [],
        eventsTruncated: false,
        lastStatusSequence: 0,
        lastOutputSequence: 0,
        launch: null,
        cliVersion: null,
      },
    ],
    turnsTruncated: false,
    viewedAtEpochMs: null,
    externalOrigin: null,
    integration: null,
  };
  return {
    ship: { kind: "idle", status: null, loadingStatus: false },
    editorAvailability: { kind: "available" },
    attention: agentThreadAttention(thread),
    unread: agentThreadUnread(thread),
    thread,
    lifecycle: "settled",
    repositoryLabel: "app",
    projectOrigin: "active-tab",
    worktreeRemoved: false,
    worktreeMissing: false,
    changeSummary: null,
  };
}

describe("server ports chip and server loopback links", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: AgentServerPorts | null;
  let renders: number;
  let notices: AgentTasksNotice[];
  let ipc: ReturnType<typeof fakeRunnerIpc>;
  let writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;

  function Harness({ input }: { readonly input: AgentServerPortsInput }) {
    const ports = useAgentServerPorts(input);
    latest = ports;
    renders += 1;
    return ports.menu === null ? null : <RemotePortPreviewMenu menu={ports.menu} />;
  }

  function input(overrides: Partial<AgentServerPortsInput> = {}): AgentServerPortsInput {
    const clipboard: TextClipboardGateway = { canWriteText: () => true, writeText };
    return {
      wiring: { port: new TauriRemotePortPreviewGateway(ipc.invoke), owner: OWNER },
      gateway: { getRunner: vi.fn(async () => descriptor(true)) },
      servers: [SERVER],
      thread: serverThread(),
      terminalOpen: false,
      clipboard,
      reportNotice: (notice) => notices.push(notice),
      ...overrides,
    };
  }

  async function settle(): Promise<void> {
    for (let round = 0; round < 6; round += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }

  async function render(overrides: Partial<AgentServerPortsInput> = {}): Promise<void> {
    act(() => root.render(<Harness input={input(overrides)} />));
    await settle();
  }

  function chip(): HTMLButtonElement | null {
    return host.querySelector<HTMLButtonElement>("button.cv-ports-chip");
  }

  async function openPanel(): Promise<HTMLElement> {
    const trigger = chip();
    expect(trigger).not.toBeNull();
    act(() => trigger?.click());
    const panel = document.body.querySelector<HTMLElement>(".cv-ports");
    expect(panel).not.toBeNull();
    return panel as HTMLElement;
  }

  function rows(panel: HTMLElement): string[] {
    return [...panel.querySelectorAll<HTMLElement>(".cv-ports__row")].map((row) =>
      (row.querySelector(".cv-ports__id")?.textContent ?? "").trim(),
    );
  }

  function button(panel: HTMLElement, label: string): HTMLButtonElement {
    const found = panel.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    expect(found).not.toBeNull();
    return found as HTMLButtonElement;
  }

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    latest = null;
    renders = 0;
    notices = [];
    ipc = fakeRunnerIpc();
    writeText = vi.fn(async () => undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("shows a Ports chip with the detected count and lists each port once with its process and source", async () => {
    ipc.state.ports = [
      listening(3000, "agent", "loopback-v4"),
      listening(3000, "agent", "loopback-v6"),
      listening(5173, "terminal", "any-v4", "vite"),
    ];
    await render();

    expect(chip()?.textContent).toBe("Ports2");
    expect(chip()?.getAttribute("aria-label")).toBe("Ports, 2 detected");
    const panel = await openPanel();
    expect(rows(panel)).toEqual(["3000node · agent", "5173vite · terminal"]);
    expect(panel.textContent).toContain(REMOTE_PORTS_AGENT_LIFETIME_NOTE);
    expect(ipc.commands("remote_port_list")[0]?.request).toEqual({
      serverId: SERVER.id,
      runnerId: RUNNER_ID,
      ownerId: OWNER.ownerId,
      ownerGeneration: OWNER.ownerGeneration,
      scope: { kind: "task", taskId: TASK_ID },
    } satisfies RemotePortListRequest);
  });

  it("opens a detected port through the forward, offers the local URL and stops forwarding", async () => {
    await render();
    const panel = await openPanel();

    await act(async () => button(panel, "Open port 3000 in browser").click());
    await settle();

    expect(ipc.commands("remote_port_open").map((call) => call.request)).toEqual([
      {
        serverId: SERVER.id,
        runnerId: RUNNER_ID,
        ownerId: OWNER.ownerId,
        ownerGeneration: OWNER.ownerGeneration,
        scope: { kind: "task", taskId: TASK_ID },
        port: 3000,
        scheme: "http",
        path: "/",
      },
    ]);
    expect(panel.querySelector(".cv-ports__row")?.getAttribute("data-forward")).toBe("open");
    expect(panel.textContent).toContain("Forwarded to 127.0.0.1:43000");

    await act(async () => button(panel, "Copy local URL for port 3000").click());
    expect(writeText).toHaveBeenCalledExactlyOnceWith("http://127.0.0.1:43000/");

    await act(async () => button(panel, "Stop forwarding port 3000").click());
    await settle();
    expect(ipc.commands("remote_port_close").map((call) => call.request)).toEqual([
      {
        serverId: SERVER.id,
        ownerId: OWNER.ownerId,
        ownerGeneration: OWNER.ownerGeneration,
        scope: { kind: "task", taskId: TASK_ID },
        port: 3000,
      },
    ]);
    expect(panel.querySelector(".cv-ports__row")?.getAttribute("data-forward")).toBe("none");
    expect(panel.querySelector('button[aria-label="Stop forwarding port 3000"]')).toBeNull();
  });

  it("shows the opening state while the forward starts and the failure reason when it fails", async () => {
    ipc.state.openGate = deferred<void>();
    ipc.state.openFailure = "SSH port forward failed. Check SSH access to the server.";
    await render();
    const panel = await openPanel();

    await act(async () => button(panel, "Open port 3000 in browser").click());
    const opening = button(panel, "Open port 3000 in browser");
    expect(opening.disabled).toBe(true);
    expect(opening.textContent).toBe("Opening…");
    expect(panel.textContent).toContain("Forwarding through SSH…");

    ipc.state.openGate.resolve();
    await settle();
    const row = panel.querySelector(".cv-ports__row");
    expect(row?.getAttribute("data-forward")).toBe("failed");
    expect(row?.querySelector('[role="alert"]')?.textContent).toBe(
      "SSH port forward failed. Check SSH access to the server.",
    );
    expect(button(panel, "Open port 3000 in browser").disabled).toBe(false);
  });

  it("says when nothing is listening and offers a retry after a listing failure", async () => {
    ipc.state.ports = [];
    await render();
    let panel = await openPanel();
    expect(panel.querySelector('[role="status"]')?.textContent).toBe(
      "Nothing is listening for this conversation yet.",
    );
    act(() => chip()?.click());

    ipc.state.listFailure = "Runner connection was superseded";
    act(() => latest?.menu?.surface.refresh());
    await settle();
    panel = await openPanel();
    expect(panel.querySelector('[role="alert"]')?.textContent).toContain(
      "Runner connection was superseded",
    );

    ipc.state.listFailure = null;
    ipc.state.ports = [listening(8080)];
    const listed = ipc.commands("remote_port_list").length;
    const retry = [...panel.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.textContent === "Retry",
    );
    expect(retry).toBeDefined();
    await act(async () => retry?.click());
    await settle();
    expect(ipc.commands("remote_port_list").length).toBe(listed + 1);
    expect(rows(panel)).toEqual(["8080node · agent"]);
  });

  it("moves focus into the panel and returns it to the chip on Escape", async () => {
    await render();
    const panel = await openPanel();
    expect(document.activeElement).toBe(button(panel, "Open port 3000 in browser"));

    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(document.body.querySelector(".cv-ports")).toBeNull();
    expect(document.activeElement).toBe(chip());
  });

  it("hides the chip and never contacts the server when the runner lacks port preview", async () => {
    await render({ gateway: { getRunner: vi.fn(async () => descriptor(false)) } });

    expect(chip()).toBeNull();
    await act(async () => latest?.serverLoopback.openLoopback("http://localhost:3000/"));
    expect(notices).toEqual([
      {
        kind: "info",
        message:
          "This link points to build-box. Update the runner to open server ports from this computer.",
        action: null,
      },
    ]);
    expect(ipc.calls).toEqual([]);
  });

  it("hides the chip without a workspace owner and explains why a server link cannot open", async () => {
    await render({ wiring: { port: new TauriRemotePortPreviewGateway(ipc.invoke), owner: null } });

    expect(chip()).toBeNull();
    await act(async () => latest?.serverLoopback.openLoopback("http://localhost:3000/"));
    expect(notices.map((notice) => notice.message)).toEqual([
      "Open a workspace on this computer to forward server ports.",
    ]);
    expect(ipc.calls).toEqual([]);
  });

  it("has no chip and never contacts the server for local threads", async () => {
    await render({ thread: localThread() });

    expect(chip()).toBeNull();
    expect(latest?.menu).toBeNull();
    expect(ipc.calls).toEqual([]);
  });

  it("explains that a link in a conversation that has not started cannot be forwarded yet", async () => {
    await render({ thread: null });

    await act(async () => latest?.serverLoopback.openLoopback("http://localhost:3000/"));
    expect(notices.map((notice) => notice.message)).toEqual([
      "This link points to localhost on the server. Open it after the conversation starts.",
    ]);
    expect(ipc.calls).toEqual([]);
  });

  it("keeps the same view and link port while polls return an unchanged listing", async () => {
    await render();
    const menu = latest?.menu;
    const serverLoopback = latest?.serverLoopback;
    const before = renders;

    for (let poll = 0; poll < 3; poll += 1) {
      act(() => latest?.menu?.surface.refresh());
      await settle();
    }

    expect(ipc.commands("remote_port_list").length).toBeGreaterThanOrEqual(4);
    expect(latest?.menu).toBe(menu);
    expect(latest?.serverLoopback).toBe(serverLoopback);
    expect(renders - before).toBeLessThanOrEqual(3);

    ipc.state.ports = [listening(3000), listening(4000)];
    act(() => latest?.menu?.surface.refresh());
    await settle();
    expect(latest?.menu).not.toBe(menu);
    expect(latest?.serverLoopback).toBe(serverLoopback);
  });

  it("opens a port that started after the last poll once a fresh listing confirms it", async () => {
    await render();
    ipc.state.ports = [listening(3000), listening(8080)];

    await act(async () => latest?.serverLoopback.openLoopback("http://localhost:8080/app"));
    await settle();

    expect(notices).toEqual([]);
    expect(ipc.commands("remote_port_open").map((call) => call.request)).toEqual([
      expect.objectContaining({ port: 8080, scheme: "http", path: "/app" }),
    ]);
  });

  it("drops a late listing and a late open failure after switching threads A to B to A", async () => {
    await render();
    ipc.state.listGate = deferred<void>();
    const pendingLink = latest?.serverLoopback.openLoopback("http://localhost:8080/");
    await render({ thread: serverThread({ kind: "running" }, TASK_B) });
    await render();
    ipc.state.ports = [listening(3000), listening(8080)];
    ipc.state.listGate.resolve();
    ipc.state.listGate = null;
    await act(async () => pendingLink);
    await settle();
    expect(ipc.commands("remote_port_open")).toEqual([]);
    expect(notices).toEqual([]);

    ipc.state.openGate = deferred<void>();
    ipc.state.openFailure = "SSH port forward failed. Check SSH access to the server.";
    const pendingOpen = latest?.serverLoopback.openLoopback("http://localhost:3000/");
    await settle();
    await render({ thread: serverThread({ kind: "running" }, TASK_B) });
    await render();
    ipc.state.openGate.resolve();
    await act(async () => pendingOpen);
    await settle();
    expect(ipc.commands("remote_port_open")).toHaveLength(1);
    expect(notices).toEqual([]);
  });

  it("checks the runner again when its capability check failed", async () => {
    const getRunner = vi
      .fn<() => Promise<RemoteRunnerDescriptor>>()
      .mockRejectedValueOnce(new Error("Runner request failed"))
      .mockResolvedValue(descriptor(true));
    const gateway = { getRunner };
    await render({ gateway });
    expect(chip()).toBeNull();

    await act(async () => latest?.serverLoopback.openLoopback("http://localhost:3000/"));
    await render({ gateway });

    expect(notices.map((notice) => notice.message)).toEqual([
      "Could not check build-box for ports. Checking again, try the link in a moment.",
    ]);
    expect(getRunner).toHaveBeenCalledTimes(2);
    expect(chip()).not.toBeNull();
  });

  it("keeps https from the opened link for the browser and the copied local URL", async () => {
    await render();
    await act(async () => latest?.serverLoopback.openLoopback("https://localhost:3000/"));
    await settle();
    const panel = await openPanel();

    await act(async () => button(panel, "Copy local URL for port 3000").click());
    expect(writeText).toHaveBeenCalledExactlyOnceWith("https://127.0.0.1:43000/");
    await act(async () => button(panel, "Open port 3000 in browser").click());
    await settle();
    expect(ipc.commands("remote_port_open").map((call) => call.request)).toEqual([
      expect.objectContaining({ port: 3000, scheme: "https", path: "/" }),
      expect.objectContaining({ port: 3000, scheme: "https", path: "/" }),
    ]);
  });

  it("keeps every panel action in the Tab order and stays open while focus moves inside", async () => {
    await render();
    await act(async () => latest?.serverLoopback.openLoopback("http://localhost:3000/"));
    await settle();
    const panel = await openPanel();

    const actions = [...panel.querySelectorAll<HTMLButtonElement>("button")];
    expect(actions.map((action) => action.getAttribute("aria-label"))).toEqual([
      "Open port 3000 in browser",
      "Copy local URL for port 3000",
      "Stop forwarding port 3000",
    ]);
    for (const action of actions) {
      expect(action.tabIndex).toBe(0);
      act(() => action.focus());
      expect(document.activeElement).toBe(action);
      expect(document.body.querySelector(".cv-ports")).not.toBeNull();
    }
  });

  it("opens a detected localhost link through the forward with the link's scheme and path", async () => {
    await render();

    await act(async () =>
      latest?.serverLoopback.openLoopback("https://localhost:3000/login?next=%2Fhome#top"),
    );
    await settle();

    expect(ipc.commands("remote_port_open").map((call) => call.request)).toEqual([
      expect.objectContaining({ port: 3000, scheme: "https", path: "/login?next=%2Fhome#top" }),
    ]);
    expect(notices).toEqual([]);
  });

  it("reports a port that is not running instead of opening it and re-lists the server", async () => {
    await render();
    const listed = ipc.commands("remote_port_list").length;

    await act(async () => latest?.serverLoopback.openLoopback("http://127.0.0.1:8080/"));
    await settle();

    expect(notices.map((notice) => notice.message)).toEqual([
      "Port 8080 is not running on the server. Open the server Terminal to keep a dev server running after the turn.",
    ]);
    expect(ipc.commands("remote_port_open")).toEqual([]);
    expect(ipc.commands("remote_port_list").length).toBe(listed + 1);
  });

  it("reports loopback links that cannot be forwarded and forward failures", async () => {
    ipc.state.openFailure = "SSH port forward did not become ready in time.";
    await render();

    await act(async () => latest?.serverLoopback.openLoopback("http://localhost/"));
    await act(async () => latest?.serverLoopback.openLoopback("http://[::1]:3000/"));
    await settle();

    expect(notices).toEqual([
      {
        kind: "info",
        message:
          "This link points to localhost on build-box and cannot be opened from this computer.",
        action: null,
      },
      { kind: "warning", message: "SSH port forward did not become ready in time.", action: null },
    ]);
  });
});

describe("agentRemotePortOwner", () => {
  it("accepts a registered workspace id with a positive admission token only", () => {
    expect(agentRemotePortOwner("workspace-a", 3)).toEqual(OWNER);
    expect(agentRemotePortOwner(null, 3)).toBeNull();
    expect(agentRemotePortOwner("workspace-a", null)).toBeNull();
    expect(agentRemotePortOwner("workspace-a", 0)).toBeNull();
    expect(agentRemotePortOwner(" ", 3)).toBeNull();
  });
});
