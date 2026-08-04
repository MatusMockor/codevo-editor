import { FileCode2, Search } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { FileSearchResult } from "../domain/workspace";
import type { QuickOpenLocation, QuickOpenQuery } from "../domain/quickOpenQuery";
import { HighlightedText } from "./HighlightedText";
import { PaletteFooter } from "./PaletteFooter";

interface QuickOpenProps {
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
}

export function QuickOpen({
  isOpen,
  isLoading,
  isTruncated,
  onChangeQuery,
  onClose,
  onOpen,
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
      inputRef.current?.focus({ preventScroll: true });
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

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="Quick open"
        className="quick-open"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-search">
          <Search aria-hidden="true" size={17} />
          <input
            aria-label="Search files"
            autoFocus
            onChange={(event) => {
              if (!composingRef.current) {
                onChangeQuery(event.currentTarget.value);
              }
            }}
            onCompositionEnd={(event) => {
              composingRef.current = false;
              onChangeQuery(event.currentTarget.value);
            }}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                onClose();
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
            }}
            placeholder="Open file"
            ref={inputRef}
            value={query}
          />
        </div>

        <div className="quick-open-results">
          {isLoading ? <div className="quick-open-state">Searching...</div> : null}
          {isTruncated ? <div className="quick-open-state">Results truncated</div> : null}
          {!isLoading && !isTruncated && results.length === 0 && !currentFileLocation ? (
            <div className="quick-open-state">No files found</div>
          ) : null}
          {currentFileLocation ? (
            <button
              className="quick-open-result active"
              onClick={openCurrentFileLocation}
              type="button"
            >
              <FileCode2 aria-hidden="true" size={16} />
              <span>
                <strong>Go to line {currentFileLocation.line}</strong>
                {currentFileLocation.column ? (
                  <small>Column {currentFileLocation.column}</small>
                ) : null}
              </span>
            </button>
          ) : null}
          {results.map((result, index) => (
            <button
              className={
                index === safeActiveIndex ? "quick-open-result active" : "quick-open-result"
              }
              key={result.path}
              onClick={() => openResult(result)}
              onMouseEnter={() => setActiveIndex(index)}
              title={result.path}
              type="button"
            >
              <FileCode2 aria-hidden="true" size={16} />
              <span>
                <strong>
                  <HighlightedText query={query} text={result.name} />
                </strong>
                <small>
                  <HighlightedText query={query} text={result.relativePath} />
                </small>
              </span>
            </button>
          ))}
        </div>

        <div
          aria-label="Quick Open syntax: greater-than commands, at-sign file symbols, hash workspace symbols, path colon line and optional column"
          className="quick-open-hint"
        >
          <kbd>&gt;</kbd> commands · <kbd>@</kbd> file symbols · <kbd>#</kbd> workspace symbols ·{" "}
          <kbd>path:line[:column]</kbd>
        </div>
        <PaletteFooter />
      </section>
    </div>
  );
}
