import { ChevronRight } from "lucide-react";
import { Fragment, memo } from "react";
import type { LanguageServerDocumentSymbol } from "../domain/languageServerFeatures";

interface BreadcrumbsProps {
  fileName: string;
  path: LanguageServerDocumentSymbol[];
  onNavigate(symbol: LanguageServerDocumentSymbol): void;
}

function BreadcrumbsComponent({ fileName, path, onNavigate }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumbs" className="breadcrumbs">
      <span className="breadcrumb-segment breadcrumb-file">{fileName}</span>
      {path.map((symbol, index) => (
        <Fragment key={`${index}:${symbol.name}`}>
          <ChevronRight
            aria-hidden="true"
            className="breadcrumb-separator"
            size={12}
          />
          <button
            className="breadcrumb-segment breadcrumb-symbol"
            onClick={() => onNavigate(symbol)}
            type="button"
          >
            {symbol.name}
          </button>
        </Fragment>
      ))}
    </nav>
  );
}

// Memoised so a re-render of the editor surface (e.g. a cursor move that does not
// change the breadcrumb path) does not re-render the bar. The parent hands a
// stable memoised `path` and the `onNavigate` reference only changes when the
// editor instance does, so the shallow compare holds across cursor moves.
export const Breadcrumbs = memo(BreadcrumbsComponent);
