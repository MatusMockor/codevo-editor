// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAttachmentGateway } from "../../application/agentAttachmentPorts";
import { agentComposerDraftStore } from "../../application/agentComposerDrafts";
import type { AgentThreadsSurface } from "../../application/agentThreadPorts";
import {
  removeRemoteProjectLink,
  saveRemoteProjectLink,
} from "../../application/remoteProjectLinks";
import { useAgentComposerAttachments } from "../../application/useAgentComposerAttachments";
import type { AgentImageSurfacePort } from "../../domain/agentImageShrink";
import type { RemoteRunnerGateway } from "../../domain/remoteRunner";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import { waitForReact } from "../../test/reactTestLifecycle";
import { RemoteRunnerProvider } from "../remoteRunner/RemoteRunnerProvider";
import { AgentModeView } from "./AgentModeView";
import { SURFACE_FIXTURE_ROOT } from "./agentSurfaceTestFixtures";
import { projectFixture, threadsSurfaceFixture } from "./agentThreadsSurfaceTestFixtures";
import { chromeFixture } from "./agentWorkbenchChromeTestFixtures";

const SERVER_PROJECT = "remote:linux:runner:project";
const PROMPT = "Fix the login flow";

const IMAGE_SURFACE: AgentImageSurfacePort = {
  decode: async () => ({ width: 64, height: 64 }),
  encodeMime: async () => "image/png",
  encode: async () => new ArrayBuffer(16),
  release: () => undefined,
};

function runnerGateway(): RemoteRunnerGateway {
  return {
    collectInstructions: vi.fn().mockResolvedValue({ version: 1, files: [] }),
    listServers: vi.fn().mockResolvedValue([
      {
        id: "linux",
        name: "Linux server",
        host: "linux",
        username: "codex",
        port: 22,
        connected: true,
      },
    ]),
    connectServer: vi.fn(),
    disconnectServer: vi.fn(),
    removeServer: vi.fn(),
    getRunner: vi.fn().mockResolvedValue({
      protocolVersion: 1,
      runnerId: "runner",
      name: "Linux server",
      capabilities: {
        taskExecution: true,
        instructionSync: true,
        eventReplay: true,
        taskContinuation: true,
        taskLaunchOptions: true,
      },
    }),
    listProjects: vi.fn().mockResolvedValue({ items: [{ id: "project", name: "Server app" }] }),
    cloneProject: vi.fn(),
    getProjectClone: vi.fn(),
    cancelProjectClone: vi.fn(),
    listTasks: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    createTask: vi.fn(),
    startTask: vi.fn(),
    getTask: vi.fn(),
    getTaskResume: vi.fn().mockResolvedValue({ available: true, reason: null }),
    continueTask: vi.fn(),
    cancelTask: vi.fn(),
    listEvents: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    getDiff: vi.fn().mockResolvedValue({ diff: "", truncated: false }),
    uploadAttachment: vi.fn(),
    getAttachment: vi.fn(),
    readAttachment: vi.fn(),
  } as unknown as RemoteRunnerGateway;
}

function localAttachmentGateway() {
  let sequence = 0;
  const released: string[] = [];
  const gateway: AgentAttachmentGateway = {
    stageAgentAttachmentBytes: vi.fn(async ({ name, mime, bytes }) => ({
      attachmentId: (sequence += 1).toString(16).padStart(32, "0"),
      name,
      mime,
      bytes: bytes.byteLength,
      width: 64,
      height: 64,
      promptLineBytesMax: 120,
    })),
    inspectAgentAttachmentCandidate: vi.fn(async () => null),
    readAgentAttachmentCandidate: vi.fn(async () => new ArrayBuffer(0)),
    claimAgentAttachments: vi.fn(async () => []),
    releaseAgentAttachment: vi.fn(async ({ attachmentId }) => {
      released.push(attachmentId);
    }),
    readAgentAttachment: vi.fn(async () => new ArrayBuffer(0)),
    revealAgentAttachment: vi.fn(async () => undefined),
  };
  return { gateway, released };
}

