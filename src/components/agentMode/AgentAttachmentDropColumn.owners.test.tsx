// @vitest-environment jsdom

import { act, useRef, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentQuestionAttachmentsPort } from "../../application/agentQuestionAttachments";
import { createCloneComposerAttachments } from "../../application/cloneComposerAttachments";
import type { AgentComposerAttachmentsSurface } from "../../application/useAgentComposerAttachments";
import type { AgentQuestionRequest } from "../../domain/agentQuestion";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import { installElementFromPoint } from "../../test/elementFromPointTestSupport";
import { AgentAttachmentDropColumn } from "./AgentAttachmentDropColumn";
import { AgentCloneComposer } from "./AgentCloneComposer";
import { AgentComposer, type AgentComposerProps } from "./AgentComposer";
import type {
  AgentComposerDragDropListener,
  AgentComposerDragDropSubscribe,
} from "./agentComposerAttachmentPorts";
import { presentAgentApproval } from "./agentApprovalPresenter";
import { projectFixture, threadsSurfaceFixture } from "./agentThreadsSurfaceTestFixtures";
import type { AgentComposerInteraction } from "./composer/agentComposerInteraction";
import { AgentQuestionAttachmentsContext } from "./composer/agentQuestionAttachmentsContext";

interface WebviewDragDropPayload {
  readonly type: "over" | "drop" | "leave";
  readonly position?: { readonly x: number; readonly y: number };
  readonly paths?: ReadonlyArray<string>;
}

type WebviewDragDropListener = (event: { readonly payload: WebviewDragDropPayload }) => void;

const webview = vi.hoisted(() => ({ listeners: new Set<WebviewDragDropListener>() }));

vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => true,
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (listener: WebviewDragDropListener) => {
      webview.listeners.add(listener);
      return () => {
        webview.listeners.delete(listener);
      };
    },
  }),
}));

const ROOT = "/workspace/app";
const THREAD_ID = "agt-thread-1";
const DROPPED = "/Users/me/Desktop/clip.mp4";
const OVER_TRANSCRIPT = { x: 50, y: 100 };
const OVER_COMPOSER = { x: 50, y: 700 };
const SUBSCRIPTION_SETTLE_ROUNDS = 6;

type AddAttachment = AgentComposerAttachmentsSurface["add"];
type CloneProps = ComponentProps<typeof AgentCloneComposer>;

interface Bounds {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

const COLUMN_BOUNDS: Bounds = { left: 0, top: 0, width: 400, height: 800 };
const COMPOSER_BOUNDS: Bounds = { left: 0, top: 600, width: 400, height: 200 };

const CUSTOM_QUESTION: AgentQuestionRequest = {
  id: "q1",
  taskId: "task",
  provider: "codex",
  status: "pending",
  questions: [
    {
      id: "layout",
      header: "Layout",
      prompt: "Which layout is broken?",
      multiple: false,
      allowCustom: true,
      options: [{ id: "sidebar", label: "Sidebar", description: "" }],
    },
  ],
};

const CLOSED_QUESTION: AgentQuestionRequest = {
  ...CUSTOM_QUESTION,
  questions: [{ ...CUSTOM_QUESTION.questions[0], allowCustom: false }],
};

describe("attachment drop ownership", () => {
  let host: HTMLDivElement;
  let root: Root;
  let composerListeners: Set<AgentComposerDragDropListener>;
  let composerDragDrop: AgentComposerDragDropSubscribe;
  let restoreElementFromPoint: () => void;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    restoreElementFromPoint = installElementFromPoint();
    webview.listeners.clear();
    composerListeners = new Set();
    composerDragDrop = async (listener) => {
      composerListeners.add(listener);
      return () => {
        composerListeners.delete(listener);
      };
    };
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    restoreElementFromPoint();
  });

  it("hands the whole column to the question panel while a question waits for an answer", async () => {
    const composerAdd = vi.fn<AddAttachment>(async () => undefined);
    const questionAdd = vi.fn<AddAttachment>(async () => undefined);
    await renderThread({
      attachments: surface({ add: composerAdd }),
      interaction: question(CUSTOM_QUESTION),
      questionAdd,
    });

    expect(subscribers()).toEqual({ composer: 0, questionPanel: 1 });
    await deliver({ type: "over", position: OVER_TRANSCRIPT });
    expect(overlay()).not.toBeNull();

    await deliver({ type: "drop", position: OVER_TRANSCRIPT, paths: [DROPPED] });

    expect(questionAdd).toHaveBeenCalledTimes(1);
    expect(questionAdd).toHaveBeenCalledWith(ROOT, [{ kind: "path", path: DROPPED }]);
    expect(composerAdd).not.toHaveBeenCalled();
    expect(overlay()).toBeNull();
    expect(document.activeElement).not.toBe(promptTextarea());
  });

