import type {
  SymfonyConsoleCommandsResult,
  SymfonyRoutesResult,
  SymfonyServicesResult,
} from "../domain/symfonyWorkspaceIntelligence";
import {
  parseSymfonyConsoleCommandsResult,
  parseSymfonyRoutesResult,
  parseSymfonyServicesResult,
} from "../domain/symfonyWorkspaceIntelligence";

export const SYMFONY_WORKSPACE_INTELLIGENCE_IPC_COMMANDS = {
  commands: "list_symfony_console_commands",
  routes: "list_symfony_routes",
  services: "list_symfony_services",
} as const;

interface SymfonyWorkspaceIntelligenceIpcContract {
  readonly list_symfony_console_commands: {
    readonly args: { readonly workspaceId: string };
    readonly result: SymfonyConsoleCommandsResult;
  };
  readonly list_symfony_routes: {
    readonly args: { readonly workspaceId: string };
    readonly result: SymfonyRoutesResult;
  };
  readonly list_symfony_services: {
    readonly args: { readonly workspaceId: string };
    readonly result: SymfonyServicesResult;
  };
}

export type SymfonyWorkspaceIntelligenceIpcCommand = keyof SymfonyWorkspaceIntelligenceIpcContract;
export type SymfonyWorkspaceIntelligenceIpcArgs<
  Command extends SymfonyWorkspaceIntelligenceIpcCommand,
> = SymfonyWorkspaceIntelligenceIpcContract[Command]["args"];
export type SymfonyWorkspaceIntelligenceIpcResult<
  Command extends SymfonyWorkspaceIntelligenceIpcCommand,
> = SymfonyWorkspaceIntelligenceIpcContract[Command]["result"];

export type InvokeSymfonyWorkspaceIntelligenceCommand = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

const MAX_WORKSPACE_ID_BYTES = 1_024;
const UTF8_ENCODER = new TextEncoder();

export async function invokeSymfonyWorkspaceIntelligenceIpc<
  Command extends SymfonyWorkspaceIntelligenceIpcCommand,
>(
  invokeCommand: InvokeSymfonyWorkspaceIntelligenceCommand,
  command: Command,
  args: SymfonyWorkspaceIntelligenceIpcArgs<Command>,
): Promise<SymfonyWorkspaceIntelligenceIpcResult<Command>> {
  const workspaceId = validateWorkspaceId(args);
  const result = await invokeCommand(command, { workspaceId });
  return decodeSymfonyWorkspaceIntelligenceIpcResult(command, result);
}

export function decodeSymfonyWorkspaceIntelligenceIpcResult<
  Command extends SymfonyWorkspaceIntelligenceIpcCommand,
>(command: Command, value: unknown): SymfonyWorkspaceIntelligenceIpcResult<Command> {
  const result =
    command === SYMFONY_WORKSPACE_INTELLIGENCE_IPC_COMMANDS.commands
      ? parseSymfonyConsoleCommandsResult(value)
      : command === SYMFONY_WORKSPACE_INTELLIGENCE_IPC_COMMANDS.routes
        ? parseSymfonyRoutesResult(value)
        : parseSymfonyServicesResult(value);
  return result as SymfonyWorkspaceIntelligenceIpcResult<Command>;
}

function validateWorkspaceId(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid("args", "an object");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== "workspaceId") {
    return invalid("args", "exactly the workspaceId field");
  }
  const workspaceId = record.workspaceId;
  if (
    typeof workspaceId !== "string" ||
    !workspaceId.trim() ||
    workspaceId.includes("\0") ||
    UTF8_ENCODER.encode(workspaceId).byteLength > MAX_WORKSPACE_ID_BYTES
  ) {
    return invalid(
      "args.workspaceId",
      `a non-empty UTF-8 string of at most ${MAX_WORKSPACE_ID_BYTES} bytes without NUL bytes`,
    );
  }
  return workspaceId;
}

function invalid(path: string, expectation: string): never {
  throw new TypeError(
    `Invalid Symfony workspace intelligence IPC value at ${path}: expected ${expectation}.`,
  );
}
