import type { EditorSurfaceCommandInvocationScope } from "../domain/editorSurfaceCommand";

export interface CommandContext {
  hasWorkspace: boolean;
  hasActiveDocument: boolean;
  activeDocumentDirty: boolean;
  editorSurfaceScope?: EditorSurfaceCommandInvocationScope;
}

export interface Command {
  id: string;
  title: string;
  category: string;
  shortcut?: string;
  isEnabled(context: CommandContext): boolean;
  run(context?: CommandContext): void | Promise<void>;
}

export type CommandExecutionOutcome = "missing" | "disabled" | "executed";

export type AwaitedCommandExecutionOutcome = Exclude<
  CommandExecutionOutcome,
  "missing"
>;

export type CommandExecutionRunner = (
  id: string,
  context?: CommandContext,
) => CommandExecutionOutcome;

export type CommandErrorReporter = (error: unknown) => void;

export interface CommandLookup {
  get(id: string): Command | undefined;
}

export class CommandRegistry {
  private readonly commands = new Map<string, Command>();
  private cachedList: Command[] | null = null;

  register(command: Command): void {
    if (this.commands.has(command.id)) {
      throw new Error(`Command already registered: ${command.id}`);
    }

    this.commands.set(command.id, command);
    this.cachedList = null;
  }

  list(): Command[] {
    if (this.cachedList) {
      return this.cachedList;
    }

    this.cachedList = Array.from(this.commands.values()).sort((left, right) =>
      left.title.localeCompare(right.title),
    );

    return this.cachedList;
  }

  get(id: string): Command | undefined {
    return this.commands.get(id);
  }
}

export function executeCommand(
  commandLookup: CommandLookup,
  id: string,
  context: CommandContext,
): CommandExecutionOutcome {
  const command = commandLookup.get(id);

  if (!command) {
    return "missing";
  }

  if (!command.isEnabled(context)) {
    return "disabled";
  }

  void command.run(context);
  return "executed";
}

export function executeCommandAndReport(
  commandLookup: CommandLookup,
  id: string,
  context: CommandContext,
  reportError: CommandErrorReporter,
): CommandExecutionOutcome {
  const command = commandLookup.get(id);

  if (!command) {
    return "missing";
  }

  const reportSafely = (error: unknown): void => {
    try {
      reportError(error);
    } catch {
      return;
    }
  };

  let enabled: boolean;
  try {
    enabled = command.isEnabled(context);
  } catch (error) {
    reportSafely(error);
    return "executed";
  }

  if (!enabled) {
    return "disabled";
  }

  try {
    void Promise.resolve(command.run(context)).catch(reportSafely);
  } catch (error) {
    reportSafely(error);
  }

  return "executed";
}

export async function executeCommandAndWait(
  command: Command,
  context: CommandContext,
): Promise<AwaitedCommandExecutionOutcome> {
  if (!command.isEnabled(context)) {
    return "disabled";
  }

  await command.run(context);
  return "executed";
}