describe("agent workbench draft across the Run on picker", () => {
  let host: HTMLDivElement;
  let root: Root;
  let local: ReturnType<typeof localAttachmentGateway>;
  let surface: AgentThreadsSurface;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    let nextUrl = 0;
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = () => `blob:run-on-${(nextUrl += 1)}`;
        static revokeObjectURL = () => undefined;
      },
    );
    agentComposerDraftStore.reset();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    local = localAttachmentGateway();
    surface = threadsSurfaceFixture();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    agentComposerDraftStore.reset();
    removeRemoteProjectLink(SERVER_PROJECT);
    vi.unstubAllGlobals();
  });

  function Workbench() {
    const attachments = useAgentComposerAttachments({
      gateway: local.gateway,
      imageSurface: IMAGE_SURFACE,
      resolveOwner: (projectRootKey) =>
        projectRootKey === SURFACE_FIXTURE_ROOT
          ? {
              projectRootKey,
              ownerId: "agent-root:app",
              generation: 0,
              workspaceId: "workspace-1",
            }
          : null,
      reportError: () => undefined,
    });
    return (
      <AgentModeView
        imageSurface={IMAGE_SURFACE}
        agents={{
          ...surface,
          attachments,
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
    );
  }

  async function mount(): Promise<RemoteRunnerGateway> {
    const gateway = runnerGateway();
    await act(async () =>
      root.render(
        <RemoteRunnerProvider gateway={gateway}>
          <Workbench />
        </RemoteRunnerProvider>,
      ),
    );
    await waitForReact(() => expect(gateway.listProjects).toHaveBeenCalled());
    await waitForReact(() =>
      expect(host.querySelector('[aria-label="Run on: This computer"]')).not.toBeNull(),
    );
    return gateway;
  }

  function textarea(): HTMLTextAreaElement {
    const field = host.querySelector<HTMLTextAreaElement>(".agent-composer textarea");
    expect(field).not.toBeNull();
    return field ?? document.createElement("textarea");
  }

  function click(element: Element | null | undefined): void {
    expect(element ?? null).not.toBeNull();
    act(() => {
      element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  function typePrompt(text: string): void {
    const field = textarea();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    expect(setter).toBeDefined();
    act(() => {
      setter?.call(field, text);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function pasteImage(): Promise<void> {
    const file = new File([new Uint8Array(16)], "clipboard.png", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(16) });
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { files: [file], getData: () => "" },
    });
    act(() => {
      textarea().dispatchEvent(event);
    });
    await readyImage();
  }

  function pasteSlowImage(): (bytes: ArrayBuffer) => void {
    let finish: (bytes: ArrayBuffer) => void = () => undefined;
    const file = new File([new Uint8Array(16)], "clipboard.png", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", {
      value: () =>
        new Promise<ArrayBuffer>((resolve) => {
          finish = resolve;
        }),
    });
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { files: [file], getData: () => "" },
    });
    act(() => {
      textarea().dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    return (bytes) => finish(bytes);
  }

  async function readyImage(): Promise<void> {
    await waitForReact(() =>
      expect(host.querySelectorAll('[data-agent-attachment-state="ready"]')).toHaveLength(1),
    );
    expect(host.querySelector('[aria-label="Preview clipboard.png"]')).not.toBeNull();
  }

  function runOn(current: string, next: string): void {
    click(host.querySelector(`[aria-label="Run on: ${current}"]`));
    click(
      [...document.querySelectorAll('[role="menuitemradio"]')].find((entry) =>
        entry.textContent?.includes(next),
      ),
    );
  }

  it("keeps the prompt and the pasted image when Run on moves a linked project to its server and back", async () => {
    saveRemoteProjectLink(SERVER_PROJECT, SURFACE_FIXTURE_ROOT);
    await mount();
    typePrompt(PROMPT);
    await pasteImage();

    runOn("This computer", "Linux server");
    await waitForReact(() =>
      expect(host.querySelector('[aria-label="Run on: Linux server"]')).not.toBeNull(),
    );

    expect(host.querySelector('[aria-label="Choose server project"]')).toBeNull();
    expect(textarea().value).toBe(PROMPT);
    await readyImage();
    expect(local.released).toHaveLength(1);
    expect(agentComposerDraftStore.snapshot()).toEqual([[`new:${SERVER_PROJECT}`, PROMPT]]);

    runOn("Linux server", "This computer");
    await waitForReact(() =>
      expect(host.querySelector('[aria-label="Run on: This computer"]')).not.toBeNull(),
    );

    expect(textarea().value).toBe(PROMPT);
    await readyImage();
    expect(agentComposerDraftStore.snapshot()).toEqual([[`new:${SURFACE_FIXTURE_ROOT}`, PROMPT]]);
  });

  it("keeps an image whose clipboard read finishes after Run on moved the draft to its server", async () => {
    saveRemoteProjectLink(SERVER_PROJECT, SURFACE_FIXTURE_ROOT);
    await mount();
    typePrompt(PROMPT);
    const finishRead = pasteSlowImage();

    runOn("This computer", "Linux server");
    await waitForReact(() =>
      expect(host.querySelector('[aria-label="Run on: Linux server"]')).not.toBeNull(),
    );
    expect(host.querySelector("[data-agent-attachment-state]")).toBeNull();

    await act(async () => finishRead(new ArrayBuffer(16)));
    await readyImage();
    expect(textarea().value).toBe(PROMPT);
    expect(local.gateway.stageAgentAttachmentBytes).not.toHaveBeenCalled();
  });

  it("keeps an image whose clipboard read finishes while the server project is still being chosen", async () => {
    await mount();
    const finishRead = pasteSlowImage();

    runOn("This computer", "Linux server");
    await waitForReact(() =>
      expect(host.querySelector('[aria-label="Choose server project"] select')).not.toBeNull(),
    );
    await act(async () => finishRead(new ArrayBuffer(16)));
    await waitForReact(() =>
      expect(host.querySelectorAll('[data-agent-attachment-state="ready"]')).toHaveLength(1),
    );
    expect(local.gateway.stageAgentAttachmentBytes).toHaveBeenCalledOnce();

    const select = host.querySelector<HTMLSelectElement>(
      '[aria-label="Choose server project"] select',
    );
    act(() => {
      if (select === null) return;
      select.value = SERVER_PROJECT;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await waitForReact(() => expect(textarea().disabled).toBe(false));
    await readyImage();
    expect(local.released).toHaveLength(1);
  });

  it("keeps the prompt and the pasted image through the server project chooser", async () => {
    await mount();
    typePrompt(PROMPT);
    await pasteImage();

    runOn("This computer", "Linux server");
    await waitForReact(() =>
      expect(host.querySelector('[aria-label="Choose server project"] select')).not.toBeNull(),
    );

    expect(textarea().value).toBe(PROMPT);
    expect(host.querySelectorAll('[data-agent-attachment-state="ready"]')).toHaveLength(1);
    expect(local.released).toEqual([]);

    const select = host.querySelector<HTMLSelectElement>(
      '[aria-label="Choose server project"] select',
    );
    act(() => {
      if (select === null) return;
      select.value = SERVER_PROJECT;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await waitForReact(() => expect(textarea().disabled).toBe(false));

    expect(textarea().value).toBe(PROMPT);
    await readyImage();
    expect(local.released).toHaveLength(1);
    expect(agentComposerDraftStore.snapshot()).toEqual([[`new:${SERVER_PROJECT}`, PROMPT]]);
  });
});
