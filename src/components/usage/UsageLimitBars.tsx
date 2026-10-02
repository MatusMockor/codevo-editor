import { TrendingUp } from "lucide-react";
import { Fragment } from "react";
import type { AgentAccountUsageWindow } from "../../domain/agentAccountUsage";
import { usageLimitBarModel, usageReadingAsOf, visibleUsageWindows } from "./usagePresentation";

export interface UsageLimitBarsProps {
  readonly compact?: boolean;
  readonly maxVisible?: number;
  readonly nowEpochMs: number;
  readonly observedAtEpochMs?: number | null;
  readonly windows: ReadonlyArray<AgentAccountUsageWindow>;
}

export function UsageLimitBars({
  compact = false,
  maxVisible = Number.POSITIVE_INFINITY,
  nowEpochMs,
  observedAtEpochMs = null,
  windows,
}: UsageLimitBarsProps) {
  const visible = visibleUsageWindows(windows, maxVisible);
  const asOf = observedAtEpochMs === null ? null : usageReadingAsOf(observedAtEpochMs, nowEpochMs);
  return (
    <div className="cv-usage-limits" data-compact={compact ? "true" : undefined}>
      {asOf === null ? null : (
        <span className="cv-usage-limits__as-of" title={asOf.title}>
          {asOf.label}
        </span>
      )}
      {visible.windows.map((window) => {
        const model = usageLimitBarModel(window, nowEpochMs, {}, asOf);
        return (
          <Fragment key={model.id}>
            <span className="cv-usage-limits__label">
              <span className="cv-usage-limits__name" title={model.label}>
                {model.label}
              </span>
              <span
                className="cv-usage-limits__value"
                data-reading={model.reading === "current" ? undefined : model.reading}
              >
                {model.usedLabel}
              </span>
            </span>
            <div
              aria-label={model.ariaLabel}
              className="cv-usage-bar"
              role="img"
              tabIndex={0}
              title={
                model.elapsedPercent === null
                  ? model.ariaLabel
                  : `${model.ariaLabel}. The line is where even spending would be.`
              }
            >
              {model.usedPercent > 0 ? (
                <span
                  className="cv-usage-bar__fill"
                  data-hot={model.hot ? "true" : undefined}
                  style={{ width: `${model.usedPercent}%` }}
                />
              ) : null}
              {model.elapsedPercent === null ? null : (
                <span className="cv-usage-bar__pace" style={{ left: `${model.elapsedPercent}%` }} />
              )}
            </div>
            <span className="cv-usage-limits__reset" title={model.resetsTitle ?? undefined}>
              {model.aheadOfPace ? (
                <TrendingUp aria-label="Ahead of pace" role="img" size={14} />
              ) : null}
              {model.resetsLabel}
            </span>
          </Fragment>
        );
      })}
      {visible.hiddenCount > 0 ? (
        <span className="cv-usage-limits__more">
          {visible.hiddenCount === 1 ? "1 more limit" : `${visible.hiddenCount} more limits`}
        </span>
      ) : null}
    </div>
  );
}
