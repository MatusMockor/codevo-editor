import { MAX_AGENT_TOOL_SUMMARY_BYTES } from "./agentThread";
import { boundedUtf8Text } from "./agentOutput/utf8Text";

export type AgentToolRowKind = "command" | "read" | "edit" | "search" | "agent" | "web" | "other";

export type AgentToolRowStatus = "running" | "ok" | "error" | "stopped";

export interface AgentToolRowLabel {
  readonly verb: string;
  readonly subject: string;
  readonly argument: string | null;
}

export interface AgentToolRowLabelInput {
  readonly name: string;
  readonly inputSummary: string;
  readonly description?: string;
  readonly status: AgentToolRowStatus;
  readonly workspaceRoot?: string | null;
}

export const MAX_AGENT_TOOL_ROW_SUBJECT_CHARS = 80;

const MAX_COMMAND_SCAN_CHARS = 2048;
const MAX_COMMAND_SEGMENTS = 4;
const MAX_SEGMENT_TOKENS = 24;
const MAX_TOKEN_CHARS = 256;
const MAX_PATH_SEGMENTS = 64;
const MAX_RUNNER_ARGUMENTS = 2;
const ELLIPSIS = "…";
const UNKNOWN_TOOL_NAME = "tool";

const TOOL_ROW_KINDS: ReadonlyMap<string, AgentToolRowKind> = new Map([
  ["bash", "command"],
  ["shell", "command"],
  ["exec", "command"],
  ["exec_command", "command"],
  ["local_shell", "command"],
  ["run_command", "command"],
  ["run_terminal_cmd", "command"],
  ["terminal", "command"],
  ["read", "read"],
  ["readfile", "read"],
  ["read_file", "read"],
  ["notebookread", "read"],
  ["notebook_read", "read"],
  ["view", "read"],
  ["edit", "edit"],
  ["multiedit", "edit"],
  ["write", "edit"],
  ["writefile", "edit"],
  ["write_file", "edit"],
  ["edit_file", "edit"],
  ["notebookedit", "edit"],
  ["notebook_edit", "edit"],
  ["apply_patch", "edit"],
  ["applypatch", "edit"],
  ["create_file", "edit"],
  ["grep", "search"],
  ["glob", "search"],
  ["search", "search"],
  ["ripgrep", "search"],
  ["grep_search", "search"],
  ["file_search", "search"],
  ["codebase_search", "search"],
  ["agent", "agent"],
  ["task", "agent"],
  ["spawnagent", "agent"],
  ["spawn_agent", "agent"],
  ["subagent", "agent"],
  ["webfetch", "web"],
  ["websearch", "web"],
  ["web_fetch", "web"],
  ["web_search", "web"],
  ["fetch", "web"],
  ["browse", "web"],
] as ReadonlyArray<readonly [string, AgentToolRowKind]>);

const PREFIX_COMMANDS: ReadonlySet<string> = new Set([
  "sudo",
  "doas",
  "env",
  "nohup",
  "time",
  "command",
  "builtin",
  "exec",
  "export",
  "source",
  ".",
  "if",
  "for",
  "while",
  "until",
  "eval",
  "timeout",
]);

const VALUE_FLAGS: ReadonlySet<string> = new Set([
  "-u",
  "-g",
  "-p",
  "-C",
  "-h",
  "-r",
  "-t",
  "-f",
  "-o",
  "-S",
  "--user",
  "--group",
  "--prompt",
  "--unset",
  "--chdir",
  "--format",
  "--output",
]);

const REDIRECT_TOKENS: ReadonlySet<string> = new Set(["<", ">"]);

const DIRECTORY_COMMANDS: ReadonlySet<string> = new Set(["cd", "pushd", "popd", "chdir"]);

const SHELL_WORD_COMMANDS: ReadonlySet<string> = new Set(["for", "case", "select"]);

const SHELL_PROGRAM_NAME = "shell";

const DURATION_FLAGS: ReadonlySet<string> = new Set(["timeout"]);

const RUNNER_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--prefix",
  "--cwd",
  "--dir",
  "--filter",
  "--package",
  "--workspace",
  "-w",
  "-C",
]);

const NOISE_TOKENS: ReadonlySet<string> = new Set(["$", "$$", "!", "=", "-", "--", "then", "do"]);

const PACKAGE_RUNNERS: ReadonlySet<string> = new Set([
  "npm",
  "npx",
  "pnpm",
  "pnpx",
  "yarn",
  "bun",
  "bunx",
]);

const RUNNER_VERBS: ReadonlySet<string> = new Set(["run", "run-script", "exec", "dlx", "x"]);

