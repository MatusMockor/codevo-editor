import { useCallback, useRef } from "react";
import {
  forgetExternallyRemovedDocumentTombstone,
  hasExternallyRemovedDocumentTombstone,
  markExternallyRemovedDocumentTombstone,
} from "./externallyRemovedDocumentTombstones";

export function useExternallyRemovedDocumentTombstones() {
  const tombstonesByPathRef = useRef<Record<string, string>>({});
  const isExternallyRemovedDocumentPath = useCallback(
    (path: string) => hasExternallyRemovedDocumentTombstone(tombstonesByPathRef.current, path),
    [],
  );
  const markExternallyRemovedDocumentPath = useCallback((rootPath: string, path: string) => {
    markExternallyRemovedDocumentTombstone(tombstonesByPathRef.current, rootPath, path);
  }, []);
  const forgetExternallyRemovedDocumentPath = useCallback((path: string) => {
    forgetExternallyRemovedDocumentTombstone(tombstonesByPathRef.current, path);
  }, []);

  return {
    forgetExternallyRemovedDocumentPath,
    isExternallyRemovedDocumentPath,
    markExternallyRemovedDocumentPath,
    tombstonesByPathRef,
  };
}
