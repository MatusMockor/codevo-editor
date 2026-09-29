import { isAgentAttachmentId, type AgentImageMime } from "./agentAttachment";

export interface AgentQuestionImageReference {
  readonly name: string;
  readonly attachmentId: string;
  readonly mime: AgentImageMime;
}

export interface AgentAnsweredQuestion {
  readonly question: string;
  readonly answer: string;
  readonly images: ReadonlyArray<AgentQuestionImageReference>;
}

export type AgentQuestionToolOutcome =
  | { readonly kind: "asked"; readonly prompt: string | null }
  | {
      readonly kind: "answered";
      readonly prompt: string | null;
      readonly answers: ReadonlyArray<AgentAnsweredQuestion>;
      readonly complete: boolean;
    }
  | { readonly kind: "recorded"; readonly prompt: string | null; readonly text: string }
  | { readonly kind: "unanswered"; readonly prompt: string | null; readonly text: string };

export interface AgentQuestionToolSource {
  readonly inputSummary: string;
  readonly output: string | null;
  readonly isError: boolean;
}

interface ParsedAnswers {
  readonly answers: ReadonlyArray<AgentAnsweredQuestion>;
  readonly complete: boolean;
}

interface ParsedPair {
  readonly question: string;
  readonly answer: string;
  readonly next: number;
}

const QUESTION_TOOL_NAME = "AskUserQuestion";
const ANSWER_PREFIXES = ["Your questions have been answered: ", "The user answered: "] as const;
const ANSWER_SUFFIXES = [
  ". You can now continue with these answers in mind.",
  ". Read the answers carefully",
] as const;
const NOT_ANSWERED = "The user did not answer the questions.";
const NO_SELECTION = "(no option selected)";
const SEPARATOR = '", "';
const OMISSION_MARKER = /\n… \d+ bytes omitted …\n/u;
const QUESTION_LITERAL = /"question"\s*:\s*("(?:[^"\\]|\\.)*")/gu;
const IMAGE_MARKER = '[Attached image "';
const IMAGE_LINE = /^\[Attached image "([^"\n]+)" is saved at: (\/[^\n]*)\]$/u;
const MAX_ANSWERS = 4;
const IMAGE_MIMES: ReadonlyMap<string, AgentImageMime> = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
]);

export function isAgentQuestionTool(name: string): boolean {
  return name === QUESTION_TOOL_NAME;
}

export function agentQuestionOutputMayCarryImages(output: string): boolean {
  return output.includes(IMAGE_MARKER);
}

export function agentQuestionToolOutcome(
  source: AgentQuestionToolSource,
): AgentQuestionToolOutcome {
  const prompts = questionPrompts(source.inputSummary);
  const prompt = prompts[0] ?? null;
  const output = source.output;
  if (output === null) return { kind: "asked", prompt };
  if (source.isError || output.trim() === NOT_ANSWERED) {
    return { kind: "unanswered", prompt, text: output };
  }
  const parsed = parseAnswers(output, prompts);
  if (parsed === null) return { kind: "recorded", prompt, text: output };
  return {
    kind: "answered",
    prompt: prompt ?? parsed.answers[0]?.question ?? null,
    answers: parsed.answers,
    complete: parsed.complete,
  };
}

function questionPrompts(summary: string): ReadonlyArray<string> {
  const prompts: string[] = [];
  for (const match of summary.matchAll(QUESTION_LITERAL)) {
    if (prompts.length >= MAX_ANSWERS) break;
    const prompt = parsedLiteral(match[1]);
    if (prompt !== null) prompts.push(prompt);
  }
  return prompts;
}

function parsedLiteral(literal: string | undefined): string | null {
  if (literal === undefined) return null;
  try {
    const value: unknown = JSON.parse(literal);
    return typeof value === "string" && value.trim() !== "" ? value : null;
  } catch {
    return null;
  }
}

