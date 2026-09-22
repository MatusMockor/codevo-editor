export type RemoteProjectDirectory = Readonly<{ name: string; path: string }>;
export type RemoteProjectDirectories = Readonly<{
  path: string;
  parentPath: string | null;
  entries: readonly RemoteProjectDirectory[];
  truncated: boolean;
}>;

export function isRemoteProjectDirectoryPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    (value === "/" || (!value.endsWith("/") && !value.includes("//"))) &&
    new TextEncoder().encode(value).length <= 4096 &&
    !/[\u0000-\u001f\u007f-\u009f\\]/u.test(value) &&
    !value.split("/").some((part) => part === "." || part === "..")
  );
}
export function isRemoteProjectDirectories(value: unknown): value is RemoteProjectDirectories {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).length !== 4 ||
    !isRemoteProjectDirectoryPath(v.path) ||
    !(v.parentPath === null || isRemoteProjectDirectoryPath(v.parentPath)) ||
    typeof v.truncated !== "boolean" ||
    !Array.isArray(v.entries) ||
    v.entries.length > 256
  )
    return false;
  const parent = (v.path as string).slice(0, (v.path as string).lastIndexOf("/")) || "/";
  if (v.parentPath !== null && (v.path === "/" || v.parentPath !== parent)) return false;
  const bytes = (text: string) => new TextEncoder().encode(text).length;
  let totalBytes = 0;
  const names = new Set<string>();
  return v.entries.every((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const e = entry as Record<string, unknown>;
    if (
      Object.keys(e).length !== 2 ||
      typeof e.name !== "string" ||
      !e.name ||
      new TextEncoder().encode(e.name).length > 255 ||
      /[\u0000-\u001f\u007f-\u009f/\\]/u.test(e.name) ||
      [".", ".."].includes(e.name) ||
      !isRemoteProjectDirectoryPath(e.path) ||
      e.path !== `${(v.path as string).replace(/\/$/, "")}/${e.name}` ||
      names.has(e.name)
    )
      return false;
    totalBytes += bytes(e.name) + bytes(e.path);
    if (totalBytes > 128 * 1024) return false;
    names.add(e.name);
    return true;
  });
}
