import type { NativeWindowPort } from "./application/nativeWindowPort";
import { nativeWindowBackground } from "./domain/nativeWindowBackground";
import type { DocumentAppearance } from "./domain/startupTheme";

export async function revealStartupWindow(
  port: NativeWindowPort | null,
  appearance: DocumentAppearance,
): Promise<void> {
  if (port === null) return;
  await port.setBackgroundColor(nativeWindowBackground(appearance)).catch(() => undefined);
  await port.show().catch(() => undefined);
}
