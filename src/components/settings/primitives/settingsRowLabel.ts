import { createContext, useContext } from "react";

export interface SettingsRowLabelIds {
  readonly titleId: string;
  readonly descriptionId: string | null;
}

export const SettingsRowLabelContext = createContext<SettingsRowLabelIds | null>(null);

export interface SettingsControlAria {
  readonly "aria-label"?: string;
  readonly "aria-labelledby"?: string;
  readonly "aria-describedby"?: string;
}

export function useSettingsControlAria(label?: string): SettingsControlAria {
  const ids = useContext(SettingsRowLabelContext);

  if (label !== undefined) {
    return { "aria-label": label };
  }

  if (ids === null) {
    return {};
  }

  if (ids.descriptionId === null) {
    return { "aria-labelledby": ids.titleId };
  }

  return { "aria-labelledby": ids.titleId, "aria-describedby": ids.descriptionId };
}
