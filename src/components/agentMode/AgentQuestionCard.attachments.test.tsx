// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAttachmentGateway } from "../../application/agentAttachmentPorts";
import {
  createAgentQuestionAttachmentsPort,
  type AgentQuestionAttachments,
} from "../../application/agentQuestionAttachments";
import {
  useAgentComposerAttachments,
  type AgentAttachmentOwner,
} from "../../application/useAgentComposerAttachments";
import {
  AGENT_ATTACHMENT_COUNT_REFUSAL,
  AGENT_ATTACHMENT_IMAGE_SOURCE_BYTES_REFUSAL,
  MAX_AGENT_IMAGE_SOURCE_BYTES,
} from "../../domain/agentAttachmentIntake";
import type { AgentImageSurfacePort } from "../../domain/agentImageShrink";
import type { AgentQuestionRequest, AgentQuestionResponse } from "../../domain/agentQuestion";
import { AGENT_QUESTION_ATTACHMENTS_TOO_LONG, AgentQuestionCard } from "./AgentQuestionCard";
import { AGENT_QUESTION_ATTACHMENTS_UNAVAILABLE } from "./composer/agentComposerInteraction";

const ROOT = "/workspace/app";
const THREAD_ID = "agt-thread-1";
const STORE = `/data/agent-attachments/threads/${THREAD_ID}`;
const OWNER: AgentAttachmentOwner = {
  projectRootKey: ROOT,
  ownerId: "owner-a",
  generation: 1,
  workspaceId: "ws-a",
};

const request: AgentQuestionRequest = {
  id: "request-1",
  taskId: "task-1",
  provider: "claudeCode",
  status: "pending",
  questions: [
    {
      id: "question-0",
      header: "Layout",
      prompt: "Which layout is broken?",
      multiple: false,
      allowCustom: true,
      options: [{ id: "option-0", label: "Sidebar", description: "" }],
    },
  ],
};

const imageSurface: AgentImageSurfacePort = {
  decode: async () => ({ width: 64, height: 32 }),
  encodeMime: async () => "image/webp",
  encode: async () => new ArrayBuffer(8),
  release: () => undefined,
};

function attachmentId(index: number): string {
  return index.toString(16).padStart(32, "0");
}

function fakeGateway() {
  let staged = 0;
  const gateway = {
    stageAgentAttachmentBytes: vi.fn(async ({ name, mime, width, height, bytes }) => ({
      attachmentId: attachmentId((staged += 1)),
      name,
      mime,
      bytes: bytes.byteLength,
      width: width ?? 64,
      height: height ?? 32,
      promptLineBytesMax: 160,
    })),
    inspectAgentAttachmentCandidate: vi.fn(),
    readAgentAttachmentCandidate: vi.fn(),
    claimAgentAttachments: vi.fn(async ({ attachmentIds }: { attachmentIds: readonly string[] }) =>
      attachmentIds.map((id) => ({
        attachmentId: id,
        storedPath: `${STORE}/${id}.png`,
        promptLine: "",
      })),
    ),
    releaseAgentAttachment: vi.fn(async () => undefined),
    readAgentAttachment: vi.fn(),
    revealAgentAttachment: vi.fn(),
  } satisfies AgentAttachmentGateway;
  return gateway;
}

function image(name: string, bytes = 16): File {
  return new File([new Uint8Array(bytes)], name, { type: "image/png" });
}

function pasteEvent(files: ReadonlyArray<File>, text = ""): Event {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { files, items: [], getData: () => text },
  });
  return event;
}

