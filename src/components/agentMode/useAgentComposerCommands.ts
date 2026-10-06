import { useMemo, useState, type KeyboardEvent } from "react";
import {
  useAgentCommandCatalog,
  type AgentCommandCatalogAttention,
  type AgentCommandCatalogScope,
} from "../../application/useAgentCommandCatalog";
import {
  agentComposerCommandToken,
  agentComposerCommands,
  agentComposerInsertion,
  agentComposerMenuItemKey,
  type AgentComposerCommandId,
  type AgentComposerMenuItem,
} from "../../domain/agentComposerCommand";
import {
  EMPTY_AGENT_COMPOSER_MENU_VIEW,
  agentComposerMenu,
  agentComposerMenuNotice,
  rankAgentComposerMenu,
} from "../../domain/agentComposerCommandMenu";
import type { AgentCliKind } from "../../domain/agentTask";
import type { AgentCommandCatalogServerProject } from "../../domain/agentCommandCatalogTarget";
import {
  useAgentCommandCatalogProject,
  useAgentCommandCatalogStore,
} from "./useAgentCommandCatalogStore";

interface Options {
  readonly prompt: string;
  readonly provider: AgentCliKind;
  readonly followUp: boolean;
  readonly executionServerId: string | null;
  readonly repositoryRoot: string | null;
  onChoose(command: AgentComposerCommandId, submit: boolean): void;
  onInsert(prompt: string): void;
}

export function agentComposerCommandOptionId(item: AgentComposerMenuItem): string {
  return `agent-composer-command-${agentComposerMenuItemKey(item)}`;
}

export function useAgentComposerCommands({
  prompt,
  provider,
  followUp,
  executionServerId,
  repositoryRoot,
  onChoose,
  onInsert,
}: Options) {
  const [focused, setFocused] = useState(false);
  const [atEnd, setAtEnd] = useState(true);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [selection, setSelection] = useState({ query: "", index: 0 });
  const token = useMemo(() => agentComposerCommandToken(prompt), [prompt]);
  const query = token?.query ?? null;
  const catalog = useAgentCommandCatalog(
    useAgentCommandCatalogStore(),
    catalogScope(executionServerId, repositoryRoot, useAgentCommandCatalogProject(), provider),
    catalogAttention(focused, token !== null),
  );
  const commands = useMemo(() => agentComposerCommands(provider, followUp), [provider, followUp]);
  const menu = useMemo(
    () => agentComposerMenu(provider, followUp, catalog),
    [provider, followUp, catalog],
  );
  const view = useMemo(
    () => (token === null ? EMPTY_AGENT_COMPOSER_MENU_VIEW : rankAgentComposerMenu(menu, token)),
    [menu, token],
  );
  const rows = view.rows;
  const activeIndex = Math.min(selection.query === query ? selection.index : 0, rows.length - 1);
  const open = focused && atEnd && query !== null && dismissed !== prompt && rows.length > 0;
  const exactCommand =
    query === null ? null : (commands.find((command) => command.id === query)?.id ?? null);
  const close = () => setDismissed(prompt);
  const choose = (item: AgentComposerMenuItem) => {
    if (item.kind === "builtin") {
      setDismissed(item.id === "compact" ? "/compact " : prompt);
      onChoose(item.id, false);
      return;
    }
    onInsert(agentComposerInsertion(item));
  };
  const interceptSubmit = (): boolean => {
    if (exactCommand === null) return false;
    close();
    onChoose(exactCommand, true);
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
    choose(selected);
    return true;
  };
  const active = open ? rows[activeIndex] : undefined;
  return {
    exactCommand,
    open,
    rows,
    activeIndex,
    activeOptionId: active === undefined ? undefined : agentComposerCommandOptionId(active),
    notice: agentComposerMenuNotice(view),
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

function catalogScope(
  executionServerId: string | null,
  repositoryRoot: string | null,
  project: AgentCommandCatalogServerProject | null,
  provider: AgentCliKind,
): AgentCommandCatalogScope {
  if (executionServerId === null) return { kind: "local", repositoryRoot, provider };
  return { kind: "server", serverId: executionServerId, project, provider };
}

function catalogAttention(focused: boolean, slashing: boolean): AgentCommandCatalogAttention {
  if (!focused) return "mounted";
  if (slashing) return "menu";
  return "focused";
}
