// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentQuestionRequest, AgentQuestionResponse } from "../../domain/agentQuestion";
import { AgentQuestionCard } from "./AgentQuestionCard";

const request: AgentQuestionRequest = {
  id: "private-request",
  taskId: "private-task",
  provider: "codex",
  status: "pending",
  questions: [
    {
      id: "private-question",
      header: "Database",
      prompt: "Which database should I use?",
      multiple: false,
      allowCustom: true,
      options: [
        { id: "private-option-1", label: "SQLite", description: "A file on this server." },
        {
          id: "private-option-2",
          label: "PostgreSQL",
          description: "A separate database service.",
        },
      ],
    },
  ],
};

describe("AgentQuestionCard", () => {
  let host: HTMLDivElement;
  let root: Root;
  let onAnswer: ReturnType<typeof vi.fn<(response: AgentQuestionResponse) => void | Promise<void>>>;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    onAnswer = vi.fn();
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  function render(value = request, pending = false, error: string | null = null) {
    act(() =>
      root.render(
        <AgentQuestionCard request={value} pending={pending} error={error} onAnswer={onAnswer} />,
      ),
    );
  }
  function button(label: string) {
    return [...host.querySelectorAll("button")].find((button) => button.textContent === label)!;
  }
  async function click(element: HTMLElement) {
    await act(async () => element.click());
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

  it("requires explicit submission and keeps request and protocol identities outside the DOM", async () => {
    render();
    expect(button("Send answer").disabled).toBe(true);
    await click(host.querySelector("input")!);
    expect(onAnswer).not.toHaveBeenCalled();
    expect(host.innerHTML).not.toContain("private-");
    await click(button("Send answer"));
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({
      answers: [{ questionId: "private-question", optionIds: ["private-option-1"], text: "" }],
    });
  });

  it("permits custom-only responses and refuses whitespace and excessive UTF-8 text", async () => {
    render();
    type("   ");
    expect(button("Send answer").disabled).toBe(true);
    type("🙂".repeat(2049));
    expect(button("Send answer").disabled).toBe(true);
    expect(host.querySelector("textarea")?.getAttribute("aria-invalid")).toBe("true");
    type("Use the existing database.");
    await click(button("Send answer"));
    expect(onAnswer).toHaveBeenCalledWith({
      answers: [
        { questionId: "private-question", optionIds: [], text: "Use the existing database." },
      ],
    });
  });

  it("retains each answer across next/back and submits all questions together", async () => {
    render({
      ...request,
      questions: [
        request.questions[0],
        {
          ...request.questions[0],
          id: "second",
          prompt: "Which features?",
          multiple: true,
          allowCustom: false,
        },
      ],
    });
    expect(button("Next").disabled).toBe(true);
    await click(host.querySelector("input")!);
    type("Keep it simple.");
    await click(button("Next"));
    expect(host.textContent).toContain("2 of 2");
    expect(host.querySelector("textarea")).toBeNull();
    await click(host.querySelectorAll("input")[0]);
    await click(host.querySelectorAll("input")[1]);
    await click(button("Back"));
    expect(host.querySelector("textarea")?.value).toBe("Keep it simple.");
    expect(host.querySelector("input")?.checked).toBe(true);
    await click(button("Next"));
    await click(button("Send answer"));
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({
      answers: [
        {
          questionId: "private-question",
          optionIds: ["private-option-1"],
          text: "Keep it simple.",
        },
        { questionId: "second", optionIds: ["private-option-1", "private-option-2"], text: "" },
      ],
    });
  });

  it("can replace a selected radio with a custom-only answer", async () => {
    render();
    await click(host.querySelector("input")!);
    type("Use something else.");
    await click(button("Clear selection"));
    expect(host.querySelector("input")?.checked).toBe(false);
    await click(button("Send answer"));
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({
      answers: [{ questionId: "private-question", optionIds: [], text: "Use something else." }],
    });
  });

  it("allows deselecting multiple options and prevents submitting an empty answer", async () => {
    render({ ...request, questions: [{ ...request.questions[0], multiple: true }] });
    await click(host.querySelector("input")!);
    await click(host.querySelector("input")!);
    expect(button("Send answer").disabled).toBe(true);
  });

  it("blocks duplicates while submitting and exposes retry on failure", async () => {
    let reject!: (reason: Error) => void;
    onAnswer.mockImplementation(
      () =>
        new Promise<void>((_, fail) => {
          reject = fail;
        }),
    );
    render();
    await click(host.querySelector("input")!);
    await act(async () => {
      const form = host.querySelector("form")!;
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(host.querySelector("fieldset")?.disabled).toBe(true);
    await act(async () => reject(new Error("private transport detail")));
    expect(host.textContent).toContain("Could not send your answer");
    expect(host.textContent).not.toContain("private transport detail");
    expect(button("Send answer").disabled).toBe(false);
    render(request, true, "Connection lost. Reconnect to answer.");
    expect(host.querySelector("fieldset")?.disabled).toBe(true);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Connection lost");
  });

  it("keeps successful submission locked while acknowledgement is still pending", async () => {
    onAnswer.mockResolvedValue(undefined);
    render();
    await click(host.querySelector("input")!);
    await click(button("Send answer"));
    expect(button("Waiting…").disabled).toBe(true);
    await act(async () =>
      host
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Waiting for confirmation");
  });

  it("clears draft for another task and resets its question navigation", async () => {
    render();
    type("Only for the first task");
    render({ ...request, taskId: "another-task" });
    expect(host.querySelector("textarea")?.value).toBe("");
    expect(button("Send answer").disabled).toBe(true);
    render(request);
    expect(host.querySelector("textarea")?.value).toBe("");
  });

  it("shows only a collapsed confirmed answer after acknowledgement", () => {
    render({
      ...request,
      status: "answered",
      answers: [
        {
          questionId: "private-question",
          optionIds: ["private-option-2"],
          text: "Use production defaults.",
        },
      ],
    });
    expect(host.querySelector("details")?.open).toBe(false);
    expect(host.querySelector("summary")?.textContent).toBe("Answer sent");
    expect(host.querySelector("dd")?.textContent).toBe("PostgreSQL\nUse production defaults.");
    expect(host.querySelector("form")).toBeNull();
    expect(host.innerHTML).not.toContain("private-");
  });

  it.each(["cancelled", "expired"] as const)("makes %s questions non-interactive", (status) => {
    render({ ...request, status });
    expect(host.textContent).toContain(`Question ${status}`);
    expect(host.querySelector("input, textarea, button")).toBeNull();
  });

  it("supports a freeform question with no choices", async () => {
    render({ ...request, questions: [{ ...request.questions[0], options: [] }] });
    expect(host.querySelector("input")).toBeNull();
    type("My answer");
    await click(button("Send answer"));
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });
});
