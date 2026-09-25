import { useContext, useMemo, useRef, type FunctionComponent, type ReactElement } from "react";
import type { DebugCopyValuePanelSurfaces, DebugPanelProps } from "../DebugPanel";
import type { DebugAddToWatchVariableSurface } from "../debugAddToWatchSurface";
import type { DebugSetVariableSurface } from "../debugSetVariableSurface";
import type { PublicDebugPanelProps } from "../useDebugPanelProps";
import { DebugConsoleHeader, DebugConsoleRegion } from "./DebugConsoleRegion";
import { DebugSectionsRegion } from "./DebugSectionsRegion";
import { DebugToolbarRegion } from "./DebugToolbarRegion";
import { DebugViewsRevealContext } from "./DebugViewsRevealContext";

export interface PrivateDebugRegions {
  readonly toolbar: ReactElement;
  readonly sections: ReactElement;
  readonly console: ReactElement;
  readonly consoleHeader: ReactElement;
}

export interface WorkbenchDebugPanels {
  readonly regions: PrivateDebugRegions;
  readonly sessionActive: boolean;
  readonly sessionId: number | null;
  readonly toolbar: ReactElement | null;
}

interface PrivateDebugSurfaces {
  readonly copyValue: DebugCopyValuePanelSurfaces;
  readonly setVariable: DebugSetVariableSurface | undefined;
  readonly addToWatch: DebugAddToWatchVariableSurface | undefined;
}

type SurfacesRef = { readonly current: PrivateDebugSurfaces };

export function usePrivateDebugRegions(
  props: PublicDebugPanelProps,
  surfaces: DebugCopyValuePanelSurfaces,
  setVariableSurface?: DebugSetVariableSurface,
  addToWatchSurface?: DebugAddToWatchVariableSurface,
): PrivateDebugRegions {
  const surfacesRef = useRef<PrivateDebugSurfaces>({
    addToWatch: addToWatchSurface,
    copyValue: surfaces,
    setVariable: setVariableSurface,
  });
  surfacesRef.current = {
    addToWatch: addToWatchSurface,
    copyValue: surfaces,
    setVariable: setVariableSurface,
  };
  const boundaries = useMemo(() => privateRegionBoundaries(surfacesRef), []);
  const toolbar = useMemo(() => <boundaries.Toolbar {...props} />, [boundaries, props]);
  return {
    console: <boundaries.Console {...props} />,
    consoleHeader: <boundaries.ConsoleHeader {...props} />,
    sections: <boundaries.Sections {...props} />,
    toolbar,
  };
}

function privateRegionBoundaries(surfacesRef: SurfacesRef) {
  const privateProps = (publicProps: PublicDebugPanelProps): DebugPanelProps => ({
    ...publicProps,
    debugAddToWatch: surfacesRef.current.addToWatch,
    debugCopyValue: surfacesRef.current.copyValue,
    debugSetVariable: surfacesRef.current.setVariable,
  });
  const Toolbar: FunctionComponent<PublicDebugPanelProps> = (publicProps) => (
    <DebugToolbarRegion {...privateProps(publicProps)} />
  );
  const Sections: FunctionComponent<PublicDebugPanelProps> = (publicProps) => (
    <DebugSectionsRegion {...privateProps(publicProps)} />
  );
  const Console: FunctionComponent<PublicDebugPanelProps> = (publicProps) => (
    <DebugConsoleRegion {...privateProps(publicProps)} />
  );
  const ConsoleHeader: FunctionComponent<PublicDebugPanelProps> = (publicProps) => (
    <DebugConsoleHeader
      {...privateProps(publicProps)}
      onShowDebugViews={useContext(DebugViewsRevealContext)}
    />
  );
  return { Console, ConsoleHeader, Sections, Toolbar };
}
