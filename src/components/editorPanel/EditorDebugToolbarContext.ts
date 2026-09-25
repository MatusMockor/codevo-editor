import { createContext, useContext, type ReactElement } from "react";

export const EditorDebugToolbarContext = createContext<ReactElement | null>(null);

export function EditorDebugToolbarSlot(): ReactElement | null {
  return useContext(EditorDebugToolbarContext);
}
