import { useMemo, useRef, type FunctionComponent, type ReactElement } from "react";
import { DebugPanel, type DebugCopyValuePanelSurfaces } from "./DebugPanel";
import type { DebugSetVariableSurface } from "./debugSetVariableSurface";
import type { DebugAddToWatchVariableSurface } from "./debugAddToWatchSurface";
import type { PublicDebugPanelProps } from "./useDebugPanelProps";

export function usePrivateDebugPanelElement(
  props: PublicDebugPanelProps,
  surfaces: DebugCopyValuePanelSurfaces,
  setVariableSurface?: DebugSetVariableSurface,
  addToWatchSurface?: DebugAddToWatchVariableSurface,
): ReactElement {
  const surfacesRef = useRef(surfaces);
  surfacesRef.current = surfaces;
  const setVariableSurfaceRef = useRef(setVariableSurface);
  setVariableSurfaceRef.current = setVariableSurface;
  const addToWatchSurfaceRef = useRef(addToWatchSurface);
  addToWatchSurfaceRef.current = addToWatchSurface;
  const Boundary = useMemo<FunctionComponent<PublicDebugPanelProps>>(
    () => (publicProps) => (
      <DebugPanel
        {...publicProps}
        debugAddToWatch={addToWatchSurfaceRef.current}
        debugCopyValue={surfacesRef.current}
        debugSetVariable={setVariableSurfaceRef.current}
      />
    ),
    [],
  );
  return <Boundary {...props} />;
}
