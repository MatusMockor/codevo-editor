import { FileCode2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type SetStateAction,
} from "react";
import type { QuickOpenLocation, QuickOpenQuery } from "../../domain/quickOpenQuery";
import type { FileSearchResult } from "../../domain/workspace";
import { HighlightedText } from "../HighlightedText";
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
import "./commandPalette.css";

export interface PaletteFilesModel {
  readonly isLoading: boolean;
  readonly isTruncated: boolean;
  readonly query: string;
  readonly request: QuickOpenQuery;
  readonly results: readonly FileSearchResult[];
  readonly onChangeQuery: Dispatch<SetStateAction<string>>;
  onOpen(result: FileSearchResult, location?: QuickOpenLocation): void;
}

interface PaletteFilesPageProps extends PaletteFilesModel {
  readonly canGoBack: boolean;
  readonly groupLabel: string;
  readonly isOpen: boolean;
  onClose(): void;
  onBack(): void;
  onLocalShortcut(event: ReactKeyboardEvent<HTMLInputElement>): boolean;
}

export function PaletteFilesPage({
  canGoBack,
  groupLabel,
  isOpen,
  isLoading,
  isTruncated,
  onChangeQuery,
  onClose,
  onOpen,
  onBack,
  onLocalShortcut,
  query,
  request,
  results,
}: PaletteFilesPageProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const composingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }

    const focusInput = () => {
      const input = inputRef.current;
      if (!input) return;
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
    };

    focusInput();

    const animationFrame =
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame(focusInput)
        : undefined;
    const timeout = window.setTimeout(focusInput, 0);

    return () => {
      if (animationFrame !== undefined && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(animationFrame);
      }
      window.clearTimeout(timeout);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setActiveIndex(0);
      onChangeQuery("");
    }
  }, [isOpen, onChangeQuery]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const rowCount = results.length;
  useEffect(() => {
    setActiveIndex((current) => (rowCount === 0 ? 0 : Math.min(current, rowCount - 1)));
  }, [rowCount]);
  const safeActiveIndex = rowCount === 0 ? -1 : Math.min(activeIndex, rowCount - 1);
  const activeResult = safeActiveIndex >= 0 ? results[safeActiveIndex] : undefined;
  const openResult = useCallback(
    (result: FileSearchResult) => {
      const exactPathMatch = result.relativePath === query || result.path === query;
      if (request.kind === "fileLocation" && !exactPathMatch) {
        onOpen(result, {
          column: request.column,
          line: request.line,
        });
        return;
      }

      onOpen(result);
    },
    [onOpen, query, request],
  );
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const interceptForeignKeydown = (event: KeyboardEvent) => {
      if (event.target === inputRef.current || event.defaultPrevented) {
        return;
      }

      if (event.isComposing) {
        return;
      }

      const noTextModifier = !event.altKey && !event.ctrlKey && !event.metaKey;
      const consume = () => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        inputRef.current?.focus({ preventScroll: true });
      };

      if (event.key === "Escape") {
        consume();
        onClose();
        return;
      }

      if (event.key === "ArrowDown") {
        consume();
        setActiveIndex((current) => Math.min(current + 1, Math.max(rowCount - 1, 0)));
        return;
      }

      if (event.key === "ArrowUp") {
        consume();
        setActiveIndex((current) => Math.max(current - 1, 0));
        return;
      }

      if (event.key === "Enter" && activeResult) {
        consume();
        openResult(activeResult);
        return;
      }

      if (event.key === "Backspace" && noTextModifier) {
        consume();
        onChangeQuery((current) => current.slice(0, -1));
        return;
      }

      if (event.key.length === 1 && noTextModifier) {
        consume();
        onChangeQuery((current) => `${current}${event.key}`);
      }
    };

    window.addEventListener("keydown", interceptForeignKeydown, true);

    return () => {
      window.removeEventListener("keydown", interceptForeignKeydown, true);
    };
  }, [activeResult, isOpen, onChangeQuery, onClose, openResult, rowCount]);

  if (!isOpen) {
    return null;
  }

  const listboxId = "cv-quick-open-list";
  const listVisible = results.length > 0;
  const activeId = safeActiveIndex < 0 ? null : commandItemId(listboxId, safeActiveIndex);
  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (onLocalShortcut(event)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "Backspace" && query === "" && canGoBack) {
      event.preventDefault();
      onBack();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, Math.max(rowCount - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter" && activeResult) {
      event.preventDefault();
      openResult(activeResult);
    }
  };

  return (
    <>
      <CommandInput
        activeDescendantId={activeId}
        expanded={listVisible}
        inputRef={inputRef}
        label="Search files"
        lead={canGoBack ? "back" : "search"}
        listboxId={listboxId}
        onBack={onBack}
        onChange={(value) => {
          if (!composingRef.current) onChangeQuery(value);
        }}
        onCompositionEnd={(value) => {
          composingRef.current = false;
          onChangeQuery(value);
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onKeyDown={handleInputKeyDown}
        placeholder="Search files…"
        value={query}
      />
      <CommandResultsStatus count={results.length} />
      <CommandPanel>
        {isLoading ? <div className="cv-palette-files-state">Searching…</div> : null}
        {isTruncated ? <div className="cv-palette-files-state">Results truncated</div> : null}
        {!isLoading && !isTruncated && results.length === 0 ? (
          <CommandEmpty>No matching files.</CommandEmpty>
        ) : null}
        {listVisible ? (
          <CommandList id={listboxId} label="Files">
            <CommandGroup label={groupLabel}>
              {results.map((result, index) => {
                return (
                  <CommandItem
                    active={index === safeActiveIndex}
                    description={
                      <HighlightedText
                        className="cv-palette-file-match"
                        query={query}
                        text={result.relativePath}
                      />
                    }
                    hint={result.path}
                    icon={<FileCode2 size={16} />}
                    id={commandItemId(listboxId, index)}
                    key={result.path}
                    onHover={() => setActiveIndex(index)}
                    onSelect={() => openResult(result)}
                    title={
                      <HighlightedText
                        className="cv-palette-file-match"
                        query={query}
                        text={result.name}
                      />
                    }
                  />
                );
              })}
            </CommandGroup>
          </CommandList>
        ) : null}
      </CommandPanel>
      <CommandFooter
        end={
          <span
            aria-label="Go to file syntax: path colon line"
            className="cv-palette-files-syntax"
            role="note"
          >
            path:line
          </span>
        }
      >
        <CommandFooterHint keys={["↑", "↓"]} label="Navigate" />
        <CommandFooterHint keys={["Enter"]} label="Open file" />
        {canGoBack ? <CommandFooterHint keys={["Backspace"]} label="Back" /> : null}
        <CommandFooterHint keys={["Esc"]} label="Close" />
      </CommandFooter>
    </>
  );
}
