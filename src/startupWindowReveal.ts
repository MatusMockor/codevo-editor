import type { NativeWindowPort } from "./application/nativeWindowPort";
import type { WindowZoomGateway } from "./application/windowZoomGateway";
import { nativeWindowBackground } from "./domain/nativeWindowBackground";
import type { DocumentAppearance } from "./domain/startupTheme";
import { windowZoomFactor } from "./domain/windowZoom";

interface StartupWindowZoom {
  readonly gateway: WindowZoomGateway;
  readonly level: number;
}

export async function revealStartupWindow(
  port: NativeWindowPort | null,
  appearance: DocumentAppearance,
  zoom?: StartupWindowZoom,
): Promise<void> {
  if (zoom) await zoom.gateway.setScale(windowZoomFactor(zoom.level)).catch(() => undefined);
  if (port === null) return;
  await port.setBackgroundColor(nativeWindowBackground(appearance)).catch(() => undefined);
  await port.show().catch(() => undefined);
}
