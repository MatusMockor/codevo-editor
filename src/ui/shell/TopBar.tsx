import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../foundation/classNames";
import "./shell.css";

export type TopBarRegion = "sidebar" | "main" | "panel";

export interface TopBarProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children" | "className" | "aria-label"
> {
  readonly region: TopBarRegion;
  readonly label: string;
  readonly windowEdge?: boolean;
  readonly leading?: ReactNode;
  readonly actions?: ReactNode;
  readonly trailing?: ReactNode;
  readonly className?: string;
  readonly children?: ReactNode;
}

export function TopBar({
  actions,
  children,
  className,
  label,
  leading,
  region,
  trailing,
  windowEdge = false,
  ...rest
}: TopBarProps) {
  return (
    <header
      {...rest}
      aria-label={label}
      className={cx(
        "cv-topbar",
        `cv-topbar--${region}`,
        windowEdge && "cv-topbar--window-edge",
        className,
      )}
      data-tauri-drag-region="deep"
    >
      <TopBarSlot name="leading">{leading}</TopBarSlot>
      <div className="cv-topbar__title">{children}</div>
      <TopBarSlot name="actions">{actions}</TopBarSlot>
      <TopBarSlot name="trailing">{trailing}</TopBarSlot>
    </header>
  );
}

export function TopBarSeparator() {
  return <span aria-hidden="true" className="cv-topbar__separator" />;
}

type TopBarSlotName = "leading" | "actions" | "trailing";

function TopBarSlot({
  children,
  name,
}: {
  readonly children: ReactNode;
  readonly name: TopBarSlotName;
}) {
  if (children === undefined || children === null || children === false) return null;
  return <div className={`cv-topbar__${name}`}>{children}</div>;
}
