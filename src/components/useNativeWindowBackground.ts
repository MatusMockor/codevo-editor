import { useEffect } from "react";
import type { NativeWindowPort } from "../application/nativeWindowPort";
import type { PaletteId, ResolvedColorScheme } from "../domain/appearance";
import { nativeWindowBackground } from "../domain/nativeWindowBackground";

export function useNativeWindowBackground(
  port: NativeWindowPort | null,
  palette: PaletteId,
  colorScheme: ResolvedColorScheme,
): void {
  useEffect(() => {
    if (port === null) return;
    void port
      .setBackgroundColor(nativeWindowBackground({ palette, colorScheme }))
      .catch(() => undefined);
  }, [colorScheme, palette, port]);
}
