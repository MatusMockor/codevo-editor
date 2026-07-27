import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import {
  createDebugVariablePagesState,
  debugInspectionOwnersEqual,
  type DebugInspectionOwner,
  type DebugVariablePagesState,
} from "../domain/debugVariablePages";
import { debugVariablePageOwnerPrefix } from "./debugVariablePageAuthority";

interface DebugInspectionOwnerInvalidationOptions {
  readonly requestsRef: MutableRefObject<Map<string, string>>;
  readonly pagesRef: MutableRefObject<DebugVariablePagesState>;
  readonly setPages: Dispatch<SetStateAction<DebugVariablePagesState>>;
  readonly publishRevision: () => void;
}

export function useDebugInspectionOwnerInvalidation({
  requestsRef,
  pagesRef,
  setPages,
  publishRevision,
}: DebugInspectionOwnerInvalidationOptions): (owner: DebugInspectionOwner) => void {
  return useCallback(
    (owner) => {
      if (!debugInspectionOwnersEqual(pagesRef.current.owner, owner)) return;
      const prefix = debugVariablePageOwnerPrefix(owner);
      for (const key of requestsRef.current.keys()) {
        if (key.startsWith(prefix)) requestsRef.current.delete(key);
      }
      const next = createDebugVariablePagesState(owner);
      pagesRef.current = next;
      setPages(next);
      publishRevision();
    },
    [pagesRef, publishRevision, requestsRef, setPages],
  );
}
