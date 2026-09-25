import { ChevronDown, Star } from "lucide-react";
import { useState } from "react";
import {
  normalizeAgentModelFavoriteKeys,
  type AgentModelFavoriteKey,
} from "../../domain/agentSettings";
import { agentModelRowIsFavorite, type AgentModelRow } from "../agentMode/agentLaunchPresentation";

export interface AgentProviderModelsListProps {
  readonly favoriteKeys: ReadonlySet<string>;
  readonly rows: ReadonlyArray<AgentModelRow>;
  onToggleFavorite(key: AgentModelFavoriteKey): void;
}

export function AgentProviderModelsList({
  favoriteKeys,
  onToggleFavorite,
  rows,
}: AgentProviderModelsListProps) {
  const [legacyOpen, setLegacyOpen] = useState(false);
  const current = rows.filter((row) => row.isLegacy !== true && row.value !== "default");
  const legacy = rows.filter((row) => row.isLegacy === true);
  const visible = legacyOpen ? [...current, ...legacy] : current;
  const providerName = rows[0]?.providerName ?? "Provider";

  return (
    <div aria-label={`${providerName} models`} className="settings-models" role="list">
      {visible.map((row) => (
        <ModelRow
          favorite={agentModelRowIsFavorite(row, favoriteKeys)}
          key={row.favoriteKey}
          onToggleFavorite={onToggleFavorite}
          row={row}
        />
      ))}
      {legacy.length === 0 ? null : (
        <button
          aria-expanded={legacyOpen}
          className="settings-models__legacy"
          onClick={() => setLegacyOpen((open) => !open)}
          type="button"
        >
          <span className="settings-models__gutter" />
          <span>{legacyOpen ? "Hide legacy models" : `${legacy.length} legacy models`}</span>
          <span className="settings-models__spacer" />
          <ChevronDown aria-hidden="true" size={14} />
        </button>
      )}
    </div>
  );
}

function ModelRow({
  favorite,
  onToggleFavorite,
  row,
}: {
  readonly favorite: boolean;
  readonly row: AgentModelRow;
  onToggleFavorite(key: AgentModelFavoriteKey): void;
}) {
  const favoriteKey = normalizeAgentModelFavoriteKeys([row.favoriteKey])[0] ?? null;

  return (
    <div className="settings-models__row" role="listitem">
      {favoriteKey === null ? (
        <span className="settings-models__gutter" />
      ) : (
        <button
          aria-label={`Favorite ${row.label}`}
          aria-pressed={favorite}
          className="settings-models__star"
          onClick={() => onToggleFavorite(favoriteKey)}
          type="button"
        >
          <Star aria-hidden="true" size={14} />
        </button>
      )}
      <span className="settings-models__label">{row.label}</span>
      <code className="settings-models__id">{row.value}</code>
      <span className="settings-models__spacer" />
      {row.isNew ? <span className="settings-badge settings-badge--new">NEW</span> : null}
      {row.isDefault ? <span className="settings-badge">Default</span> : null}
    </div>
  );
}
