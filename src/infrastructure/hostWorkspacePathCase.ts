import type { WorkspacePathCase } from "../domain/workspaceRootEligibility";

export interface HostPlatformDescriptor {
  readonly platform?: string;
  readonly userAgent?: string;
}

const CASE_INSENSITIVE_HOST = /mac|darwin|win/i;
const CASE_SENSITIVE_HOST = /linux|x11|freebsd|openbsd/i;

export function detectHostWorkspacePathCase(
  host: HostPlatformDescriptor | null | undefined = globalThis.navigator,
): WorkspacePathCase {
  const description = `${host?.platform ?? ""} ${host?.userAgent ?? ""}`;
  if (CASE_INSENSITIVE_HOST.test(description)) return "insensitive";
  if (CASE_SENSITIVE_HOST.test(description)) return "sensitive";
  return "insensitive";
}
