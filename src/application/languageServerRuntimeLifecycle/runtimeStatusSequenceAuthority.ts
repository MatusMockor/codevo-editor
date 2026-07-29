import { useCallback, useRef } from "react";
import type { WorkspaceRuntimeOwner } from "../../domain/workspaceRuntimeOwner";

export function useRuntimeStatusSequenceAuthority() {
  const sequenceRef = useRef(0);
  const statusSequence = useCallback((_owner: WorkspaceRuntimeOwner) => sequenceRef.current, []);
  const advanceStatusSequence = useCallback((_owner: WorkspaceRuntimeOwner) => {
    sequenceRef.current += 1;
    return sequenceRef.current;
  }, []);

  return { advanceStatusSequence, statusSequence };
}
