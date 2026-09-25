import { FileCode2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type SetStateAction,
} from "react";
import type { FileSearchResult } from "../domain/workspace";
import type {
  QuickOpenLinePromptReason,
  QuickOpenLocation,
  QuickOpenQuery,
} from "../domain/quickOpenQuery";
import { HighlightedText } from "./HighlightedText";
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
} from "../ui/foundation/CommandList";
import { commandItemId } from "../ui/foundation/commandItemId";
import "./commandPalette/commandPalette.css";

const LINE_PROMPT_MESSAGES: Readonly<Record<QuickOpenLinePromptReason, string>> = {
  empty: "Type a line number to go to.",
  invalid: "Type a line number, optionally followed by :column.",
  zero: "Line and column numbers start at 1.",
};

interface QuickOpenProps {
  canGoBack: boolean;
  groupLabel: string;
  isOpen: boolean;
  isLoading: boolean;
  isTruncated: boolean;
  query: string;
  request: QuickOpenQuery;
  results: FileSearchResult[];
  onChangeQuery: Dispatch<SetStateAction<string>>;
  onClose(): void;
  onOpen(result: FileSearchResult, location?: QuickOpenLocation): void;
  onOpenCurrentFileLocation(location: QuickOpenLocation): void;
  onBack(): void;
  onLocalShortcut(event: ReactKeyboardEvent<HTMLInputElement>): boolean;
}

export function QuickOpen({
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
  onOpenCurrentFileLocation,
  query,
  request,
  results,
}: QuickOpenProps) {
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

  const currentFileLocation = useMemo(
    () =>
      request.kind === "currentFileLocation"
        ? { column: request.column, line: request.line }
        : null,
    [request],
  );
  const rowCount = currentFileLocation ? 1 : results.length;
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
  const openCurrentFileLocation = useCallback(() => {
    if (!currentFileLocation) {
      return;
    }

    onClose();
    onOpenCurrentFileLocation(currentFileLocation);
  }, [currentFileLocation, onClose, onOpenCurrentFileLocation]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const interceptEditorKeydown = (event: KeyboardEvent) => {
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

      if (event.key === "Enter" && currentFileLocation) {
        consume();
        openCurrentFileLocation();
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

    window.addEventListener("keydown", interceptEditorKeydown, true);

    return () => {
      window.removeEventListener("keydown", interceptEditorKeydown, true);
    };
  }, [
    activeResult,
    currentFileLocation,
    isOpen,
    onChangeQuery,
    onClose,
    openCurrentFileLocation,
    openResult,
    rowCount,
  ]);

  if (!isOpen) {
    return null;
  }

  const listboxId = "cv-quick-open-list";
  const lineMode =
    request.kind === "currentFileLinePrompt" || request.kind === "currentFileLocation";
  const linePrompt =
    request.kind === "currentFileLinePrompt" ? LINE_PROMPT_MESSAGES[request.reason] : undefined;
  const listVisible = currentFileLocation !== null || results.length > 0;
  const resultCount = results.length + (currentFileLocation === null ? 0 : 1);
  const activeId = activeOptionId(listboxId, currentFileLocation !== null, safeActiveIndex);
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
    if (event.key === "Enter" && currentFileLocation) {
      event.preventDefault();
      openCurrentFileLocation();
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
        label={lineMode ? "Go to line" : "Search files"}
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
        placeholder={lineMode ? "Go to line" : "Search files…"}
        value={query}
      />
      <CommandResultsStatus count={resultCount} message={linePrompt} />
      <CommandPanel>
        {isLoading ? <div className="cv-palette-files-state">Searching…</div> : null}
        {isTruncated ? <div className="cv-palette-files-state">Results truncated</div> : null}
        {linePrompt === undefined ? null : (
          <div aria-hidden="true" className="cv-command-empty">
            {linePrompt}
          </div>
        )}
        {linePrompt === undefined &&
        !isLoading &&
        !isTruncated &&
        results.length === 0 &&
        !currentFileLocation ? (
          <CommandEmpty>No matching files.</CommandEmpty>
        ) : null}
        {listVisible ? (
          <CommandList id={listboxId} label="Files">
            <CommandGroup label={groupLabel}>
              {currentFileLocation ? (
                <CommandItem
                  active
                  description={
                    currentFileLocation.column ? `Column ${currentFileLocation.column}` : undefined
                  }
                  icon={<FileCode2 size={16} />}
                  id={commandItemId(listboxId, 0)}
                  onHover={() => undefined}
                  onSelect={openCurrentFileLocation}
                  title={`Go to line ${currentFileLocation.line}`}
                />
              ) : null}
              {results.map((result, index) => {
                const position = currentFileLocation ? index + 1 : index;
                return (
                  <CommandItem
                    active={currentFileLocation === null && index === safeActiveIndex}
                    description={
                      <HighlightedText
                        className="cv-palette-file-match"
                        query={query}
                        text={result.relativePath}
                      />
                    }
                    hint={result.path}
                    icon={<FileCode2 size={16} />}
                    id={commandItemId(listboxId, position)}
                    key={result.path}
                    onHover={() => {
                      if (currentFileLocation === null) setActiveIndex(index);
                    }}
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
            aria-label="Quick Open syntax: greater-than commands, at-sign file symbols, hash workspace symbols, path colon line and optional column"
            className="cv-palette-files-syntax"
            role="note"
          >
            &gt; commands · @ file symbols · # workspace symbols · path:line
          </span>
        }
      >
        <CommandFooterHint keys={["↑", "↓"]} label="Navigate" />
        <CommandFooterHint keys={["Enter"]} label={lineMode ? "Go to line" : "Open file"} />
        {canGoBack ? <CommandFooterHint keys={["Backspace"]} label="Back" /> : null}
        <CommandFooterHint keys={["Esc"]} label="Close" />
      </CommandFooter>
    </>
  );
}

function activeOptionId(listboxId: string, hasLocation: boolean, index: number): string | null {
  if (hasLocation) return commandItemId(listboxId, 0);
  if (index < 0) return null;
  return commandItemId(listboxId, index);
}
