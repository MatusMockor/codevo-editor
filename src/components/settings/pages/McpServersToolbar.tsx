import { Search, X } from "lucide-react";
import type { RefObject } from "react";
import { Button } from "../../../ui/foundation/Button";
import { McpAddServerMenu, type McpAddServerOption } from "./McpAddServer";
import {
  MCP_CLEAR_SEARCH_LABEL,
  MCP_NO_MATCH_LEAD,
  MCP_SEARCH_LABEL,
} from "./mcpServersPresentation";

interface McpServerSearchProps {
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly query: string;
  onQueryChange(query: string): void;
}

export function McpServersToolbar({
  addOptions,
  ...search
}: McpServerSearchProps & { readonly addOptions: ReadonlyArray<McpAddServerOption> }) {
  return (
    <div className="settings-group settings-mcp-field">
      <div className="settings-mcp-toolbar">
        <McpServerSearch {...search} />
        <McpAddServerMenu options={addOptions} />
      </div>
    </div>
  );
}

function McpServerSearch({ inputRef, onQueryChange, query }: McpServerSearchProps) {
  const clear = (): void => {
    onQueryChange("");
    inputRef.current?.focus();
  };
  return (
    <div className="settings-mcp-search" data-query={query === "" ? undefined : true}>
      <label className="settings-mcp-search__label">
        <Search aria-hidden="true" className="settings-mcp-search__icon" size={14} />
        <input
          aria-label={MCP_SEARCH_LABEL}
          autoComplete="off"
          className="settings-mcp-search__input"
          maxLength={256}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            if (query === "") {
              event.currentTarget.blur();
              return;
            }
            onQueryChange("");
          }}
          placeholder={MCP_SEARCH_LABEL}
          ref={inputRef}
          spellCheck={false}
          type="search"
          value={query}
        />
      </label>
      {query === "" ? null : (
        <button
          aria-label={MCP_CLEAR_SEARCH_LABEL}
          className="settings-mcp-search__clear"
          onClick={clear}
          title={MCP_CLEAR_SEARCH_LABEL}
          type="button"
        >
          <X aria-hidden="true" size={12} />
        </button>
      )}
    </div>
  );
}

export function McpServersNoMatch({ onClear, query }: { readonly query: string; onClear(): void }) {
  return (
    <div className="settings-group">
      <div className="settings-mcp-empty">
        <span role="status">
          {`${MCP_NO_MATCH_LEAD} `}
          <strong>{`“${query.trim()}”`}</strong>
        </span>
        <Button onClick={onClear} size="sm" variant="ghost">
          {MCP_CLEAR_SEARCH_LABEL}
        </Button>
      </div>
    </div>
  );
}
