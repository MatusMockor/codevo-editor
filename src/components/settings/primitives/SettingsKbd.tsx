import type { ReactNode } from "react";

export interface SettingsKbdProps {
  readonly children: ReactNode;
}

export function SettingsKbd({ children }: SettingsKbdProps) {
  return <kbd className="settings-kbd">{children}</kbd>;
}
