import { createContext } from "react";

export const DebugViewsRevealContext = createContext<(() => void) | null>(null);
