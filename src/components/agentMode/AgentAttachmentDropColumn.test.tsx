// @vitest-environment jsdom

import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentComposerAttachmentsSurface } from "../../application/useAgentComposerAttachments";
import { installElementFromPoint } from "../../test/elementFromPointTestSupport";
import { AgentAttachmentDropColumn } from "./AgentAttachmentDropColumn";
import { AGENT_ATTACHMENT_DROP_OVERLAY_LABEL } from "./AgentAttachmentDropOverlay";
import { AgentComposer, type AgentComposerProps } from "./AgentComposer";
import type {
  AgentComposerDragDropEvent,
  AgentComposerDragDropListener,
  AgentComposerDragDropSubscribe,
} from "./agentComposerAttachmentPorts";

const ROOT = "/workspace/app";
const OTHER_ROOT = "/workspace/other";
const DROPPED = "/Users/me/Desktop/clip.mp4";
const OVER_TRANSCRIPT = { x: 50, y: 100 };
const OVER_COMPOSER = { x: 50, y: 700 };
const OUTSIDE_COLUMN = { x: 900, y: 100 };

type AddAttachment = AgentComposerAttachmentsSurface["add"];

interface Bounds {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

const COLUMN_BOUNDS: Bounds = { left: 0, top: 0, width: 400, height: 800 };
const COMPOSER_BOUNDS: Bounds = { left: 0, top: 600, width: 400, height: 200 };

describe("AgentAttachmentDropColumn", () => {
  let host: HTMLDivElement;
  let root: Root;
  let listeners: Set<AgentComposerDragDropListener>;
  let subscribe: AgentComposerDragDropSubscribe;
  let restoreElementFromPoint: () => void;
  let covers: HTMLElement[];

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    restoreElementFromPoint = installElementFromPoint();
    covers = [];
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    listeners = new Set();
    subscribe = async (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    };
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    for (const surfaceAbove of covers) surfaceAbove.remove();
    restoreElementFromPoint();
  });

  it("attaches a drop released over the transcript and returns focus to the prompt", async () => {
    const add = vi.fn<AddAttachment>(async () => undefined);
    await render({ attachments: surface({ add }) });

    emit({ kind: "over", ...OVER_TRANSCRIPT, paths: [] });
    expect(overlay()?.textContent).toBe(AGENT_ATTACHMENT_DROP_OVERLAY_LABEL);
    expect(overlay()?.closest(".agent-mode__center")).toBe(column());
    expect(host.querySelector("[data-agent-composer-drop='active']")).toBeNull();
    expect(document.activeElement).not.toBe(textarea());

    await drop(OVER_TRANSCRIPT);

    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(ROOT, [{ kind: "path", path: DROPPED }]);
    expect(overlay()).toBeNull();
    expect(document.activeElement).toBe(textarea());
  });

  it("ignores a hover and a drop outside the column", async () => {
    const add = vi.fn<AddAttachment>(async () => undefined);
    await render({ attachments: surface({ add }) });

    emit({ kind: "over", ...OUTSIDE_COLUMN, paths: [] });
    expect(overlay()).toBeNull();

    await drop(OUTSIDE_COLUMN);

    expect(add).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(textarea());
  });

  it("keeps the prompt unfocused when a drop inside the column carries no paths", async () => {
    const add = vi.fn<AddAttachment>(async () => undefined);
    await render({ attachments: surface({ add }) });

    await act(async () => emitAll({ kind: "drop", ...OVER_TRANSCRIPT, paths: [] }));

    expect(add).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(textarea());
  });

  it("clears the overlay when the drag leaves the window or moves out of the column", async () => {
    await render({ attachments: surface({}) });

    emit({ kind: "over", ...OVER_TRANSCRIPT, paths: [] });
    expect(overlay()).not.toBeNull();
    emit({ kind: "leave", x: -1, y: -1, paths: [] });
    expect(overlay()).toBeNull();

    emit({ kind: "over", ...OVER_TRANSCRIPT, paths: [] });
    expect(overlay()).not.toBeNull();
    emit({ kind: "over", ...OUTSIDE_COLUMN, paths: [] });
    expect(overlay()).toBeNull();
  });