  it("returns the column to the composer once the question is settled", async () => {
    const composerAdd = vi.fn<AddAttachment>(async () => undefined);
    const questionAdd = vi.fn<AddAttachment>(async () => undefined);
    const attachments = surface({ add: composerAdd });
    await renderThread({ attachments, interaction: question(CUSTOM_QUESTION), questionAdd });

    await renderThread({ attachments, interaction: null, questionAdd });

    expect(subscribers()).toEqual({ composer: 1, questionPanel: 0 });
    await deliver({ type: "drop", position: OVER_TRANSCRIPT, paths: [DROPPED] });

    expect(composerAdd).toHaveBeenCalledTimes(1);
    expect(composerAdd).toHaveBeenCalledWith(ROOT, [{ kind: "path", path: DROPPED }]);
    expect(questionAdd).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(promptTextarea());
  });

  it.each([
    [
      "a question without a free-text answer",
      (): AgentComposerInteraction => question(CLOSED_QUESTION),
    ],
    ["an approval", (): AgentComposerInteraction => approval()],
  ])("leaves the column without an owner while %s hides the prompt", async (_label, build) => {
    const composerAdd = vi.fn<AddAttachment>(async () => undefined);
    const questionAdd = vi.fn<AddAttachment>(async () => undefined);
    await renderThread({
      attachments: surface({ add: composerAdd }),
      interaction: build(),
      questionAdd,
    });

    expect(subscribers()).toEqual({ composer: 0, questionPanel: 0 });
    await deliver({ type: "over", position: OVER_TRANSCRIPT });
    expect(overlay()).toBeNull();
    await deliver({ type: "drop", position: OVER_COMPOSER, paths: [DROPPED] });

    expect(composerAdd).not.toHaveBeenCalled();
    expect(questionAdd).not.toHaveBeenCalled();
  });

  it("keeps a clone composer outside a thread column on its own bounds", async () => {
    await act(async () => root.render(<AgentCloneComposer {...cloneProps()} />));
    await settleSubscriptions();
    stubBounds(form(), COMPOSER_BOUNDS);

    await deliver({ type: "over", position: OVER_TRANSCRIPT });
    expect(host.querySelector("[data-agent-composer-drop='active']")).toBeNull();
    await deliver({ type: "drop", position: OVER_TRANSCRIPT, paths: [DROPPED] });
    expect(host.textContent).not.toContain("clip.mp4");

    await deliver({ type: "over", position: OVER_COMPOSER });
    expect(host.querySelector("[data-agent-composer-drop='active']")).not.toBeNull();
    expect(overlay()).toBeNull();
    await deliver({ type: "drop", position: OVER_COMPOSER, paths: [DROPPED] });

    expect(host.querySelector("[data-agent-composer-drop='active']")).toBeNull();
    expect(host.textContent).toContain("clip.mp4");
    expect(document.activeElement).toBe(promptTextarea());
  });

  it("lets a clone composer inside the thread column accept a drop anywhere in it", async () => {
    await act(async () =>
      root.render(
        <Column>
          <AgentCloneComposer {...cloneProps()} />
        </Column>,
      ),
    );
    await settleSubscriptions();
    stubBounds(column(), COLUMN_BOUNDS);
    stubBounds(form(), COMPOSER_BOUNDS);

    await deliver({ type: "over", position: OVER_TRANSCRIPT });
    expect(overlay()).not.toBeNull();
    await deliver({ type: "drop", position: OVER_TRANSCRIPT, paths: [DROPPED] });

    expect(overlay()).toBeNull();
    expect(host.textContent).toContain("clip.mp4");
  });

  function Column({ children }: { readonly children: ReactNode }) {
    const columnRef = useRef<HTMLDivElement | null>(null);
    return (
      <AgentAttachmentDropColumn columnRef={columnRef} inert={false}>
        <div className="agent-session__scroll" />
        {children}
      </AgentAttachmentDropColumn>
    );
  }

  async function renderThread(options: {
    readonly attachments: AgentComposerAttachmentsSurface;
    readonly interaction: AgentComposerInteraction | null;
    readonly questionAdd: AddAttachment;
  }): Promise<void> {
    const questionSurface = surface({ add: options.questionAdd });
    const port: AgentQuestionAttachmentsPort = {
      forThread: (threadId) =>
        threadId === THREAD_ID
          ? { targetKey: ROOT, draft: () => questionSurface, claim: async () => [] }
          : null,
    };
    await act(async () =>
      root.render(
        <Column>
          <AgentQuestionAttachmentsContext.Provider value={port}>
            <AgentComposer
              {...composerProps()}
              attachmentDragDrop={composerDragDrop}
              attachments={options.attachments}
              interaction={options.interaction}
            />
          </AgentQuestionAttachmentsContext.Provider>
        </Column>,
      ),
    );
    await settleSubscriptions();
    stubBounds(column(), COLUMN_BOUNDS);
    stubBounds(form(), COMPOSER_BOUNDS);
  }

