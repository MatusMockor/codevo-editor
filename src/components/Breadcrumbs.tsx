import { ChevronRight } from "lucide-react";
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { breadcrumbSiblingsAt } from "../domain/breadcrumbs";
import type { LanguageServerDocumentSymbol } from "../domain/languageServerFeatures";

interface BreadcrumbsProps {
  fileName: string;
  path: LanguageServerDocumentSymbol[];
  symbols: LanguageServerDocumentSymbol[];
  onNavigate(symbol: LanguageServerDocumentSymbol): void;
}

interface MenuPosition {
  left: number;
  top: number;
}

const VIEWPORT_PADDING = 8;

function BreadcrumbsComponent({
  fileName,
  path,
  symbols,
  onNavigate,
}: BreadcrumbsProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>({
    left: 0,
    top: 0,
  });
  const navRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const siblings =
    openIndex === null
      ? []
      : breadcrumbSiblingsAt(symbols, path, openIndex);

  const closeMenu = useCallback(() => {
    if (openIndex === null) {
      return;
    }

    const trigger = triggerRefs.current[openIndex];
    setOpenIndex(null);
    trigger?.focus();
  }, [openIndex]);

  useEffect(() => {
    setOpenIndex(null);
  }, [path, symbols]);

  const positionMenu = useCallback(() => {
    if (openIndex === null) {
      return;
    }

    const trigger = triggerRefs.current[openIndex];
    const menu = menuRef.current;

    if (!trigger || !menu) {
      return;
    }

    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const maximumLeft = Math.max(
      VIEWPORT_PADDING,
      window.innerWidth - menuRect.width - VIEWPORT_PADDING,
    );
    const maximumTop = Math.max(
      VIEWPORT_PADDING,
      window.innerHeight - menuRect.height - VIEWPORT_PADDING,
    );

    setMenuPosition({
      left: Math.max(
        VIEWPORT_PADDING,
        Math.min(triggerRect.left, maximumLeft),
      ),
      top: Math.max(
        VIEWPORT_PADDING,
        Math.min(triggerRect.bottom, maximumTop),
      ),
    });
  }, [openIndex]);

  useLayoutEffect(() => {
    if (openIndex === null) {
      return;
    }

    positionMenu();
    const currentIndex = siblings.indexOf(path[openIndex]);
    const focusIndex = currentIndex < 0 ? 0 : currentIndex;
    itemRefs.current[focusIndex]?.focus();

    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;

      if (
        navRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }

      closeMenu();
    };

    document.addEventListener("click", closeOnOutsideClick);
    window.addEventListener("resize", positionMenu);

    return () => {
      document.removeEventListener("click", closeOnOutsideClick);
      window.removeEventListener("resize", positionMenu);
    };
  }, [closeMenu, openIndex, path, positionMenu, siblings]);

  const selectSymbol = (symbol: LanguageServerDocumentSymbol) => {
    closeMenu();
    onNavigate(symbol);
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      return;
    }

    const currentIndex = itemRefs.current.findIndex(
      (item) => item === document.activeElement,
    );

    if (event.key === "Enter") {
      event.preventDefault();
      const focusedSymbol = siblings[currentIndex];

      if (focusedSymbol) {
        selectSymbol(focusedSymbol);
      }

      return;
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }

    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex =
      (currentIndex + direction + siblings.length) % siblings.length;
    itemRefs.current[nextIndex]?.focus();
  };

  const menuStyle: CSSProperties = {
    left: menuPosition.left,
    top: menuPosition.top,
  };

  return (
    <nav aria-label="Breadcrumbs" className="breadcrumbs" ref={navRef}>
      <span className="breadcrumb-segment breadcrumb-file">{fileName}</span>
      {path.map((symbol, index) => (
        <Fragment key={`${index}:${symbol.name}`}>
          <ChevronRight
            aria-hidden="true"
            className="breadcrumb-separator"
            size={12}
          />
          <button
            aria-expanded={openIndex === index}
            aria-haspopup="menu"
            className="breadcrumb-segment breadcrumb-symbol"
            onClick={() => {
              if (openIndex === index) {
                closeMenu();
                return;
              }

              setOpenIndex(index);
            }}
            ref={(element) => {
              triggerRefs.current[index] = element;
            }}
            type="button"
          >
            {symbol.name}
          </button>
        </Fragment>
      ))}
      {openIndex === null
        ? null
        : createPortal(
            <div
              className="breadcrumb-menu"
              onKeyDown={handleMenuKeyDown}
              ref={menuRef}
              role="menu"
              style={menuStyle}
            >
              {siblings.map((symbol, index) => (
                <button
                  aria-current={
                    symbol === path[openIndex] ? "true" : undefined
                  }
                  className="breadcrumb-menu-item"
                  key={`${index}:${symbol.name}`}
                  onClick={() => selectSymbol(symbol)}
                  ref={(element) => {
                    itemRefs.current[index] = element;
                  }}
                  role="menuitem"
                  tabIndex={-1}
                  type="button"
                >
                  {symbol.name}
                </button>
              ))}
            </div>,
            document.body,
          )}
    </nav>
  );
}

export const Breadcrumbs = memo(BreadcrumbsComponent);
