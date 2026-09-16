/** Private command data. Never project instruction contents into UI state. */
export type RemoteRunnerInstructionSnapshot = Readonly<{
  version: 1;
  files: readonly Readonly<{
    scope: "global" | "project";
    path: string;
    content: string;
  }>[];
}>;
export type RemoteRunnerCollectInstructionsRequest = Readonly<{ rootPath?: string }>;

const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Closed, bounded wire format shared by the native collector and runner. */
export function isRemoteRunnerInstructionSnapshot(
  value: unknown,
): value is RemoteRunnerInstructionSnapshot {
  if (
    !record(value) ||
    Object.keys(value).some((key) => key !== "version" && key !== "files") ||
    value.version !== 1 ||
    !Array.isArray(value.files) ||
    value.files.length > 128
  )
    return false;
  let total = 0;
  const paths = new Set<string>();
  for (const file of value.files) {
    if (
      !record(file) ||
      Object.keys(file).some((key) => !["scope", "path", "content"].includes(key)) ||
      (file.scope !== "global" && file.scope !== "project") ||
      typeof file.path !== "string" ||
      !file.path ||
      !file.path.normalize("NFC").toLowerCase().endsWith(".md") ||
      bytes(file.path) > 512 ||
      /[\\:\p{Cc}]/u.test(file.path) ||
      typeof file.content !== "string" ||
      file.content.includes("\0") ||
      bytes(file.content) > 65536
    )
      return false;
    const segments = file.path.split("/");
    if (
      segments.length > 32 ||
      segments.some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          /[. ]$/.test(part) ||
          part.toLowerCase() === ".git",
      )
    )
      return false;
    const identity = `${file.scope}/${file.path.normalize("NFC").toLowerCase()}`;
    if (paths.has(identity)) return false;
    paths.add(identity);
    total += bytes(file.content);
    if (total > 524288) return false;
  }
  return true;
}
