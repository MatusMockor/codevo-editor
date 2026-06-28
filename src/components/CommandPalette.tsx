import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Command, CommandContext } from "../application/commandRegistry";
import { PaletteFooter } from "./PaletteFooter";

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
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setActiveIndex(0);
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

  // Keep the selection valid as the filtered list changes (query edits).
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!isOpen) {
    return null;
  }

  const activeCommand = filteredCommands[activeIndex];

  const runCommand = async (command: Command) => {
    if (!command.isEnabled(context)) {
      return;
    }

    try {
      await command.run();
      onClose();
    } catch (error) {
      onCommandError(error);
    }
  };

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
                return;
              }

              if (event.key === "ArrowDown") {
                event.preventDefault();
                if (filteredCommands.length === 0) {
                  return;
                }
                setActiveIndex(
                  (current) => (current + 1) % filteredCommands.length,
                );
                return;
              }

              if (event.key === "ArrowUp") {
                event.preventDefault();
                if (filteredCommands.length === 0) {
                  return;
                }
                setActiveIndex(
                  (current) =>
                    (current - 1 + filteredCommands.length) %
                    filteredCommands.length,
                );
                return;
              }

              if (event.key === "Enter" && activeCommand) {
                event.preventDefault();
                void runCommand(activeCommand);
              }
            }}
            placeholder="Run command"
            value={query}
          />
        </div>

        <div className="palette-results">
          {filteredCommands.length === 0 ? (
            <div className="quick-open-state">No matching commands</div>
          ) : null}
          {filteredCommands.map((command, index) => {
            const enabled = command.isEnabled(context);

            return (
              <button
                className={
                  index === activeIndex
                    ? "palette-command active"
                    : "palette-command"
                }
                disabled={!enabled}
                key={command.id}
                onClick={() => {
                  void runCommand(command);
                }}
                onMouseEnter={() => setActiveIndex(index)}
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

        <PaletteFooter />
      </section>
    </div>
  );
}