  it("clears the overlay and refuses the drop once the composer starts dispatching", async () => {
    const add = vi.fn<AddAttachment>(async () => undefined);
    const attachments = surface({ add });
    await render({ attachments });
    emit({ kind: "over", ...OVER_TRANSCRIPT, paths: [] });
    expect(overlay()).not.toBeNull();

    await render({ attachments, dispatching: true });

    expect(overlay()).toBeNull();
    expect(listeners.size).toBe(0);
    await drop(OVER_TRANSCRIPT);
    expect(add).not.toHaveBeenCalled();
  });

  it("clears the overlay when attachments become unavailable", async () => {
    await render({ attachments: surface({}) });
    emit({ kind: "over", ...OVER_TRANSCRIPT, paths: [] });
    expect(overlay()).not.toBeNull();

    await render({ attachments: null });

    expect(overlay()).toBeNull();
    expect(listeners.size).toBe(0);
  });

  it("clears the overlay when the composer unmounts mid-drag", async () => {
    await render({ attachments: surface({}) });
    emit({ kind: "over", ...OVER_TRANSCRIPT, paths: [] });
    expect(overlay()).not.toBeNull();

    await act(async () => root.render(<Scene composer={null} inert={false} />));

    expect(overlay()).toBeNull();
    expect(listeners.size).toBe(0);
  });

  it.each([
    ["collapsed to zero width", { left: 0, top: 0, width: 0, height: 800 }],
    ["collapsed to zero height", { left: 0, top: 0, width: 400, height: 0 }],
    ["removed from layout", { left: 0, top: 0, width: 0, height: 0 }],
  ])("stays inactive while the column is %s", async (_label, bounds) => {
    const add = vi.fn<AddAttachment>(async () => undefined);
    await render({ attachments: surface({ add }) }, { column: bounds });

    emit({ kind: "over", x: 0, y: 0, paths: [] });
    expect(overlay()).toBeNull();
    await drop({ x: 0, y: 0 });

    expect(add).not.toHaveBeenCalled();
  });

  it("stays inactive while the column is inert behind a maximized panel", async () => {
    const add = vi.fn<AddAttachment>(async () => undefined);
    await render({ attachments: surface({ add }) }, { inert: true });

    emit({ kind: "over", ...OVER_TRANSCRIPT, paths: [] });
    expect(overlay()).toBeNull();
    await drop(OVER_TRANSCRIPT);

    expect(add).not.toHaveBeenCalled();
  });

  it("stays inactive while the agent view around the column is hidden", async () => {
    const add = vi.fn<AddAttachment>(async () => undefined);
    await render({ attachments: surface({ add }) });
    host.hidden = true;

    emit({ kind: "over", ...OVER_TRANSCRIPT, paths: [] });
    expect(overlay()).toBeNull();
    await drop(OVER_TRANSCRIPT);

    expect(add).not.toHaveBeenCalled();
  });

  it("keeps the overlay out of an inert column while a drag still hovers it", async () => {
    const attachments = surface({});
    await render({ attachments });
    emit({ kind: "over", ...OVER_TRANSCRIPT, paths: [] });
    expect(overlay()).not.toBeNull();

    await render({ attachments }, { inert: true });

    expect(overlay()).toBeNull();
  });

  it("waits for a new hover before showing the overlay in a restored column", async () => {
    const attachments = surface({});
    await render({ attachments });
    emit({ kind: "over", ...OVER_TRANSCRIPT, paths: [] });
    await render({ attachments }, { inert: true });

    await render({ attachments });

    expect(overlay()).toBeNull();
    emit({ kind: "over", ...OVER_TRANSCRIPT, paths: [] });
    expect(overlay()).not.toBeNull();
  });

  it("ignores a hover and a drop over a surface that covers the column", async () => {
    const add = vi.fn<AddAttachment>(async () => undefined);
    await render({ attachments: surface({ add }) });
    const dialog = cover(COLUMN_BOUNDS);

    emit({ kind: "over", ...OVER_TRANSCRIPT, paths: [] });
    expect(overlay()).toBeNull();
    await drop(OVER_TRANSCRIPT);
    await drop(OVER_COMPOSER);

    expect(add).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(textarea());

    dialog.remove();
    emit({ kind: "over", ...OVER_TRANSCRIPT, paths: [] });
    expect(overlay()).not.toBeNull();
    await drop(OVER_TRANSCRIPT);

    expect(add).toHaveBeenCalledTimes(1);
  });

