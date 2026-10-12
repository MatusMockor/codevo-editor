import {
  AGENT_MCP_SERVER_MANAGEMENT_LIMITS,
  isAgentMcpServerArgument,
  isAgentMcpServerCommand,
} from "./agentMcpServerManagement";

export const MAX_AGENT_MCP_SERVER_COMMAND_LINE_BYTES = 8192;

export type AgentMcpServerCommandLineIssue =
  | "empty"
  | "tooLong"
  | "unbalancedQuote"
  | "danglingEscape"
  | "controlCharacter"
  | "commandTooLong"
  | "tooManyArguments"
  | "argumentTooLong";

export type AgentMcpServerCommandLine =
  | {
      readonly kind: "parsed";
      readonly command: string;
      readonly args: ReadonlyArray<string>;
    }
  | { readonly kind: "invalid"; readonly issue: AgentMcpServerCommandLineIssue };

type Quote = "none" | "single" | "double";

type Words =
  | { readonly kind: "words"; readonly words: ReadonlyArray<string> }
  | { readonly kind: "invalid"; readonly issue: AgentMcpServerCommandLineIssue };

const MAX_WORDS = AGENT_MCP_SERVER_MANAGEMENT_LIMITS.maxArgs + 1;
const ESCAPABLE_IN_DOUBLE_QUOTES = ['"', "\\", "$", "`"];
const CONTROL_CHARACTER = /\p{Cc}/u;
const UTF8_ENCODER = new TextEncoder();

export function parseAgentMcpServerCommandLine(input: string): AgentMcpServerCommandLine {
  if (exceeds(input, MAX_AGENT_MCP_SERVER_COMMAND_LINE_BYTES)) return rejected("tooLong");
  const split = splitWords(input);
  if (split.kind === "invalid") return split;
  const [command, ...args] = split.words;
  if (command === undefined || command.length === 0) return rejected("empty");
  if (split.words.some((word) => CONTROL_CHARACTER.test(word))) return rejected("controlCharacter");
  if (!isAgentMcpServerCommand(command)) return rejected("commandTooLong");
  if (args.some((arg) => !isAgentMcpServerArgument(arg))) return rejected("argumentTooLong");
  return Object.freeze({ kind: "parsed", command, args: Object.freeze(args) });
}

function splitWords(input: string): Words {
  const words: Array<string> = [];
  let word = "";
  let started = false;
  let quote: Quote = "none";
  for (let index = 0; index < input.length; index += 1) {
    const character = input.charAt(index);
    const next = input.charAt(index + 1);
    if (quote === "single") {
      if (character === "'") quote = "none";
      if (character !== "'") word += character;
      continue;
    }
    if (quote === "double") {
      const escaped = character === "\\" && ESCAPABLE_IN_DOUBLE_QUOTES.includes(next);
      if (escaped) index += 1;
      if (character === '"') quote = "none";
      if (character !== '"') word += escaped ? next : character;
      continue;
    }
    if (character === " " || character === "\t") {
      if (started) words.push(word);
      if (words.length > MAX_WORDS) return rejected("tooManyArguments");
      word = "";
      started = false;
      continue;
    }
    started = true;
    if (character === "'") {
      quote = "single";
      continue;
    }
    if (character === '"') {
      quote = "double";
      continue;
    }
    if (character !== "\\") {
      word += character;
      continue;
    }
    if (next.length === 0) return rejected("danglingEscape");
    word += next;
    index += 1;
  }
  if (quote !== "none") return rejected("unbalancedQuote");
  if (started) words.push(word);
  if (words.length > MAX_WORDS) return rejected("tooManyArguments");
  return { kind: "words", words };
}

function rejected(issue: AgentMcpServerCommandLineIssue): {
  readonly kind: "invalid";
  readonly issue: AgentMcpServerCommandLineIssue;
} {
  return Object.freeze({ kind: "invalid", issue });
}

function exceeds(value: string, maxBytes: number): boolean {
  if (value.length > maxBytes) return true;
  return UTF8_ENCODER.encode(value).byteLength > maxBytes;
}
