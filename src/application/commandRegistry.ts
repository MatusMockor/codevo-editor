export interface CommandContext {
  hasWorkspace: boolean;
  hasActiveDocument: boolean;
  activeDocumentDirty: boolean;
}

export interface Command {
  id: string;
  title: string;
  category: string;
  shortcut?: string;
  isEnabled(context: CommandContext): boolean;
  run(): void | Promise<void>;
}

export class CommandRegistry {
  private readonly commands = new Map<string, Command>();

  register(command: Command): void {
    if (this.commands.has(command.id)) {
      throw new Error(`Command already registered: ${command.id}`);
    }

    this.commands.set(command.id, command);
  }

  list(): Command[] {
    return Array.from(this.commands.values()).sort((left, right) =>
      left.title.localeCompare(right.title),
    );
  }

  get(id: string): Command | undefined {
    return this.commands.get(id);
  }
}
