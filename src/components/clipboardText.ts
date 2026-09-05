export function writeClipboardText(text: string): void {
  if (typeof navigator === "undefined") return;
  const clipboard = navigator.clipboard;
  if (clipboard === undefined) return;
  void clipboard.writeText(text).catch(() => undefined);
}
