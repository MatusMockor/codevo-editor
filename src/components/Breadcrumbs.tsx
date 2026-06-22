import { ChevronRight } from "lucide-react";
import { Fragment } from "react";
import type { LanguageServerDocumentSymbol } from "../domain/languageServerFeatures";

interface BreadcrumbsProps {
  fileName: string;
  path: LanguageServerDocumentSymbol[];
  onNavigate(symbol: LanguageServerDocumentSymbol): void;
}

export function Breadcrumbs({ fileName, path, onNavigate }: BreadcrumbsProps) {
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
