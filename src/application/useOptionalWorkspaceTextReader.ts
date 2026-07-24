import { useCallback } from "react";
import type { WorkspaceFileGateway } from "../domain/workspace";

export function useOptionalWorkspaceTextReader(gateway: WorkspaceFileGateway) {
  return useCallback(
    async (path: string): Promise<string | null> => {
      try {
        return await gateway.readTextFile(path);
      } catch {
        return null;
      }
    },
    [gateway],
  );
}
