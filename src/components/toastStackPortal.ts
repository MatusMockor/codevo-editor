import { createContext, useContext } from "react";

export const ToastStackPortalContext = createContext<HTMLElement | null>(null);

export function useToastStackPortalTarget(): HTMLElement | null {
  return useContext(ToastStackPortalContext);
}
