import { useState, type ReactNode } from "react";
import { Button } from "../../ui/foundation/Button";
import { AgentProviderGlyph } from "../agentMode/AgentProviderGlyph";
import {
  USAGE_PROJECT_ROWS_VISIBLE,
  usageCostCell,
  usageDurationCell,
  usageTokensCell,
  usageTurnsCell,
  type UsageBreakdownRow,
} from "./usageActivityPresentation";

const COLUMNS = ["Turns", "Tokens", "Time", "Cost"] as const;

export function UsageBreakdownTable({
  projectRows,
  providerRows,
}: {
  readonly projectRows: ReadonlyArray<UsageBreakdownRow>;
  readonly providerRows: ReadonlyArray<UsageBreakdownRow>;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? projectRows : projectRows.slice(0, USAGE_PROJECT_ROWS_VISIBLE);
  const hidden = projectRows.length - visible.length;
  return (
    <div className="cv-usage-breakdown">
      <div aria-label="Local activity breakdown" className="cv-usage-breakdown__table" role="table">
        <BreakdownGroup heading="By provider" rows={providerRows} />
        {projectRows.length === 0 ? null : (
          <BreakdownGroup heading="By project" rows={visible}>
            {hidden <= 0 ? null : (
              <div className="cv-usage-breakdown__row cv-usage-breakdown__more" role="row">
                <div role="cell">
                  <Button onClick={() => setExpanded(true)} size="sm" variant="ghost">
                    {`Show ${hidden} more ${hidden === 1 ? "project" : "projects"}`}
                  </Button>
                </div>
              </div>
            )}
          </BreakdownGroup>
        )}
      </div>
    </div>
  );
}

function BreakdownGroup({
  children,
  heading,
  rows,
}: {
  readonly children?: ReactNode;
  readonly heading: string;
  readonly rows: ReadonlyArray<UsageBreakdownRow>;
}) {
  return (
    <div aria-label={heading} className="cv-usage-breakdown__group" role="rowgroup">
      <div className="cv-usage-breakdown__row cv-usage-breakdown__head" role="row">
        <span className="cv-usage-breakdown__name" role="columnheader">
          {heading}
        </span>
        {COLUMNS.map((column) => (
          <span className="cv-usage-breakdown__cell" key={column} role="columnheader">
            {column}
          </span>
        ))}
      </div>
      {rows.map((row) => (
        <BreakdownRow key={row.key} row={row} />
      ))}
      {children}
    </div>
  );
}

function BreakdownRow({ row }: { readonly row: UsageBreakdownRow }) {
  return (
    <div className="cv-usage-breakdown__row" role="row">
      <span className="cv-usage-breakdown__name" role="rowheader">
        <AgentProviderGlyph decorative kind={row.provider} />
        <span className="cv-usage-breakdown__label" title={row.label}>
          {row.label}
        </span>
      </span>
      <span className="cv-usage-breakdown__cell" role="cell">
        {usageTurnsCell(row.turns)}
      </span>
      <span className="cv-usage-breakdown__cell" role="cell">
        {usageTokensCell(row.tokens)}
      </span>
      <span className="cv-usage-breakdown__cell" role="cell">
        {usageDurationCell(row.wallTimeMs)}
      </span>
      <span className="cv-usage-breakdown__cell" data-column="cost" role="cell">
        {usageCostCell(row.costUsd)}
      </span>
    </div>
  );
}
