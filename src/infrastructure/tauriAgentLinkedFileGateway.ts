import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  AgentOutsideTextFile,
  AgentOutsideTextFilePort,
  AgentOutsideTextFileRefusal,
} from "../application/agentOutsideLinkedFile";
import { MAX_AGENT_OUTSIDE_LINKED_FILE_BYTES } from "../domain/agentMarkdown/agentLocalFileLinkFailure";

export const READ_AGENT_LINKED_TEXT_FILE_IPC_COMMAND = "read_agent_linked_text_file" as const;
export const MAX_AGENT_LINKED_FILE_PATH_BYTES = 4_096;
export const AGENT_LINKED_FILE_RUNTIME_UNAVAILABLE =
  "Opening linked files outside the project requires the native runtime." as const;

export type InvokeAgentLinkedFileCommand = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export type AgentLinkedFileRuntimeDetector = () => boolean;

const UTF8_ENCODER = new TextEncoder();
const MAX_UTF8_BYTES_PER_UTF16_UNIT = 3;
const CONTROL_CHARACTER = /\p{Cc}/u;
const REFUSALS: ReadonlySet<string> = new Set<AgentOutsideTextFileRefusal>([
  "doesNotExist",
  "folder",
  "specialFile",
  "tooLarge",
  "notText",
  "notLocal",
  "unreadable",
  "unavailable",
  "busy",
]);

const invokeAgentLinkedFileCommand: InvokeAgentLinkedFileCommand = (command, args) =>
  invoke(command, args);

export async function invokeReadAgentLinkedTextFileIpc(
  invokeCommand: InvokeAgentLinkedFileCommand,
  path: string,
): Promise<AgentOutsideTextFile> {
  const value = await invokeCommand(READ_AGENT_LINKED_TEXT_FILE_IPC_COMMAND, {
    request: { path: absolutePath(path, "request.path") },
  });
  return linkedTextFile(value);
}

export class TauriAgentLinkedFileGateway implements AgentOutsideTextFilePort {
  constructor(
    private readonly invokeCommand: InvokeAgentLinkedFileCommand = invokeAgentLinkedFileCommand,
    private readonly isRuntimeAvailable: AgentLinkedFileRuntimeDetector = isTauri,
  ) {}

  async readOutsideTextFile(path: string): Promise<AgentOutsideTextFile> {
    if (!this.isRuntimeAvailable()) throw new Error(AGENT_LINKED_FILE_RUNTIME_UNAVAILABLE);
    return invokeReadAgentLinkedTextFileIpc(this.invokeCommand, path);
  }
}

function linkedTextFile(value: unknown): AgentOutsideTextFile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("result", "a linked text file object");
  }
  const record = value as Record<string, unknown>;
  if (record.kind !== "file") {
    exactKeys(record, ["kind"]);
    return { kind: refusal(record.kind) };
  }
  exactKeys(record, ["kind", "canonicalPath", "content"]);
  return {
    kind: "file",
    canonicalPath: absolutePath(record.canonicalPath, "result.canonicalPath"),
    content: boundedText(record.content),
  };
}

function refusal(value: unknown): AgentOutsideTextFileRefusal {
  if (typeof value !== "string" || !REFUSALS.has(value)) {
    invalid("result.kind", "a linked text file kind");
  }
  return value as AgentOutsideTextFileRefusal;
}

function boundedText(value: unknown): string {
  if (typeof value !== "string" || exceedsByteLimit(value)) {
    invalid("result.content", `text of at most ${MAX_AGENT_OUTSIDE_LINKED_FILE_BYTES} bytes`);
  }
  return value;
}

function exceedsByteLimit(value: string): boolean {
  if (value.length > MAX_AGENT_OUTSIDE_LINKED_FILE_BYTES) return true;
  if (value.length * MAX_UTF8_BYTES_PER_UTF16_UNIT <= MAX_AGENT_OUTSIDE_LINKED_FILE_BYTES) {
    return false;
  }
  return UTF8_ENCODER.encode(value).byteLength > MAX_AGENT_OUTSIDE_LINKED_FILE_BYTES;
}

function exactKeys(record: Record<string, unknown>, expected: ReadonlyArray<string>): void {
  const keys = Object.keys(record);
  if (keys.length === expected.length && expected.every((key) => keys.includes(key))) return;
  invalid("result", `exactly the fields ${expected.join(", ")}`);
}

function absolutePath(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    CONTROL_CHARACTER.test(value) ||
    UTF8_ENCODER.encode(value).byteLength > MAX_AGENT_LINKED_FILE_PATH_BYTES
  ) {
    invalid(
      path,
      `an absolute path of at most ${MAX_AGENT_LINKED_FILE_PATH_BYTES} bytes without control characters`,
    );
  }
  return value;
}

function invalid(path: string, expectation: string): never {
  throw new TypeError(`Invalid agent linked file value at ${path}: expected ${expectation}.`);
}