describe("AgentQuestionCard attachments", () => {
  let host: HTMLDivElement;
  let root: Root;
  let gateway: ReturnType<typeof fakeGateway>;
  let onAnswer: ReturnType<typeof vi.fn<(response: AgentQuestionResponse) => Promise<void>>>;
  let previews: number;
  let harnessRenders: number;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    gateway = fakeGateway();
    onAnswer = vi.fn(async () => undefined);
    previews = 0;
    harnessRenders = 0;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function Harness({
    owned = true,
    value = request,
  }: {
    readonly owned?: boolean;
    readonly value?: AgentQuestionRequest;
  }) {
    harnessRenders += 1;
    const attachments = useAgentComposerAttachments({
      gateway,
      imageSurface,
      resolveOwner: (key) => (key === ROOT ? OWNER : null),
      reportError: () => undefined,
      createObjectUrl: () => `blob:preview-${(previews += 1)}`,
      revokeObjectUrl: () => undefined,
    });
    const port = createAgentQuestionAttachmentsPort({
      gateway,
      forDraft: attachments.forDraft,
      resolveThreadRootKey: (threadId) => (owned && threadId === THREAD_ID ? ROOT : null),
    });
    return (
      <AgentQuestionCard
        request={value}
        pending={false}
        error={null}
        onAnswer={onAnswer}
        attachments={port.forThread(THREAD_ID)}
        attachmentDragDrop={async () => () => undefined}
      />
    );
  }

  function render(element = <Harness />) {
    act(() => root.render(element));
  }

  async function settle() {
    for (let round = 0; round < 6; round += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }

  async function paste(event: Event) {
    await act(async () => {
      host.querySelector("textarea")!.dispatchEvent(event);
    });
    await settle();
  }

  function thumbnails() {
    return [...host.querySelectorAll<HTMLImageElement>(".agent-composer-attachment__preview")];
  }

  function button(label: string) {
    return [...host.querySelectorAll("button")].find(
      (candidate) =>
        candidate.textContent === label || candidate.getAttribute("aria-label") === label,
    )!;
  }

  function type(text: string) {
    const field = host.querySelector("textarea")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        field,
        text,
      );
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function submit() {
    await act(async () => button("Send answer").click());
    await settle();
  }

  it("shows a thumbnail with a remove button after pasting an image into the free-text field", async () => {
    render();
    const event = pasteEvent([image("screen.png")]);
    await paste(event);
    expect(event.defaultPrevented).toBe(true);
    expect(thumbnails().map((thumb) => thumb.alt)).toEqual(["screen.png"]);
    expect(button("Remove screen.png")).toBeDefined();
    expect(gateway.stageAgentAttachmentBytes).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-a", kind: "image", name: "screen.png" }),
    );
  });

  it("claims the image into the thread store and sends its saved path in the answer text", async () => {
    render();
    type("The sidebar overlaps the editor.");
    await paste(pasteEvent([image("screen.png")]));
    await submit();
    expect(gateway.claimAgentAttachments).toHaveBeenCalledExactlyOnceWith({
      workspaceId: "ws-a",
      threadId: THREAD_ID,
      attachmentIds: [attachmentId(1)],
    });
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({
      answers: [
        {
          questionId: "question-0",
          optionIds: [],
          text: `The sidebar overlaps the editor.\n\n[Attached image "screen.png" is saved at: ${STORE}/${attachmentId(1)}.png]`,
        },
      ],
    });
    expect(gateway.releaseAgentAttachment).not.toHaveBeenCalled();
  });

  it("starts the saved path on its own line when an option is chosen without text", async () => {
    render();
    await act(async () => host.querySelector<HTMLInputElement>('input[type="radio"]')!.click());
    await paste(pasteEvent([image("screen.png")]));
    await submit();
    expect(onAnswer.mock.calls[0]?.[0].answers[0]).toEqual({
      questionId: "question-0",
      optionIds: ["option-0"],
      text: `\n\n[Attached image "screen.png" is saved at: ${STORE}/${attachmentId(1)}.png]`,
    });
  });

  it("accepts an image-only answer as a complete custom answer", async () => {
    render();
    expect(button("Send answer").disabled).toBe(true);
    await paste(pasteEvent([image("only.png")]));
    expect(button("Send answer").disabled).toBe(false);
    await submit();
    expect(onAnswer.mock.calls[0]?.[0].answers[0]?.text).toBe(
      `[Attached image "only.png" is saved at: ${STORE}/${attachmentId(1)}.png]`,
    );
  });

  it("removes a pasted image, releases its staged copy and leaves it out of the answer", async () => {
    render();
    await paste(pasteEvent([image("keep.png")]));
    await paste(pasteEvent([image("drop.png")]));
    expect(thumbnails()).toHaveLength(2);
    await act(async () => button("Remove drop.png").click());
    await settle();
    expect(thumbnails().map((thumb) => thumb.alt)).toEqual(["keep.png"]);
    expect(gateway.releaseAgentAttachment).toHaveBeenCalledWith({
      workspaceId: "ws-a",
      attachmentId: attachmentId(2),
    });
    await submit();
    const text = onAnswer.mock.calls[0]?.[0].answers[0]?.text ?? "";
    expect(text).toContain("keep.png");
    expect(text).not.toContain("drop.png");
  });

  it("enforces the composer attachment count limit with a truthful refusal", async () => {
    render();
    for (let index = 0; index < 9; index += 1) {
      await paste(pasteEvent([image(`shot-${index}.png`)]));
    }
    expect(thumbnails()).toHaveLength(8);
    expect(host.textContent).toContain(AGENT_ATTACHMENT_COUNT_REFUSAL);
  });

  it("refuses an oversized image before reading it", async () => {
    render();
    const huge = image("huge.png");
    Object.defineProperty(huge, "size", { value: MAX_AGENT_IMAGE_SOURCE_BYTES + 1 });
    await paste(pasteEvent([huge]));
    expect(thumbnails()).toHaveLength(0);
    expect(host.textContent).toContain(AGENT_ATTACHMENT_IMAGE_SOURCE_BYTES_REFUSAL);
    expect(gateway.stageAgentAttachmentBytes).not.toHaveBeenCalled();
  });

  it("keeps the answer within the protocol text bound once attachment paths are reserved", async () => {
    render();
    type("x".repeat(8_100));
    expect(button("Send answer").disabled).toBe(false);
    await paste(pasteEvent([image("screen.png")]));
    expect(button("Send answer").disabled).toBe(true);
    expect(host.textContent).toContain(AGENT_QUESTION_ATTACHMENTS_TOO_LONG);
    expect(host.querySelector("textarea")?.getAttribute("aria-invalid")).toBe("true");
  });

  it("leaves a plain-text paste to the text field", async () => {
    render();
    const event = pasteEvent([], "Just some text");
    await paste(event);
    expect(event.defaultPrevented).toBe(false);
    expect(thumbnails()).toHaveLength(0);
    expect(gateway.stageAgentAttachmentBytes).not.toHaveBeenCalled();
  });

  it("does not claim the same attachment twice when a failed answer is retried", async () => {
    onAnswer.mockRejectedValueOnce(new Error("transport"));
    render();
    await paste(pasteEvent([image("screen.png")]));
    await submit();
    expect(host.textContent).toContain("Could not send your answer");
    expect(thumbnails()).toHaveLength(1);
    await submit();
    expect(gateway.claimAgentAttachments).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledTimes(2);
    expect(onAnswer.mock.calls[1]?.[0]).toEqual(onAnswer.mock.calls[0]?.[0]);
  });

  it("refuses a pasted image truthfully when the thread cannot own attachments", async () => {
    render(<Harness owned={false} />);
    expect(host.querySelector('button[aria-label="Attach files"]')).toBeNull();
    const event = pasteEvent([image("screen.png")]);
    await paste(event);
    expect(event.defaultPrevented).toBe(true);
    expect(host.textContent).toContain(AGENT_QUESTION_ATTACHMENTS_UNAVAILABLE);
    expect(gateway.stageAgentAttachmentBytes).not.toHaveBeenCalled();
  });

  it("clears the unavailable notice once attachments become available again", async () => {
    render(<Harness owned={false} />);
    await paste(pasteEvent([image("screen.png")]));
    expect(host.textContent).toContain(AGENT_QUESTION_ATTACHMENTS_UNAVAILABLE);
    render();
    expect(host.textContent).not.toContain(AGENT_QUESTION_ATTACHMENTS_UNAVAILABLE);
  });

  it("explains why Send is disabled while an attachment is still saving", async () => {
    gateway.stageAgentAttachmentBytes.mockImplementationOnce(() => new Promise(() => undefined));
    render();
    type("Looks wrong");
    await paste(pasteEvent([image("screen.png")]));
    expect(button("Send answer").disabled).toBe(true);
    expect(host.textContent).toContain("still saving");
  });

  it("does not send an answer when the card went away during the claim", async () => {
    let finish!: () => void;
    gateway.claimAgentAttachments.mockImplementationOnce(
      ({ attachmentIds }: { attachmentIds: readonly string[] }) =>
        new Promise((resolve) => {
          finish = () =>
            resolve(
              attachmentIds.map((id) => ({
                attachmentId: id,
                storedPath: `${STORE}/${id}.png`,
                promptLine: "",
              })),
            );
        }),
    );
    render();
    await paste(pasteEvent([image("screen.png")]));
    await act(async () => button("Send answer").click());
    render(<Harness value={{ ...request, status: "expired" }} />);
    await act(async () => finish());
    await settle();
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("drops a claimed but unsent image without a bogus release", async () => {
    onAnswer.mockRejectedValueOnce(new Error("transport"));
    render();
    type("See screenshot");
    await paste(pasteEvent([image("screen.png")]));
    await submit();
    await act(async () => button("Remove screen.png").click());
    await settle();
    expect(thumbnails()).toHaveLength(0);
    expect(gateway.releaseAgentAttachment).not.toHaveBeenCalled();
    await submit();
    expect(onAnswer.mock.calls[1]?.[0].answers[0]?.text).toBe("See screenshot");
  });

  it("releases staged images through the last capability after the thread lost it", async () => {
    render();
    await paste(pasteEvent([image("screen.png")]));
    render(<Harness owned={false} />);
    render(<Harness owned={false} value={{ ...request, status: "expired" }} />);
    await settle();
    expect(gateway.releaseAgentAttachment).toHaveBeenCalledWith({
      workspaceId: "ws-a",
      attachmentId: attachmentId(1),
    });
  });

  it("does not republish the attachment store when an empty question card goes away", async () => {
    render();
    await settle();
    const before = harnessRenders;
    render(<Harness value={{ ...request, status: "cancelled" }} />);
    await settle();
    expect(harnessRenders - before).toBe(1);
  });

  it("releases unsent staged images when the question is no longer pending", async () => {
    render();
    await paste(pasteEvent([image("screen.png")]));
    render(<Harness value={{ ...request, status: "cancelled" }} />);
    await settle();
    expect(gateway.releaseAgentAttachment).toHaveBeenCalledWith({
      workspaceId: "ws-a",
      attachmentId: attachmentId(1),
    });
  });
});

describe("createAgentQuestionAttachmentsPort", () => {
  it("rejects a prepared draft from another project before claiming", async () => {
    const gateway = fakeGateway();
    let capability: AgentQuestionAttachments | null = null;
    function Probe() {
      const attachments = useAgentComposerAttachments({
        gateway,
        imageSurface,
        resolveOwner: () => OWNER,
        reportError: () => undefined,
      });
      capability = createAgentQuestionAttachmentsPort({
        gateway,
        forDraft: attachments.forDraft,
        resolveThreadRootKey: () => ROOT,
      }).forThread(THREAD_ID);
      return null;
    }
    const container = document.createElement("div");
    const probeRoot = createRoot(container);
    act(() => probeRoot.render(<Probe />));
    await expect(
      capability!.claim({
        owner: { ...OWNER, projectRootKey: "/workspace/other" },
        draftIds: ["draft"],
        intents: [
          {
            kind: "staged",
            attachmentId: attachmentId(1),
            name: "a.png",
            bytes: 1,
            mime: "image/png",
            width: 1,
            height: 1,
          },
        ],
      }),
    ).rejects.toThrow();
    expect(gateway.claimAgentAttachments).not.toHaveBeenCalled();
    act(() => probeRoot.unmount());
  });
});
