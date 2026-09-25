import { ChevronRight } from "lucide-react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import "./panels.css";

const MAX_DEPTH = 64;

export interface TreeRowProps {
  readonly label: string;
  readonly depth: number;
  readonly icon?: ReactNode;
  readonly description?: string;
  readonly expanded?: boolean;
  readonly selected?: boolean;
  readonly current?: boolean;
  readonly trailing?: ReactNode;
  onActivate(): void;
  onToggle?(expanded: boolean): void;
}

export function TreeRow({
  current = false,
  depth,
  description,
  expanded,
  icon,
  label,
  onActivate,
  onToggle,
  selected = false,
  trailing,
}: TreeRowProps) {
  const level = clampDepth(depth);
  const activate = (): void => {
    if (expanded === undefined || onToggle === undefined) {
      onActivate();
      return;
    }
    onToggle(!expanded);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate();
      return;
    }
    if (expanded === undefined || onToggle === undefined) return;
    if (event.key === "ArrowRight" && !expanded) {
      event.preventDefault();
      onToggle(true);
      return;
    }
    if (event.key === "ArrowLeft" && expanded) {
      event.preventDefault();
      onToggle(false);
    }
  };

  return (
    <div
      aria-current={current ? "true" : undefined}
      aria-expanded={expanded}
      aria-level={level + 1}
      aria-selected={selected}
      className="cv-tree-row"
      onClick={activate}
      onKeyDown={handleKeyDown}
      role="treeitem"
      style={{ "--tree-row-depth": level } as CSSProperties}
      tabIndex={selected ? 0 : -1}
    >
      <span aria-hidden="true" className="cv-tree-row__chevron">
        {expanded === undefined ? null : <ChevronRight size={14} />}
      </span>
      {icon === undefined ? null : (
        <span aria-hidden="true" className="cv-tree-row__icon">
          {icon}
        </span>
      )}
      <span className="cv-tree-row__label">{label}</span>
      {description === undefined ? null : (
        <span className="cv-tree-row__description">{description}</span>
      )}
      {trailing === undefined ? null : <span className="cv-tree-row__trailing">{trailing}</span>}
    </div>
  );
}

function clampDepth(depth: number): number {
  if (!Number.isFinite(depth)) return 0;
  return Math.min(Math.max(Math.trunc(depth), 0), MAX_DEPTH);
}
