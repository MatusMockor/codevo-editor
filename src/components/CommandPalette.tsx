import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  executeCommandAndWait,
  type Command,
  type CommandContext,
} from "../application/commandRegistry";
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
  const surfaceActivationRef = useRef<object>({});
  const pendingCommandRef = useRef<object | null>(null);

  useEffect(() => {
    surfaceActivationRef.current = {};
    pendingCommandRef.current = null;

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
    if (pendingCommandRef.current) {
      return;
    }

    const surfaceActivation = surfaceActivationRef.current;
    const commandActivation = {};
    pendingCommandRef.current = commandActivation;

    try {
      const outcome = await executeCommandAndWait(command, context);

      if (
        outcome === "executed" &&
        surfaceActivationRef.current === surfaceActivation &&
        pendingCommandRef.current === commandActivation
      ) {
        onClose();
      }
    } catch (error) {
      if (
        surfaceActivationRef.current === surfaceActivation &&
        pendingCommandRef.current === commandActivation
      ) {
        onCommandError(error);
      }
    } finally {
      if (pendingCommandRef.current === commandActivation) {
        pendingCommandRef.current = null;
      }
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
