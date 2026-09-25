// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCloneComposerAttachments } from "../../application/cloneComposerAttachments";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import { projectFixture, threadsSurfaceFixture } from "./agentThreadsSurfaceTestFixtures";
import { AgentCloneComposer } from "./AgentCloneComposer";
import { MAX_AGENT_TASK_PROMPT_BYTES } from "../../domain/agentTask";

type Props = ComponentProps<typeof AgentCloneComposer>;
describe("normal composer for a cloning project", () => {
  let host: HTMLDivElement;
  let root: Root;
  let props: Props;
  const project = projectFixture();
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const agents = threadsSurfaceFixture({
      startThread: vi.fn(async () => ({ threadId: "new-thread" })),
    });
    props = {
      agents,
      projects: [project],
      providerEnabled: { claudeCode: true, codex: true },
      providerManagement: unconfiguredAgentProviderManagement(),
      modelFavoritesPersistence: null,
      onThreadStarted: vi.fn(),
      onOpenProviderSettings: vi.fn(),
      onTrustProject: vi.fn(),
      creation: {
        pending: {
          id: "clone-1",
          draftKey: "clone:stable",
          name: "app",
          environment: null,
          target: null,
        },
        pendingClone: {
          id: "clone-1",
          name: "app",
          status: "running",
          error: null,
          environment: "local",
        },
        attachmentsStore: createCloneComposerAttachments(),
        completedProject: null,
        draft: "Build the app",
        launch: { provider: "codex", model: "gpt-5.5", mode: "readOnly" },
        isolation: "in-place",
        changeDraft: vi.fn(),
        changeLaunch: vi.fn(),
        changeIsolation: vi.fn(),
        dismiss: vi.fn(),
        hidePending: vi.fn(),
        activateCompleted: vi.fn(),
        cancel: vi.fn(),
        retry: vi.fn(),
        canRetry: true,
        error: null,
        localCloneDetail: null,
      },
    };
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  async function render() {
    await act(async () => root.render(<AgentCloneComposer {...props} />));
  }
  function send() {
    return host.querySelector<HTMLButtonElement>(".agent-composer__send")!;
  }
  function complete() {
    props = {
      ...props,
      creation: {
        ...props.creation,
        pending: { ...props.creation.pending!, target: { kind: "local", path: project.rootPath } },
        pendingClone: { ...props.creation.pendingClone!, status: "succeeded" },
        completedProject: project,
      },
    };
  }
  it("keeps the full normal composer editable and blocks both button and form dispatch until ready", async () => {
    await render();
    expect(host.querySelectorAll("textarea")).toHaveLength(1);
    expect(host.querySelector("textarea")?.disabled).toBe(false);
    expect(host.querySelector("textarea")?.value).toBe("Build the app");
    expect(host.querySelector(".agent-composer__launch")).not.toBeNull();
    expect(send().disabled).toBe(true);
    await act(async () =>
      host
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(props.agents.startThread).not.toHaveBeenCalled();
    complete();
    await render();
    expect(props.agents.startThread).not.toHaveBeenCalled();
    expect(send().disabled).toBe(false);
    await act(async () => send().click());
    expect(props.agents.startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRootKey: project.rootKey,
        prompt: "Build the app",
        launch: props.creation.launch,
        isolation: "in-place",
      }),
    );
    expect(props.onThreadStarted).toHaveBeenCalledWith("new-thread");
  });
  it("requests exact project registration after cloning and never sends from a replaced owner", async () => {
    complete();
    props = { ...props, creation: { ...props.creation, completedProject: null } };
    await render();
    expect(props.creation.activateCompleted).toHaveBeenCalled();
    expect(send().disabled).toBe(true);
    complete();
    await render();
    expect(send().disabled).toBe(false);
    props = { ...props, projects: [{ ...project, generation: project.generation + 1 }] };
    await render();
    expect(send().disabled).toBe(true);
    expect(props.agents.startThread).not.toHaveBeenCalled();
  });
  it("keeps an oversized draft intact and prevents dispatch", async () => {
    complete();
    const text = "é".repeat(MAX_AGENT_TASK_PROMPT_BYTES / 2 + 1);
    props = { ...props, creation: { ...props.creation, draft: text } };
    await render();
    expect(host.querySelector("textarea")?.value).toBe(text);
    expect(send().disabled).toBe(true);
  });
  it("retains deferred attachments through a retry with a new job id", async () => {
    const store = props.creation.attachmentsStore;
    await store
      .forClone("clone:stable", "local")
      .add("clone:stable", [{ kind: "path", path: "/tmp/notes.md" }]);
    await render();
    expect(host.textContent).toContain("notes.md");
    props = {
      ...props,
      creation: {
        ...props.creation,
        pending: { ...props.creation.pending!, id: "clone-2" },
        pendingClone: { ...props.creation.pendingClone!, id: "clone-2" },
      },
    };
    await render();
    expect(host.textContent).toContain("notes.md");
    expect(send().disabled).toBe(true);
  });
  it("admits only one submission while dispatch is pending", async () => {
    let settle!: (value: { threadId: string } | null) => void;
    const startThread = vi.fn(
      () =>
        new Promise<{ threadId: string } | null>((resolve) => {
          settle = resolve;
        }),
    );
    props = { ...props, agents: threadsSurfaceFixture({ startThread }) };
    complete();
    await render();
    await act(async () => {
      const form = host.querySelector("form")!;
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(startThread).toHaveBeenCalledOnce();
    await act(async () => settle(null));
    expect(host.querySelector("textarea")?.value).toBe("Build the app");
    expect(send().disabled).toBe(false);
  });
  it("keeps an attachment transfer valid when inventory replaces an equivalent project descriptor", async () => {
    const backing = createCloneComposerAttachments();
    let release!: () => void;
    const pause = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prepareTurn = vi.fn(async () => null);
    const forDraft = vi.fn(() => ({
      ...backing.forClone(project.rootKey, "local"),
      captureIntake:
        () => async (sources: Parameters<Props["agents"]["attachments"]["add"]>[1]) => {
          await pause;
          await backing.forClone(project.rootKey, "local").add(project.rootKey, sources);
        },
      prepareTurn,
    }));
    props = {
      ...props,
      agents: threadsSurfaceFixture({ attachments: { ...forDraft(), forDraft } }),
    };
    await props.creation.attachmentsStore
      .forClone("clone:stable", "local")
      .add("clone:stable", [{ kind: "path", path: "/tmp/notes.md" }]);
    complete();
    await render();
    await act(async () => send().click());
    props = {
      ...props,
      projects: [{ ...project }],
      creation: { ...props.creation, completedProject: { ...project } },
    };
    await render();
    await act(async () => release());
    expect(prepareTurn).toHaveBeenCalledOnce();
    expect(forDraft).toHaveBeenCalledWith("clone-ready:clone:stable");
    expect(host.textContent).toContain("notes.md");
  });
  it("shows the trust banner for an untrusted clone and opens the dialog instead of sending", async () => {
    const untrusted = { ...project, trust: "untrusted" as const };
    props = {
      ...props,
      projects: [untrusted],
      creation: {
        ...props.creation,
        pending: {
          ...props.creation.pending!,
          target: { kind: "local", path: untrusted.rootPath },
        },
        pendingClone: { ...props.creation.pendingClone!, status: "succeeded" },
        completedProject: untrusted,
        localCloneDetail: {
          progress: null,
          failure: null,
          source: { host: "github.com", path: "acme/app" },
        },
      },
    };
    await render();
    expect(host.textContent).toContain("Not trusted yet");
    expect(send().disabled).toBe(false);
    await act(async () => send().click());
    expect(props.onTrustProject).toHaveBeenCalledWith(untrusted.rootKey, {
      kind: "clone",
      host: "github.com",
      path: "acme/app",
    });
    expect(props.agents.startThread).not.toHaveBeenCalled();
    await act(async () => {
      [...host.querySelectorAll<HTMLButtonElement>("button")]
        .find((candidate) => candidate.textContent === "Review")
        ?.click();
    });
    expect(props.onTrustProject).toHaveBeenCalledTimes(2);
  });

  it("keeps sending disabled for an untrusted clone with an empty draft", async () => {
    const untrusted = { ...project, trust: "untrusted" as const };
    props = {
      ...props,
      projects: [untrusted],
      creation: {
        ...props.creation,
        draft: "",
        pending: {
          ...props.creation.pending!,
          target: { kind: "local", path: untrusted.rootPath },
        },
        pendingClone: { ...props.creation.pendingClone!, status: "succeeded" },
        completedProject: untrusted,
      },
    };
    await render();
    expect(host.textContent).toContain("Not trusted yet");
    expect(send().disabled).toBe(true);
    expect(props.onTrustProject).not.toHaveBeenCalled();
  });

  it("shows clone progress above the composer while cloning", async () => {
    props = {
      ...props,
      creation: {
        ...props.creation,
        localCloneDetail: {
          progress: { phase: "receiving", percent: 10, receivedBytes: null, bytesPerSecond: null },
          failure: null,
          source: { host: "github.com", path: "acme/app" },
        },
      },
    };
    await render();
    expect(host.textContent).toContain("Cloning acme/app");
    expect(host.textContent).toContain("Receiving objects · 10%");
    expect(host.querySelector("textarea")?.placeholder).toBe(
      "Write your first message. Sending unlocks when the clone finishes.",
    );
    expect(host.querySelector('[aria-label="Clone app"]')).toBeNull();
  });

  it("shows typed failure copy with Retry and Remove project", async () => {
    props = {
      ...props,
      creation: {
        ...props.creation,
        pendingClone: { ...props.creation.pendingClone!, status: "failed" },
        localCloneDetail: {
          progress: null,
          failure: "notFound",
          source: { host: "github.com", path: "acme/app" },
        },
      },
    };
    await render();
    expect(host.textContent).toContain("Could not clone acme/app");
    expect(host.textContent).toContain("Repository not found or access denied on github.com");
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("button")];
    await act(async () => buttons.find((candidate) => candidate.textContent === "Retry")?.click());
    await act(async () =>
      buttons.find((candidate) => candidate.textContent === "Remove project")?.click(),
    );
    expect(props.creation.retry).toHaveBeenCalledOnce();
    expect(props.creation.dismiss).toHaveBeenCalledOnce();
  });
});
