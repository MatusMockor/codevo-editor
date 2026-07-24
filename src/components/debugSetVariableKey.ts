export function isDebugSetVariableShortcut(
  key: string,
  platform = typeof navigator === "undefined" ? "" : navigator.platform,
): boolean {
  if (/Mac/i.test(platform)) return key === "Enter";
  return /(Win|Linux)/i.test(platform) && key === "F2";
}
