import { describe, expect, it } from "vitest";
import { parseAgentQuestionRequest, parseAgentQuestionResponse } from "./agentQuestion";

const question = {
  id: "q1",
  header: "Database",
  prompt: "Which database?",
  multiple: false,
  allowCustom: true,
  options: [
    { id: "sqlite", label: "SQLite", description: "Local storage" },
    { id: "postgres", label: "Postgres", description: "Shared storage" },
  ],
};
const request = {
  id: "request-1",
  taskId: "task-1",
  provider: "codex",
  status: "pending",
  questions: [question],
};
const response = { answers: [{ questionId: "q1", optionIds: ["sqlite"], text: "" }] };

describe("agent questions", () => {
  it("parses both providers into independently owned values", () => {
    const parsed = parseAgentQuestionRequest(request);
    expect(parsed).toEqual(request);
    expect(parsed.questions).not.toBe(request.questions);
    expect(parsed.questions[0]?.options).not.toBe(question.options);
    expect(parseAgentQuestionRequest({ ...request, provider: "claudeCode" }).provider).toBe(
      "claudeCode",
    );
  });
  it("supports freeform questions, empty headers and multiple selections", () => {
    const freeform = parseAgentQuestionRequest({
      ...request,
      questions: [{ ...question, header: "", options: [] }],
    });
    expect(
      parseAgentQuestionResponse(
        { answers: [{ questionId: "q1", optionIds: [], text: "My answer" }] },
        freeform,
      ).answers[0]?.text,
    ).toBe("My answer");
    const multi = parseAgentQuestionRequest({
      ...request,
      questions: [{ ...question, multiple: true }],
    });
    expect(
      parseAgentQuestionResponse(
        { answers: [{ questionId: "q1", optionIds: ["sqlite", "postgres"], text: "Use both" }] },
        multi,
      ).answers[0]?.optionIds,
    ).toHaveLength(2);
  });
  it.each(["pending", "cancelled", "expired"])(
    "does not accept answers on %s requests",
    (status) => {
      expect(parseAgentQuestionRequest({ ...request, status }).status).toBe(status);
      expect(() => parseAgentQuestionRequest({ ...request, status, answers: [] })).toThrow();
    },
  );
  it("validates answered snapshots exactly as submissions", () => {
    expect(
      parseAgentQuestionRequest({ ...request, status: "answered", answers: response.answers }),
    ).toMatchObject({ status: "answered", answers: response.answers });
    expect(() => parseAgentQuestionRequest({ ...request, status: "answered" })).toThrow();
    expect(() =>
      parseAgentQuestionRequest({ ...request, status: "answered", answers: [] }),
    ).toThrow();
  });
  it.each([
    null,
    [],
    {},
    { ...request, privateRpcId: "secret" },
    { ...request, status: "running" },
    { ...request, provider: "claude" },
    { ...request, id: "x\n" },
    { ...request, taskId: "x".repeat(129) },
    { ...request, questions: [] },
    { ...request, questions: Array(5).fill(question) },
    { ...request, questions: [question, question] },
    { ...request, questions: [{ ...question, prompt: " " }] },
    { ...request, questions: [{ ...question, prompt: "a\0b" }] },
    { ...request, questions: [{ ...question, header: "é".repeat(65) }] },
    { ...request, questions: [{ ...question, prompt: "😀".repeat(2049) }] },
    { ...request, questions: [{ ...question, multiple: "false" }] },
    { ...request, questions: [{ ...question, options: [], allowCustom: false }] },
    { ...request, questions: [{ ...question, options: Array(13).fill(question.options[0]) }] },
    {
      ...request,
      questions: [{ ...question, options: [question.options[0], question.options[0]] }],
    },
    {
      ...request,
      questions: [{ ...question, options: [{ id: "x", label: "", description: "" }] }],
    },
    {
      ...request,
      questions: [
        { ...question, options: [{ id: "x", label: "x", description: "x", extra: true }] },
      ],
    },
  ])("rejects malformed request %#", (value) => {
    expect(() => parseAgentQuestionRequest(value)).toThrow("Invalid agent question payload.");
  });
  it.each([
    {},
    { ...response, extra: true },
    { answers: [] },
    { answers: [response.answers[0], response.answers[0]] },
    { answers: [{ questionId: "foreign", optionIds: ["sqlite"], text: "" }] },
    { answers: [{ questionId: "q1", optionIds: ["unknown"], text: "" }] },
    { answers: [{ questionId: "q1", optionIds: ["sqlite", "sqlite"], text: "" }] },
    { answers: [{ questionId: "q1", optionIds: ["sqlite", "postgres"], text: "" }] },
    { answers: [{ questionId: "q1", optionIds: [], text: "  " }] },
    { answers: [{ questionId: "q1", optionIds: [], text: "é".repeat(4097) }] },
    { answers: [{ questionId: "q1", optionIds: [], text: "ok", extra: true }] },
  ])("rejects malformed answer %#", (value) => {
    expect(() => parseAgentQuestionResponse(value, parseAgentQuestionRequest(request))).toThrow();
  });
  it("rejects custom text when not permitted even alongside valid selection", () => {
    const closed = parseAgentQuestionRequest({
      ...request,
      questions: [{ ...question, allowCustom: false }],
    });
    expect(parseAgentQuestionResponse(response, closed)).toEqual(response);
    expect(() =>
      parseAgentQuestionResponse({ answers: [{ ...response.answers[0], text: "extra" }] }, closed),
    ).toThrow();
  });
  it("requires every question, accepts reordered responses and exact UTF8 byte boundary", () => {
    const two = parseAgentQuestionRequest({
      ...request,
      questions: [question, { ...question, id: "q2" }],
    });
    expect(() => parseAgentQuestionResponse(response, two)).toThrow();
    expect(
      parseAgentQuestionResponse(
        {
          answers: [
            { questionId: "q2", optionIds: [], text: "é".repeat(4096) },
            response.answers[0],
          ],
        },
        two,
      ).answers,
    ).toHaveLength(2);
  });
});