const SEGMENT_BREAKS: ReadonlySet<string> = new Set(["|", "&", ";", "\n", "(", ")", "{", "}", "`"]);

const TOKEN_BREAKS: ReadonlySet<string> = new Set([" ", "\t", "\r"]);

const ESCAPABLE_CHARACTERS: ReadonlySet<string> = new Set(["$", "`", '"', "\\", "\n"]);

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const DIGITS_ONLY = /^\d+$/;
const DURATION_TOKEN = /^\d+(\.\d+)?[smhd]?$/;
const VARIABLE_REFERENCE = /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/;
const PATH_LIST_SEPARATOR = ", ";
const MAX_PATH_LIST_ITEMS = 32;
const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;
const PATH_SEPARATOR = /[\\/]/;
const WHITESPACE_RUN = /\s+/g;

interface GraphemeSegmenter {
  segment(text: string): Iterable<{ readonly segment: string }>;
}

type GraphemeSegmenterFactory = new (
  locale: string,
  options: { readonly granularity: "grapheme" },
) => GraphemeSegmenter;

let cachedSegmenter: GraphemeSegmenter | null | undefined;

export function toolRowKind(name: string): AgentToolRowKind {
  return TOOL_ROW_KINDS.get(name.trim().toLowerCase()) ?? "other";
}

export function commandProgramName(command: string): string | null {
  for (const tokens of commandSegments(command.slice(0, MAX_COMMAND_SCAN_CHARS))) {
    const program = segmentProgram(tokens);
    if (program === null) continue;
    return program;
  }
  return null;
}

export function toolRowLabel(input: AgentToolRowLabelInput): AgentToolRowLabel {
  const kind = toolRowKind(input.name);
  const summary = boundedUtf8Text(input.inputSummary, MAX_AGENT_TOOL_SUMMARY_BYTES);
  const description = clipLine(input.description ?? "");
  const parts = rowSubject({
    description,
    kind,
    name: clipLine(input.name),
    root: input.workspaceRoot ?? null,
    summary,
  });
  const spoken =
    kind === "command" &&
    description !== "" &&
    (input.status === "running" || input.status === "ok");
  return { verb: spoken ? "" : rowVerb(kind, input.status), ...parts };
}

interface RowSubjectInput {
  readonly description: string;
  readonly kind: AgentToolRowKind;
  readonly name: string;
  readonly root: string | null;
  readonly summary: string;
}

type RowSubjectParts = Pick<AgentToolRowLabel, "subject" | "argument">;

function rowSubject(input: RowSubjectInput): RowSubjectParts {
  const { description, kind, name, root, summary } = input;
  switch (kind) {
    case "command":
      return commandSubject(description, name, summary);
    case "read":
    case "edit":
      return { subject: preferred(clipLine(displayPaths(summary, root)), name), argument: null };
    case "search":
    case "web":
      return { subject: preferred(clipLine(summary), name), argument: null };
    case "agent":
      return {
        subject: preferred(preferred(description, clipLine(summary)), name),
        argument: null,
      };
    case "other":
      return { subject: preferred(name, UNKNOWN_TOOL_NAME), argument: argumentText(summary, "") };
    default:
      return unsupportedToolRowKind(kind);
  }
}

function commandSubject(description: string, name: string, summary: string): RowSubjectParts {
  const program = commandProgramName(summary) ?? "";
  const subject = preferred(preferred(description, program), preferred(clipLine(summary), name));
  return { subject, argument: argumentText(summary, subject) };
}

function rowVerb(kind: AgentToolRowKind, status: AgentToolRowStatus): string {
  if (status === "error") return "Failed";
  if (status === "stopped") return "Stopped";
  const running = status === "running";
  switch (kind) {
    case "command":
      return running ? "Running" : "Ran";
    case "read":
      return running ? "Reading" : "Read";
    case "edit":
      return running ? "Editing" : "Edited";
    case "search":
      return running ? "Searching" : "Searched";
    case "agent":
      return running ? "Delegating" : "Delegated";
    case "web":
      return running ? "Fetching" : "Fetched";
    case "other":
      return running ? "Calling" : "Called";
    default:
      return unsupportedToolRowKind(kind);
  }
}

function argumentText(summary: string, subject: string): string | null {
  const argument = singleLine(summary);
  if (argument === "") return null;
  if (argument === subject) return null;
  return argument;
}

function preferred(candidate: string, fallback: string): string {
  if (candidate !== "") return candidate;
  return fallback;
}

