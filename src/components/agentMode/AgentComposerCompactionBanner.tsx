import { useId, useState } from "react";
import { Info, Minimize2, X } from "lucide-react";
import type { AgentContextCompactionOffer } from "../../domain/agentContextCompaction";

const MAX_DISMISSED_COMPACTION_KEYS = 256;

export interface AgentComposerCompactionBannerProps {
  readonly offer: AgentContextCompactionOffer | null;
  readonly available: boolean;
  readonly blocked: boolean;
  onCompact(): void;
}

export function AgentComposerCompactionBanner({
  available,
  blocked,
  offer,
  onCompact,
}: AgentComposerCompactionBannerProps) {
  const infoId = useId();
  const [dismissedKeys, setDismissedKeys] = useState<ReadonlySet<string>>(new Set());
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  if (offer === null || !available || dismissedKeys.has(offer.key)) return null;
  const expanded = expandedKey === offer.key;

  return (
    <div className="cv-composer-banner cv-composer-banner--neutral agent-compaction-offer">
      <Minimize2 aria-hidden="true" className="agent-compaction-offer__icon" size={14} />
      <div className="agent-compaction-offer__copy">
        <strong>Resume with less context</strong>
        <span>{formatContextTokens(offer.contextTokens)} tokens from earlier</span>
        <button
          type="button"
          className="agent-compaction-offer__info"
          aria-expanded={expanded}
          aria-controls={infoId}
          aria-describedby={infoId}
          onClick={() => setExpandedKey((key) => (key === offer.key ? null : offer.key))}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            setExpandedKey(null);
          }}
          aria-label="Why compact this session?"
        >
          <Info aria-hidden="true" size={14} />
        </button>
      </div>
      <button
        className="agent-compaction-offer__action cv-banner-action"
        disabled={blocked}
        onClick={onCompact}
        type="button"
      >
        Compact
      </button>
      <button
        aria-label="Keep full history"
        className="agent-compaction-offer__dismiss cv-banner-action"
        onClick={() =>
          setDismissedKeys((keys) => {
            const next = new Set(keys);
            next.add(offer.key);
            if (next.size > MAX_DISMISSED_COMPACTION_KEYS) next.delete(next.values().next().value!);
            return next;
          })
        }
        type="button"
      >
        <X aria-hidden="true" size={14} />
      </button>
      <p id={infoId} className="agent-compaction-offer__explanation" hidden={!expanded}>
        Claude manages context automatically. This large session has been idle for at least 70
        minutes, so its earlier context may no longer be cached. Compact optionally summarizes it
        before continuing; keeping the full history is also fine.
      </p>
    </div>
  );
}

function formatContextTokens(tokens: number): string {
  return tokens >= 1_000 ? `${Math.round(tokens / 1_000)}k` : String(tokens);
}