  async function settleSubscriptions(): Promise<void> {
    for (let round = 0; round < SUBSCRIPTION_SETTLE_ROUNDS; round += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }

  function subscribers(): { readonly composer: number; readonly questionPanel: number } {
    return { composer: composerListeners.size, questionPanel: webview.listeners.size };
  }

  async function deliver(payload: WebviewDragDropPayload): Promise<void> {
    const position = payload.position ?? { x: -1, y: -1 };
    await act(async () => {
      for (const listener of [...webview.listeners]) listener({ payload });
      for (const listener of [...composerListeners]) {
        listener({ kind: payload.type, ...position, paths: payload.paths ?? [] });
      }
    });
  }

  function overlay(): HTMLElement | null {
    return host.querySelector<HTMLElement>(".agent-attachment-drop-overlay [role='status']");
  }

  function column(): HTMLElement {
    const element = host.querySelector<HTMLElement>(".agent-mode__center");
    expect(element).not.toBeNull();
    return element ?? document.createElement("div");
  }

  function form(): HTMLElement {
    const element = host.querySelector<HTMLElement>("form.agent-composer");
    expect(element).not.toBeNull();
    return element ?? document.createElement("form");
  }

  function promptTextarea(): HTMLTextAreaElement {
    const element = host.querySelector<HTMLTextAreaElement>("textarea#agent-prompt");
    expect(element).not.toBeNull();
    return element ?? document.createElement("textarea");
  }
});

function question(request: AgentQuestionRequest): AgentComposerInteraction {
  return {
    kind: "question",
    key: "question:task:q1",
    request,
    attachments: { kind: "thread", threadId: THREAD_ID },
    sending: false,
    error: null,
    answer: () => Promise.resolve(),
  };
}

function approval(): AgentComposerInteraction {
  return {
    kind: "approval",
    key: "approval:task:a1",
    pendingCount: 1,
    sending: false,
    error: null,
    decide: () => Promise.resolve(),
    view: presentAgentApproval({
      id: "a1",
      taskId: "task",
      provider: "codex",
      kind: "command",
      title: "outside the sandbox",
      detail: "npm test",
      detailTruncated: false,
      facts: [],
      decisions: ["allowOnce", "deny"],
      status: "pending",
    }),
  };
}

function stubBounds(element: HTMLElement, bounds: Bounds): void {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      left: bounds.left,
      top: bounds.top,
      right: bounds.left + bounds.width,
      bottom: bounds.top + bounds.height,
      width: bounds.width,
      height: bounds.height,
      x: bounds.left,
      y: bounds.top,
      toJSON: () => ({}),
    }),
  });
}

function surface(
  overrides: Partial<AgentComposerAttachmentsSurface>,
): AgentComposerAttachmentsSurface {
  return {
    drafts: [],
    projectRootKey: ROOT,
    staging: false,
    blocked: false,
    refusal: null,
    promptLineBytes: 0,
    add: async () => undefined,
    captureIntake:
      (target, isCurrent = () => true) =>
      async (sources) => {
        if (isCurrent()) await overrides.add?.(target, sources);
      },
    claimPaste: () => "pass-through",
    remove: () => undefined,
    clear: () => undefined,
    markSent: () => undefined,
    refuse: () => undefined,
    dismissRefusal: () => undefined,
    prepareTurn: async () => null,
    ...overrides,
  };
}

function composerProps(): AgentComposerProps {
  return {
    attachmentTargetKey: ROOT,
    attachmentPicker: async () => [],
    target: {
      projectLabel: "app",
      projectRoot: ROOT,
      repositoryOptions: [],
      selectedRepositoryRoot: ROOT,
    },
    prompt: "Ship it",
    promptBytes: 7,
    isolation: "in-place",
    isolationReason: null,
    worktreeAvailable: true,
    worktreeOnly: false,
    worktreeOnlyReason: null,
    guard: { kind: "safe" },
    launch: { provider: "codex", model: "default", mode: "workspaceWrite" },
    launchProvider: "codex",
    dispatching: false,
    running: true,
    submitBlocked: false,
    providerEnabled: { claudeCode: true, codex: true },
    mode: { kind: "steer", threadId: THREAD_ID },
    onSelectRepository: () => undefined,
    onPromptChange: () => undefined,
    onIsolationChange: () => undefined,
    onLaunchChange: () => undefined,
    onNewThread: () => undefined,
    onOpenProviderSettings: () => undefined,
    onSubmit: () => undefined,
  };
}

function cloneProps(): CloneProps {
  return {
    agents: threadsSurfaceFixture({}),
    projects: [projectFixture()],
    providerEnabled: { claudeCode: true, codex: true },
    providerManagement: unconfiguredAgentProviderManagement(),
    modelFavoritesPersistence: null,
    onThreadStarted: () => undefined,
    onOpenProviderSettings: () => undefined,
    onTrustProject: () => undefined,
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
      changeDraft: () => undefined,
      changeLaunch: () => undefined,
      changeIsolation: () => undefined,
      dismiss: () => undefined,
      hidePending: () => undefined,
      activateCompleted: () => undefined,
      cancel: () => undefined,
      retry: () => undefined,
      canRetry: true,
      error: null,
      localCloneDetail: null,
    },
  };
}
