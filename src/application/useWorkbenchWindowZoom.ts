import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import type { AppSettings } from "../domain/settings";
import { transitionWindowZoomLevel, type WindowZoomAction } from "../domain/windowZoom";
import { WindowZoomApplication } from "./windowZoomApplication";
import type { WindowZoomGateway } from "./windowZoomGateway";

export interface WindowZoomActions {
  readonly zoomIn: () => Promise<void> | undefined;
  readonly zoomOut: () => Promise<void> | undefined;
  readonly zoomReset: () => Promise<void> | undefined;
}

interface Options {
  readonly appSettingsRef: MutableRefObject<AppSettings>;
  readonly level: number;
  readonly gateway?: WindowZoomGateway;
  readonly persistAppSettings: (settings: AppSettings) => Promise<void>;
  readonly reportError: (source: string, error: unknown) => void;
}

export function useWorkbenchWindowZoom({
  appSettingsRef,
  level,
  gateway,
  persistAppSettings,
  reportError,
}: Options): WindowZoomActions {
  const applicationRef = useRef<WindowZoomApplication | null>(null);
  useEffect(() => {
    if (!gateway) return;
    const application = new WindowZoomApplication(gateway, (error) => reportError("Zoom", error));
    applicationRef.current = application;
    return () => {
      application.dispose();
      applicationRef.current = null;
    };
  }, [gateway, reportError]);

  useEffect(() => {
    applicationRef.current?.applyLevel(level);
  }, [gateway, level, reportError]);

  const change = useCallback(
    (action: WindowZoomAction) => {
      const settings = appSettingsRef.current;
      const windowZoomLevel = transitionWindowZoomLevel(settings.windowZoomLevel, action);
      if (windowZoomLevel === settings.windowZoomLevel) return;
      return persistAppSettings({ ...settings, windowZoomLevel });
    },
    [appSettingsRef, persistAppSettings],
  );

  return useMemo(
    () => ({
      zoomIn: () => change("in"),
      zoomOut: () => change("out"),
      zoomReset: () => change("reset"),
    }),
    [change],
  );
}
