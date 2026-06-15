import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Command, CommandContext } from "../application/commandRegistry";

interface CommandPaletteProps {
  commands: Command[];
  context: CommandContext;
  isOpen: boolean;
  onClose(): void;
  onCommandError(error: unknown): void;
}

export function CommandPalette({
  commands,
  context,
  isOpen,
  onCommandError,
  onClose,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
    }
  }, [isOpen]);

  const filteredCommands = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return commands;
    }

    return commands.filter((command) => {
      const haystack = `${command.category} ${command.title} ${command.id}`;
      return haystack.toLowerCase().includes(normalizedQuery);
    });
  }, [commands, query]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="Command palette"
        className="command-palette"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-search">
          <Search aria-hidden="true" size={17} />
          <input
            autoFocus
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                onClose();
              }
            }}
            placeholder="Run command"
            value={query}
          />
        </div>

        <div className="palette-results">
          {filteredCommands.map((command) => {
            const enabled = command.isEnabled(context);

            return (
              <button
                className="palette-command"
                disabled={!enabled}
                key={command.id}
                onClick={async () => {
                  if (!enabled) {
                    return;
                  }

                  try {
                    await command.run();
                    onClose();
                  } catch (error) {
                    onCommandError(error);
                  }
                }}
                type="button"
              >
                <span>
                  <strong>{command.title}</strong>
                  <small>{command.category}</small>
                </span>
                {command.shortcut ? <kbd>{command.shortcut}</kbd> : null}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