function displayPaths(summary: string, workspaceRoot: string | null): string {
  const parts = summary
    .split(PATH_LIST_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .slice(0, MAX_PATH_LIST_ITEMS);
  const first = parts[0];
  if (first === undefined) return displayPath(summary, workspaceRoot);
  if (parts.length === 1) return displayPath(first, workspaceRoot);
  return `${displayPath(first, workspaceRoot)} +${parts.length - 1} more`;
}

function displayPath(rawPath: string, workspaceRoot: string | null): string {
  const path = rawPath.trim();
  if (path === "") return "";
  const relative = relativeToRoot(path, workspaceRoot);
  if (relative !== null) return relative;
  const parts = pathSegments(path);
  const base = parts[parts.length - 1] ?? "";
  const parent = parts[parts.length - 2];
  if (parent === undefined) return preferred(base, path);
  return `${parent}/${base}`;
}

function relativeToRoot(path: string, workspaceRoot: string | null): string | null {
  if (workspaceRoot === null) return null;
  const root = workspaceRoot.trim();
  if (root === "") return null;
  if (!isAbsolutePath(path)) return null;
  const rootParts = pathSegments(root);
  if (rootParts.length === 0) return null;
  const pathParts = pathSegments(path);
  if (pathParts.length <= rootParts.length) return null;
  for (let index = 0; index < rootParts.length; index += 1) {
    if (pathParts[index] !== rootParts[index]) return null;
  }
  return pathParts.slice(rootParts.length).join("/");
}

function isAbsolutePath(path: string): boolean {
  if (path.startsWith("/")) return true;
  if (path.startsWith("\\")) return true;
  return WINDOWS_DRIVE.test(path);
}

function pathSegments(path: string): ReadonlyArray<string> {
  return path
    .split(PATH_SEPARATOR)
    .filter((part) => part !== "")
    .slice(-MAX_PATH_SEGMENTS);
}

function commandSegments(command: string): ReadonlyArray<ReadonlyArray<string>> {
  const segments: string[][] = [];
  let tokens: string[] = [];
  let token = "";
  let quote = "";
  let index = 0;

  while (index < command.length && segments.length < MAX_COMMAND_SEGMENTS) {
    const character = command[index] ?? "";
    index += 1;
    if (quote !== "") {
      if (character === quote) {
        quote = "";
        continue;
      }
      if (character === "\\" && quote === '"' && ESCAPABLE_CHARACTERS.has(command[index] ?? "")) {
        token = appendChar(token, command[index] ?? "");
        index += 1;
        continue;
      }
      token = appendChar(token, character);
      continue;
    }
    if (character === "$" && (command[index] ?? "") === "{") {
      let scan = index + 1;
      let reference = "${";
      while (scan < command.length && (command[scan] ?? "") !== "}") {
        reference += command[scan] ?? "";
        scan += 1;
      }
      if (scan < command.length) {
        token = appendChar(token, "");
        for (const part of `${reference}}`) token = appendChar(token, part);
        index = scan + 1;
        continue;
      }
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "\\" && ESCAPABLE_CHARACTERS.has(command[index] ?? "")) {
      const escaped = command[index] ?? "";
      index += 1;
      if (escaped === "\n") continue;
      token = appendChar(token, escaped);
      continue;
    }
    if (SEGMENT_BREAKS.has(character)) {
      tokens = pushToken(tokens, token);
      token = "";
      if (tokens.length > 0) segments.push(tokens);
      tokens = [];
      continue;
    }
    if (REDIRECT_TOKENS.has(character)) {
      tokens = pushToken(tokens, token);
      token = "";
      tokens = pushToken(tokens, character);
      continue;
    }
    if (TOKEN_BREAKS.has(character)) {
      tokens = pushToken(tokens, token);
      token = "";
      continue;
    }
    token = appendChar(token, character);
  }

  tokens = pushToken(tokens, token);
  if (tokens.length > 0 && segments.length < MAX_COMMAND_SEGMENTS) segments.push(tokens);
  return segments;
}

function appendChar(token: string, character: string): string {
  if (token.length >= MAX_TOKEN_CHARS) return token;
  return token + character;
}

function pushToken(tokens: string[], token: string): string[] {
  if (token === "") return tokens;
  if (tokens.length >= MAX_SEGMENT_TOKENS) return tokens;
  tokens.push(token);
  return tokens;
}

function segmentProgram(tokens: ReadonlyArray<string>): string | null {
  let index = skipRedirections(tokens, 0);
  while (index < tokens.length) {
    const token = tokens[index] ?? "";
    if (NOISE_TOKENS.has(token) || DIGITS_ONLY.test(token)) {
      index = skipRedirections(tokens, index + 1);
      continue;
    }
    if (VARIABLE_REFERENCE.test(token)) {
      index = skipRedirections(tokens, index + 1);
      continue;
    }
    if (SHELL_WORD_COMMANDS.has(token)) return SHELL_PROGRAM_NAME;
    if (ENV_ASSIGNMENT.test(token)) {
      index = skipRedirections(tokens, index + 1);
      continue;
    }
    if (PREFIX_COMMANDS.has(token)) {
      const afterFlags = skipFlags(tokens, index + 1);
      const withDuration =
        DURATION_FLAGS.has(token) && DURATION_TOKEN.test(tokens[afterFlags] ?? "")
          ? afterFlags + 1
          : afterFlags;
      index = skipRedirections(tokens, withDuration);
      continue;
    }
    break;
  }
  const head = tokens[index];
  if (head === undefined) return null;
  const program = basename(head);
  if (program === "") return null;
  if (DIRECTORY_COMMANDS.has(program)) return null;
  return clipLine(runnerProgram(program, tokens.slice(index + 1)));
}

function skipRedirections(tokens: ReadonlyArray<string>, start: number): number {
  let index = start;
  while (index < tokens.length) {
    const token = tokens[index] ?? "";
    if (DIGITS_ONLY.test(token) && REDIRECT_TOKENS.has(tokens[index + 1] ?? "")) {
      index += 1;
      continue;
    }
    if (!REDIRECT_TOKENS.has(token)) return index;
    index += 1;
    while (index < tokens.length && REDIRECT_TOKENS.has(tokens[index] ?? "")) index += 1;
    index += 1;
  }
  return index;
}

function skipFlags(tokens: ReadonlyArray<string>, start: number): number {
  let index = start;
  while (index < tokens.length) {
    const token = tokens[index] ?? "";
    if (!token.startsWith("-") || token === "-" || token === "--") return index;
    index += 1;
    if (VALUE_FLAGS.has(token)) index += 1;
  }
  return index;
}

function runnerProgram(program: string, rest: ReadonlyArray<string>): string {
  if (!PACKAGE_RUNNERS.has(program)) return program;
  const args = nonFlagArguments(rest);
  const first = args[0];
  if (first === undefined) return program;
  if (!RUNNER_VERBS.has(first)) return `${program} ${first}`;
  const second = args[1];
  if (second === undefined) return `${program} ${first}`;
  return `${program} ${first} ${second}`;
}

function nonFlagArguments(tokens: ReadonlyArray<string>): ReadonlyArray<string> {
  const args: string[] = [];
  let index = 0;
  while (index < tokens.length && args.length < MAX_RUNNER_ARGUMENTS) {
    const token = tokens[index] ?? "";
    index += 1;
    if (RUNNER_VALUE_FLAGS.has(token)) {
      index += 1;
      continue;
    }
    if (token.startsWith("-")) continue;
    if (ENV_ASSIGNMENT.test(token)) continue;
    args.push(token);
  }
  return args;
}

function basename(token: string): string {
  const parts = pathSegments(token);
  return parts[parts.length - 1] ?? "";
}

function singleLine(text: string): string {
  return text.replace(WHITESPACE_RUN, " ").trim();
}

function clipLine(text: string): string {
  const line = singleLine(text);
  const units = graphemes(line);
  if (units.length <= MAX_AGENT_TOOL_ROW_SUBJECT_CHARS) return line;
  return `${units.slice(0, MAX_AGENT_TOOL_ROW_SUBJECT_CHARS - 1).join("")}${ELLIPSIS}`;
}

function graphemes(text: string): ReadonlyArray<string> {
  const segmenter = graphemeSegmenter();
  if (segmenter === null) return [...text];
  return [...segmenter.segment(text)].map((entry) => entry.segment);
}

function graphemeSegmenter(): GraphemeSegmenter | null {
  if (cachedSegmenter !== undefined) return cachedSegmenter;
  cachedSegmenter = createGraphemeSegmenter();
  return cachedSegmenter;
}

function createGraphemeSegmenter(): GraphemeSegmenter | null {
  if (typeof Intl === "undefined") return null;
  const factory = (Intl as unknown as { readonly Segmenter?: GraphemeSegmenterFactory }).Segmenter;
  if (typeof factory !== "function") return null;
  try {
    return new factory("en", { granularity: "grapheme" });
  } catch {
    return null;
  }
}

export function unsupportedToolRowKind(kind: never): never {
  throw new TypeError(`Unsupported agent tool row kind: ${String(kind)}.`);
}
