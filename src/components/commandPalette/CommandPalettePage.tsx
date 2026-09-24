import { Check } from "lucide-react";
import { type KeyboardEvent } from "react";
import type { PaletteGroup, PaletteItem } from "../../domain/commandPalette/paletteItem";
import type { PalettePageCopy, PalettePageId } from "../../domain/commandPalette/palettePages";
import {
  CommandEmpty,
  CommandFooter,
  CommandFooterHint,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandResultsStatus,
} from "../../ui/foundation/CommandList";
import { commandItemId } from "../../ui/foundation/commandItemId";
import { useCommandListNavigation } from "../../ui/foundation/useCommandListNavigation";
import { PaletteHighlight } from "./PaletteHighlight";
import { PaletteIconView } from "./paletteIcons";
import "./commandPalette.css";

const LISTBOX_ID = "cv-command-palette-list";

export interface CommandPalettePageProps {
  readonly page: PalettePageId;
  readonly query: string;
  readonly groups: readonly PaletteGroup[];
  readonly copy: PalettePageCopy;
  readonly canGoBack: boolean;
  readonly generation: number;
  onQueryChange(query: string): void;
  onBack(): void;
  onExecute(item: PaletteItem): void;
  onLocalShortcut(event: KeyboardEvent<HTMLInputElement>): boolean;
}

export function CommandPalettePage({
  canGoBack,
  copy,
  generation,
  groups,
  onBack,
  onExecute,
  onLocalShortcut,
  onQueryChange,
  page,
  query,
}: CommandPalettePageProps) {
  const flat = groups.flatMap((group) => group.items);
  const nav = useCommandListNavigation({
    keys: flat.map((item) => item.key),
    resetKey: `${page}:${generation}:${query}`,
    homeEndEnabled: query === "",
    onExecute: (index) => {
      const item = flat[index];
      if (item === undefined || item.disabled) return;
      onExecute(item);
    },
  });
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return;
    if (onLocalShortcut(event)) return;
    if (event.key === "Backspace" && query === "" && canGoBack) {
      event.preventDefault();
      onBack();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      return;
    }
    nav.handleKeyDown(event);
  };
  let index = -1;
  return (
    <>
      <CommandInput
        activeDescendantId={nav.activeIndex < 0 ? null : commandItemId(LISTBOX_ID, nav.activeIndex)}
        expanded={flat.length > 0}
        label={copy.placeholder}
        lead={canGoBack ? "back" : "search"}
        listboxId={LISTBOX_ID}
        onBack={onBack}
        onChange={onQueryChange}
        onKeyDown={handleKeyDown}
        placeholder={copy.placeholder}
        value={query}
      />
      <CommandResultsStatus count={flat.length} />
      <CommandPanel>
        {flat.length === 0 ? (
          <CommandEmpty>{copy.empty}</CommandEmpty>
        ) : (
          <CommandList id={LISTBOX_ID} label="Results">
            {groups.map((group) => (
              <CommandGroup key={group.key} label={group.label}>
                {group.items.map((item) => {
                  index += 1;
                  const position = index;
                  return (
                    <CommandItem
                      active={position === nav.activeIndex}
                      description={
                        item.description === null ? undefined : (
                          <PaletteHighlight text={item.description} />
                        )
                      }
                      disabled={item.disabled}
                      icon={item.icon === null ? undefined : <PaletteIconView icon={item.icon} />}
                      id={commandItemId(LISTBOX_ID, position)}
                      key={item.key}
                      onHover={() => nav.setActiveIndex(position)}
                      onSelect={() => onExecute(item)}
                      shortcut={item.shortcut ?? undefined}
                      submenu={item.intent.kind === "page"}
                      timestamp={item.timestamp ?? undefined}
                      title={<PaletteHighlight text={item.title} />}
                      trailing={item.current ? <Check aria-label="Current" size={16} /> : undefined}
                    />
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        )}
      </CommandPanel>
      <CommandFooter>
        <CommandFooterHint keys={["↑", "↓"]} label="Navigate" />
        {copy.enterLabel === null ? null : (
          <CommandFooterHint keys={["Enter"]} label={copy.enterLabel} />
        )}
        {canGoBack ? <CommandFooterHint keys={["Backspace"]} label="Back" /> : null}
        <CommandFooterHint keys={["Esc"]} label="Close" />
      </CommandFooter>
    </>
  );
}
