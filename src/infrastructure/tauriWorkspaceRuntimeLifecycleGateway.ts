import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  RegisteredWorkspaceRuntimeDisposalResult,
  RegisteredWorkspaceRuntimeDisposalTarget,
  WorkspaceRuntimeLifecycleGateway,
} from "../domain/workspaceRuntimeLifecycle";

const DEFAULT_RUNTIME_COMMANDS = {
  disposeRegisteredWorkspace: "dispose_registered_workspace",
  disposeWorkspace: "dispose_workspace_root",
};

const MAX_WORKSPACE_ID_UTF8_BYTES = 1_024;
const MAX_WORKSPACE_ROOT_UTF8_BYTES = 32_768;
const MAX_WORKSPACE_CLOSE_ERRORS = 16;
const MAX_WORKSPACE_CLOSE_ERROR_UTF8_BYTES = 1_024;
const utf8Encoder = new TextEncoder();

type InvokeWorkspaceRuntimeLifecycleCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;
type RuntimeDetector = () => boolean;

const invokeWorkspaceRuntimeLifecycleCommand: InvokeWorkspaceRuntimeLifecycleCommand = (
  command,
  args,
) => invoke(command, args);

export interface TauriWorkspaceRuntimeLifecycleCommands {
  disposeRegisteredWorkspace: string;
  disposeWorkspace: string;
}

export class TauriWorkspaceRuntimeLifecycleGateway implements WorkspaceRuntimeLifecycleGateway {
  constructor(
    private readonly invokeCommand: InvokeWorkspaceRuntimeLifecycleCommand = invokeWorkspaceRuntimeLifecycleCommand,
    private readonly isRuntimeAvailable: RuntimeDetector = isTauri,
    private readonly commands: TauriWorkspaceRuntimeLifecycleCommands = DEFAULT_RUNTIME_COMMANDS,
  ) {}

  disposeWorkspace(rootPath: string): Promise<void> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve();
    }

    return this.invokeCommand(this.commands.disposeWorkspace, {
      rootPath,
    }) as Promise<void>;
  }

  async disposeRegisteredWorkspace(
    target: RegisteredWorkspaceRuntimeDisposalTarget,
  ): Promise<RegisteredWorkspaceRuntimeDisposalResult> {
    assertRegisteredWorkspaceRuntimeDisposalTarget(target);
    if (!this.isRuntimeAvailable()) {
      return { status: "closed" };
    }

    return parseRegisteredWorkspaceRuntimeDisposalResult(
      await this.invokeCommand(this.commands.disposeRegisteredWorkspace, {
        request: target,
      }),
    );
  }
}

export function parseRegisteredWorkspaceRuntimeDisposalResult(
  value: unknown,
): RegisteredWorkspaceRuntimeDisposalResult {
  const record = strictRecord(value, "workspace runtime disposal result");
  if (record.status === "closed") {
    assertExactKeys(record, ["status"], "closed workspace runtime disposal result");
    return { status: "closed" };
  }
  if (record.status !== "incomplete") {
    throw new Error("Workspace runtime disposal returned an unsupported status.");
  }
  assertExactKeys(record, ["errors", "status"], "incomplete workspace runtime disposal result");
  if (
    !Array.isArray(record.errors) ||
    record.errors.length === 0 ||
    record.errors.length > MAX_WORKSPACE_CLOSE_ERRORS
  ) {
    throw new Error("Workspace runtime disposal returned invalid bounded errors.");
  }
  const errors = record.errors.map((error) => {
    assertBoundedText(
      error,
      "Workspace runtime disposal error",
      MAX_WORKSPACE_CLOSE_ERROR_UTF8_BYTES,
    );
    return error;
  });
  return { status: "incomplete", errors };
}

function assertRegisteredWorkspaceRuntimeDisposalTarget(
  target: RegisteredWorkspaceRuntimeDisposalTarget,
): void {
  const record = strictRecord(target, "registered workspace runtime disposal target");
  assertExactKeys(
    record,
    ["admissionToken", "canonicalRootPath", "selectedRootPath", "workspaceId"],
    "registered workspace runtime disposal target",
  );
  assertBoundedText(target.workspaceId, "Workspace id", MAX_WORKSPACE_ID_UTF8_BYTES);
  if (!Number.isSafeInteger(target.admissionToken) || target.admissionToken <= 0) {
    throw new Error("Workspace admission token is invalid.");
  }
  assertBoundedText(
    target.selectedRootPath,
    "Selected workspace root",
    MAX_WORKSPACE_ROOT_UTF8_BYTES,
  );
  assertAbsoluteWorkspaceRoot(target.selectedRootPath, "Selected workspace root");
  assertBoundedText(
    target.canonicalRootPath,
    "Canonical workspace root",
    MAX_WORKSPACE_ROOT_UTF8_BYTES,
  );
  assertAbsoluteWorkspaceRoot(target.canonicalRootPath, "Canonical workspace root");
}

function assertAbsoluteWorkspaceRoot(value: string, label: string): void {
  if (!value.startsWith("/")) {
    throw new Error(`${label} must be absolute.`);
  }
}

function strictRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  record: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const keys = Object.keys(record).sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error(`Invalid ${label}.`);
  }
}

function assertBoundedText(
  value: unknown,
  label: string,
  maxUtf8Bytes: number,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\0") ||
    utf8Encoder.encode(value).byteLength > maxUtf8Bytes
  ) {
    throw new Error(`${label} is invalid or exceeds its bounded size.`);
  }
}