  it("accepts a drop beside a surface that covers only part of the column", async () => {
    const add = vi.fn<AddAttachment>(async () => undefined);
    await render({ attachments: surface({ add }) });
    cover({ left: 0, top: 0, width: 400, height: 300 });

    await drop(OVER_TRANSCRIPT);
    expect(add).not.toHaveBeenCalled();

    await drop(OVER_COMPOSER);

    expect(add).toHaveBeenCalledTimes(1);
  });

  it("delivers a drop to the draft that is current when it lands", async () => {
    const addFirst = vi.fn<AddAttachment>(async () => undefined);
    const addSecond = vi.fn<AddAttachment>(async () => undefined);
    await render({
      attachments: surface({ add: addFirst }),
      attachmentTargetKey: ROOT,
      promptOwnerKey: "thread-a",
    });
    emit({ kind: "over", ...OVER_TRANSCRIPT, paths: [] });

    await render({
      attachments: surface({ add: addSecond, projectRootKey: OTHER_ROOT }),
      attachmentTargetKey: OTHER_ROOT,
      promptOwnerKey: "thread-b",
    });
    await drop(OVER_TRANSCRIPT);

    expect(addFirst).not.toHaveBeenCalled();
    expect(addSecond).toHaveBeenCalledTimes(1);
    expect(addSecond).toHaveBeenCalledWith(OTHER_ROOT, [{ kind: "path", path: DROPPED }]);
  });

  it("follows the column to its current bounds instead of the bounds seen on hover", async () => {
    const add = vi.fn<AddAttachment>(async () => undefined);
    await render({ attachments: surface({ add }) });
    emit({ kind: "over", ...OVER_TRANSCRIPT, paths: [] });
    expect(overlay()).not.toBeNull();

    stubBounds(column(), { left: 500, top: 0, width: 400, height: 800 });
    await drop(OVER_TRANSCRIPT);

    expect(add).not.toHaveBeenCalled();
    expect(overlay()).toBeNull();
  });

  function Scene({
    composer,
    inert,
  }: {
    readonly composer: AgentComposerProps | null;
    readonly inert: boolean;
  }) {
    const columnRef = useRef<HTMLDivElement | null>(null);
    return (
      <AgentAttachmentDropColumn columnRef={columnRef} inert={inert}>
        <div className="agent-session__scroll" />
        {composer !== null && <AgentComposer {...composer} />}
      </AgentAttachmentDropColumn>
    );
  }

  async function render(
    overrides: Partial<AgentComposerProps>,
    layout: { readonly column?: Bounds; readonly inert?: boolean } = {},
  ): Promise<void> {
    await act(async () =>
      root.render(
        <Scene
          composer={{ ...defaultProps(), attachmentDragDrop: subscribe, ...overrides }}
          inert={layout.inert ?? false}
        />,
      ),
    );
    stubBounds(column(), layout.column ?? COLUMN_BOUNDS);
    stubBounds(form(), COMPOSER_BOUNDS);
  }

  function emitAll(event: AgentComposerDragDropEvent): void {
    for (const listener of [...listeners]) listener(event);
  }

  function emit(event: AgentComposerDragDropEvent): void {
    act(() => emitAll(event));
  }

  async function drop(position: { readonly x: number; readonly y: number }): Promise<void> {
    await act(async () => emitAll({ kind: "drop", ...position, paths: [DROPPED] }));
  }

  function cover(bounds: Bounds): HTMLElement {
    const surfaceAbove = document.createElement("div");
    surfaceAbove.setAttribute("role", "dialog");
    document.body.append(surfaceAbove);
    covers.push(surfaceAbove);
    stubBounds(surfaceAbove, bounds);
    return surfaceAbove;
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

  function textarea(): HTMLTextAreaElement {
    const element = host.querySelector<HTMLTextAreaElement>("textarea#agent-prompt");
    expect(element).not.toBeNull();
    return element ?? document.createElement("textarea");
  }
});

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

function defaultProps(): AgentComposerProps {
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
    launch: { provider: "claudeCode", model: "default", mode: "default", effort: "default" },
    launchProvider: "claudeCode",
    dispatching: false,
    submitBlocked: false,
    providerEnabled: { claudeCode: true, codex: true },
    mode: { kind: "new" },
    onSelectRepository: () => undefined,
    onPromptChange: () => undefined,
    onIsolationChange: () => undefined,
    onLaunchChange: () => undefined,
    onNewThread: () => undefined,
    onOpenProviderSettings: () => undefined,
    onSubmit: () => undefined,
  };
}
