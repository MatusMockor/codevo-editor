import { describe, expect, it } from "vitest";
import { MAX_AGENT_TOOL_SUMMARY_BYTES } from "./agentThread";
import { clipHeadTail, headTailOmissionMarker } from "./agentOutput/clipHeadTail";
import { agentQuestionToolOutcome, isAgentQuestionTool } from "./agentQuestionTranscript";

const ID = "0123456789abcdef0123456789abcdef";
const INPUT = JSON.stringify({
  questions: [
    { question: "Which layout is broken?", header: "Layout", options: [{ label: "Sidebar" }] },
  ],
});

describe("agentQuestionToolOutcome", () => {
  it("recognises only Claude's question tool", () => {
    expect(isAgentQuestionTool("AskUserQuestion")).toBe(true);
    expect(isAgentQuestionTool("Bash")).toBe(false);
  });

  it("reads every answered question and pulls image references out of the answer text", () => {
    const output =
      'Your questions have been answered: "Which layout is broken?"="Sidebar, It overlaps.\n\n' +
      `[Attached image "screen.png" is saved at: /data/agent-attachments/threads/agt-1/${ID}.png]", ` +
      '"Which theme?"="Dark". You can now continue with these answers in mind.';
    expect(agentQuestionToolOutcome({ inputSummary: INPUT, output, isError: false })).toEqual({
      kind: "answered",
      prompt: "Which layout is broken?",
      complete: true,
      answers: [
        {
          question: "Which layout is broken?",
          answer: "Sidebar, It overlaps.",
          images: [{ name: "screen.png", attachmentId: ID, mime: "image/png" }],
        },
        { question: "Which theme?", answer: "Dark", images: [] },
      ],
    });
  });

  it("finds an image after selected options on the same line or on its own line", () => {
    const line = `[Attached image "s.png" is saved at: /data/agent-attachments/threads/agt-1/${ID}.png]`;
    const image = { name: "s.png", attachmentId: ID, mime: "image/png" };
    for (const answer of [`Sidebar, ${line}`, `Sidebar, \n\n${line}`]) {
      const output = `Your questions have been answered: "Q?"="${answer}". You can now continue with these answers in mind.`;
      const outcome = agentQuestionToolOutcome({ inputSummary: "", output, isError: false });
      expect(outcome.kind === "answered" && outcome.answers[0]).toEqual({
        question: "Q?",
        answer: "Sidebar",
        images: [image],
      });
    }
    const withText = `Your questions have been answered: "Q?"="Sidebar, Broken\n\n${line}". You can now continue with these answers in mind.`;
    const outcome = agentQuestionToolOutcome({
      inputSummary: "",
      output: withText,
      isError: false,
    });
    expect(outcome.kind === "answered" && outcome.answers[0]).toEqual({
      question: "Q?",
      answer: "Sidebar, Broken",
      images: [image],
    });
  });

  it("accepts the careful-reading wording and an unselected question", () => {
    const output =
      'The user answered: "Deploy?"=(no option selected), "Why?"="Not yet". Read the answers carefully - follow them.';
    const outcome = agentQuestionToolOutcome({ inputSummary: "", output, isError: false });
    expect(outcome.kind === "answered" && outcome.answers).toEqual([
      { question: "Deploy?", answer: "", images: [] },
      { question: "Why?", answer: "Not yet", images: [] },
    ]);
  });

  it("marks a transcript-shortened answer as incomplete and keeps the partial last pair", () => {
    const output = `Your questions have been answered: "First?"="One", "Second?"="Tw${headTailOmissionMarker(900)}rest". You can now continue with these answers in mind.`;
    const outcome = agentQuestionToolOutcome({ inputSummary: "", output, isError: false });
    expect(outcome).toMatchObject({
      kind: "answered",
      complete: false,
      answers: [
        { question: "First?", answer: "One", images: [] },
        { question: "Second?", answer: "Tw", images: [] },
      ],
    });
  });

  it("keeps a long clipped custom answer with an image as answered, never as not answered", () => {
    const raw =
      `Your questions have been answered: "Which layout is broken?"="${"The sidebar overlaps. ".repeat(12)}\n\n` +
      `[Attached image "screen.png" is saved at: /Users/me/Library/Application Support/codevo/agent-attachments/threads/agt-t1-0001/${ID}.png]". ` +
      "You can now continue with these answers in mind.";
    const output = clipHeadTail(raw, MAX_AGENT_TOOL_SUMMARY_BYTES).text;
    expect(output).not.toBe(raw);
    const outcome = agentQuestionToolOutcome({ inputSummary: INPUT, output, isError: false });
    expect(outcome.kind).toBe("answered");
    expect(outcome.kind === "answered" && outcome.complete).toBe(false);
    expect(outcome.kind === "answered" && outcome.answers[0]?.question).toBe(
      "Which layout is broken?",
    );
    expect(outcome.kind === "answered" && outcome.answers[0]?.answer).toContain("The sidebar");
  });

  it("stays answered when clipping cuts into the first question", () => {
    const output = `Your questions have been answered: "Which lay${headTailOmissionMarker(2000)}in mind.`;
    expect(agentQuestionToolOutcome({ inputSummary: INPUT, output, isError: false })).toEqual({
      kind: "answered",
      prompt: "Which layout is broken?",
      answers: [],
      complete: false,
    });
  });

  it("does not split a custom answer that itself contains a quoted list", () => {
    const input = JSON.stringify({
      questions: [{ question: "Colors?" }, { question: "Size?" }],
    });
    const output =
      'Your questions have been answered: "Colors?"="I like "red", "blue"", "Size?"="Large". You can now continue with these answers in mind.';
    const outcome = agentQuestionToolOutcome({ inputSummary: input, output, isError: false });
    expect(outcome.kind === "answered" && outcome.answers).toEqual([
      { question: "Colors?", answer: 'I like "red", "blue"', images: [] },
      { question: "Size?", answer: "Large", images: [] },
    ]);
  });

  it("records an unrecognised successful result neutrally instead of claiming no answer", () => {
    expect(
      agentQuestionToolOutcome({
        inputSummary: INPUT,
        output: "The user responded: ship it",
        isError: false,
      }),
    ).toEqual({
      kind: "recorded",
      prompt: "Which layout is broken?",
      text: "The user responded: ship it",
    });
  });

  it("reports a pending question with its prompt and an unanswered one truthfully", () => {
    expect(agentQuestionToolOutcome({ inputSummary: INPUT, output: null, isError: false })).toEqual(
      { kind: "asked", prompt: "Which layout is broken?" },
    );
    expect(
      agentQuestionToolOutcome({
        inputSummary: INPUT,
        output: "The user did not answer the questions.",
        isError: false,
      }),
    ).toEqual({
      kind: "unanswered",
      prompt: "Which layout is broken?",
      text: "The user did not answer the questions.",
    });
    expect(
      agentQuestionToolOutcome({ inputSummary: "{", output: "Denied", isError: true }),
    ).toEqual({ kind: "unanswered", prompt: null, text: "Denied" });
  });

  it("ignores image lines whose file name is not an attachment id", () => {
    const output =
      'Your questions have been answered: "Q?"="[Attached image "x.png" is saved at: /tmp/evil.png]". You can now continue with these answers in mind.';
    const outcome = agentQuestionToolOutcome({ inputSummary: "", output, isError: false });
    expect(outcome.kind === "answered" && outcome.answers[0]).toEqual({
      question: "Q?",
      answer: '[Attached image "x.png" is saved at: /tmp/evil.png]',
      images: [],
    });
  });
});
