import { createContext, useContext } from "react";
import type { AppUpdaterSurface } from "../application/useAppUpdater";

export const AppUpdaterContext = createContext<AppUpdaterSurface | null>(null);

export function useAppUpdaterSurface(): AppUpdaterSurface | null {
  return useContext(AppUpdaterContext);
}
