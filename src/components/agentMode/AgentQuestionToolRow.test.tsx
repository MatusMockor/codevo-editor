// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clipHeadTail, headTailOmissionMarker } from "@codevo/agent-events";
import { MAX_AGENT_TOOL_SUMMARY_BYTES } from "../../domain/agentThread";
import { AgentQuestionToolRow } from "./AgentQuestionToolRow";
import type { AgentTurnAttachmentImageViewer } from "./AgentTurnAttachments";
import type { AgentTurnItem } from "./agentModePresentation";

const ID = "0123456789abcdef0123456789abcdef";
const INPUT = JSON.stringify({
  questions: [{ question: "Which layout is broken?", header: "Layout", options: [] }],
});
const ANSWERED =
  'Your questions have been answered: "Which layout is broken?"="Sidebar, It overlaps.\n\n' +
  `[Attached image "screen.png" is saved at: /data/agent-attachments/threads/agt-1/${ID}.png]", ` +
  '"Which theme?"="Dark". You can now continue with these answers in mind.';

function tool(
  patch: Partial<Extract<AgentTurnItem, { kind: "tool" }>> = {},
): Extract<AgentTurnItem, { kind: "tool" }> {
  return {
    kind: "tool",
    key: "tool-1",
    toolId: "toolu_1",
    name: "AskUserQuestion",
    inputSummary: INPUT,
    outcome: { outputSummary: ANSWERED, isError: false },
    rowKind: "other",
    status: "ok",
    label: "AskUserQuestion",
    argument: INPUT,
    command: null,
    output: ANSWERED,
    ...patch,
  };
}

describe("AgentQuestionToolRow", () => {
  let host: HTMLDivElement;
  let root: Root;
  let images: AgentTurnAttachmentImageViewer;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    images = {
      stateOf: () => ({ kind: "ready", url: "blob:thumb" }),
      ensure: vi.fn(),
      reveal: vi.fn(),
      open: vi.fn(),
    };
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(item = tool()) {
    act(() => root.render(<AgentQuestionToolRow attachmentImages={images} item={item} />));
  }

  function toggle() {
    return host.querySelector<HTMLButtonElement>("button.cv-work-row")!;
  }

  it("renders a compact answered work row with the first prompt and the chosen answer", () => {
    render();
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(toggle().textContent).toContain("Answered");
    expect(toggle().textContent).toContain("Which layout is broken?");
    expect(host.querySelector(".agent-question-row__answer")?.textContent).toBe(
      "Sidebar, It overlaps.",
    );
    expect(host.querySelector("details, summary")).toBeNull();
    expect(host.textContent).not.toContain("Answer sent");
    expect(host.textContent).not.toContain("questions");
    expect(host.querySelector("dl")).toBeNull();
  });

  it("expands to every question and answer with thumbnails for attached images", () => {
    render();
    act(() => toggle().click());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    const detail = document.getElementById(toggle().getAttribute("aria-controls")!)!;
    expect([...detail.querySelectorAll("dt")].map((node) => node.textContent)).toEqual([
      "Which layout is broken?",
      "Which theme?",
    ]);
    expect([...detail.querySelectorAll("dd")].map((node) => node.textContent)).toEqual([
      "Sidebar, It overlaps.",
      "Dark",
    ]);
    expect(detail.textContent).not.toContain("saved at");
    expect(images.ensure).toHaveBeenCalledWith(ID, "image/png");
    expect(detail.querySelector("img")?.getAttribute("src")).toBe("blob:thumb");
  });

  it("tells the user when the saved transcript shortened the answer", () => {
    render(
      tool({
        output: `Your questions have been answered: "First?"="One", "Second?"="Tw${headTailOmissionMarker(900)}x". You can now continue with these answers in mind.`,
      }),
    );
    act(() => toggle().click());
    expect(host.textContent).toContain("shortened");
  });

  it("keeps a clipped long answer answered and shows other results neutrally", () => {
    const long = clipHeadTail(
      `Your questions have been answered: "Which layout is broken?"="${"It overlaps. ".repeat(40)}". You can now continue with these answers in mind.`,
      MAX_AGENT_TOOL_SUMMARY_BYTES,
    ).text;
    render(tool({ output: long }));
    expect(toggle().textContent).toContain("Answered");
    expect(toggle().textContent).not.toContain("Not answered");
    render(tool({ output: "The user responded: ship it" }));
    expect(toggle().textContent).toContain("Answer recorded");
    expect(toggle().textContent).not.toContain("Not answered");
  });

  it("shows a pending question and an unanswered one without claiming an answer", () => {
    render(tool({ status: "running", output: null, outcome: null }));
    expect(toggle().textContent).toContain("Question");
    expect(toggle().textContent).not.toContain("Answered");
    render(tool({ output: "The user did not answer the questions." }));
    expect(toggle().textContent).toContain("Not answered");
  });
});