function parseAnswers(output: string, prompts: ReadonlyArray<string>): ParsedAnswers | null {
  const prefix = ANSWER_PREFIXES.find((candidate) => output.startsWith(candidate));
  if (prefix === undefined) return null;
  const omission = OMISSION_MARKER.exec(output);
  const clipped = omission !== null;
  const visible = clipped
    ? output.slice(prefix.length, omission.index)
    : output.slice(prefix.length);
  const body = clipped ? visible : withoutSuffix(visible);
  if (body === null) return { answers: [], complete: false };
  const answers: AgentAnsweredQuestion[] = [];
  let position = 0;
  while (position < body.length && answers.length < MAX_ANSWERS) {
    const pair = readPair(body, position, clipped, prompts);
    if (pair === null) break;
    answers.push(answeredQuestion(pair.question, pair.answer));
    position = pair.next;
  }
  return { answers, complete: !clipped && position >= body.length };
}

function withoutSuffix(body: string): string | null {
  for (const suffix of ANSWER_SUFFIXES) {
    const index = body.lastIndexOf(suffix);
    if (index !== -1) return body.slice(0, index);
  }
  return null;
}

function readPair(
  body: string,
  start: number,
  clipped: boolean,
  prompts: ReadonlyArray<string>,
): ParsedPair | null {
  if (body[start] !== '"') return null;
  const questionEnd = body.indexOf('"=', start + 1);
  if (questionEnd === -1) return null;
  const question = body.slice(start + 1, questionEnd);
  const answerStart = questionEnd + 2;
  if (body.startsWith(NO_SELECTION, answerStart)) {
    return { question, answer: "", next: separatorEnd(body, answerStart + NO_SELECTION.length) };
  }
  if (body[answerStart] !== '"') return null;
  const separator = answerSeparator(body, answerStart + 1, prompts);
  if (separator !== null) {
    return { question, answer: body.slice(answerStart + 1, separator), next: separator + 3 };
  }
  if (clipped) return { question, answer: body.slice(answerStart + 1), next: body.length };
  if (!body.endsWith('"') || body.length - 1 <= answerStart) return null;
  return { question, answer: body.slice(answerStart + 1, -1), next: body.length };
}

function answerSeparator(
  body: string,
  from: number,
  prompts: ReadonlyArray<string>,
): number | null {
  const candidates: { readonly index: number; readonly question: string }[] = [];
  let index = body.indexOf(SEPARATOR, from);
  while (index !== -1 && candidates.length < 256) {
    const questionEnd = body.indexOf('"=', index + SEPARATOR.length);
    if (questionEnd === -1) break;
    candidates.push({ index, question: body.slice(index + SEPARATOR.length, questionEnd) });
    index = body.indexOf(SEPARATOR, index + 1);
  }
  const known = candidates.find((candidate) => prompts.includes(candidate.question));
  if (known !== undefined) return known.index;
  const clean = candidates.find((candidate) => !candidate.question.includes(SEPARATOR));
  if (clean !== undefined) return clean.index;
  return candidates[candidates.length - 1]?.index ?? null;
}

function separatorEnd(body: string, index: number): number {
  return body.startsWith(", ", index) ? index + 2 : index;
}

function answeredQuestion(question: string, raw: string): AgentAnsweredQuestion {
  const images: AgentQuestionImageReference[] = [];
  const kept: string[] = [];
  for (const line of raw.split("\n")) {
    const split = inlineImageStart(line);
    const image = imageReference(line.slice(split));
    if (image === null) {
      kept.push(line);
      continue;
    }
    images.push(image);
    if (split > 0) kept.push(line.slice(0, split));
  }
  const answer = kept.join("\n").trim();
  return {
    question,
    answer: images.length > 0 ? answer.replace(/,$/u, "").trimEnd() : answer,
    images,
  };
}

function inlineImageStart(line: string): number {
  const index = line.indexOf(`, ${IMAGE_MARKER}`);
  return index === -1 ? 0 : index + 2;
}

function imageReference(line: string): AgentQuestionImageReference | null {
  const match = IMAGE_LINE.exec(line);
  if (match === null) return null;
  const [, name, path] = match;
  const file = path?.slice(path.lastIndexOf("/") + 1) ?? "";
  const dot = file.lastIndexOf(".");
  const attachmentId = file.slice(0, dot);
  const mime = IMAGE_MIMES.get(file.slice(dot + 1).toLowerCase());
  if (name === undefined || dot <= 0 || !isAgentAttachmentId(attachmentId) || mime === undefined) {
    return null;
  }
  return { name, attachmentId, mime };
}
