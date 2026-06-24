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
