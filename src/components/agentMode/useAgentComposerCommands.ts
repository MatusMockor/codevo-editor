import { useState, type KeyboardEvent } from "react";
import {
  agentComposerCommandQuery,
  agentComposerCommands,
  filterAgentComposerCommands,
  type AgentComposerCommandId,
} from "../../domain/agentComposerCommand";
import type { AgentCliKind } from "../../domain/agentTask";

interface Options {
  readonly prompt: string;
  readonly provider: AgentCliKind;
  readonly followUp: boolean;
  onChoose(command: AgentComposerCommandId, submit: boolean): void;
}

export function useAgentComposerCommands({ prompt, provider, followUp, onChoose }: Options) {
  const [focused, setFocused] = useState(false);
  const [atEnd, setAtEnd] = useState(true);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [selection, setSelection] = useState({ query: "", index: 0 });
  const query = agentComposerCommandQuery(prompt);
  const commands = agentComposerCommands(provider, followUp);
  const rows = query === null ? [] : filterAgentComposerCommands(commands, query);
  const activeIndex = Math.min(selection.query === query ? selection.index : 0, rows.length - 1);
  const open = focused && atEnd && query !== null && dismissed !== prompt && rows.length > 0;
  const close = () => setDismissed(prompt);
  const choose = (id: AgentComposerCommandId) => {
    setDismissed(id === "compact" ? "/compact " : prompt);
    onChoose(id, false);
  };
  const interceptSubmit = (): boolean => {
    if (query === null) return false;
    const exact = commands.find((command) => command.id === query);
    if (exact === undefined) return false;
    close();
    onChoose(exact.id, true);
    return true;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return false;
    if (!open) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return true;
    }
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setSelection({ query: query ?? "", index: (activeIndex + step + rows.length) % rows.length });
      return true;
    }
    if (event.key !== "Enter" && event.key !== "Tab") return false;
    const selected = rows[activeIndex];
    if (selected === undefined) return false;
    event.preventDefault();
    choose(selected.id);
    return true;
  };
  return {
    exactCommand:
      query === null ? null : (commands.find((command) => command.id === query)?.id ?? null),
    open,
    rows,
    activeIndex,
    close,
    choose,
    interceptSubmit,
    onKeyDown,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    onEdit: () => setDismissed(null),
    onSelect: (element: HTMLTextAreaElement) =>
      setAtEnd(element.selectionStart === prompt.length && element.selectionEnd === prompt.length),
  };
}
