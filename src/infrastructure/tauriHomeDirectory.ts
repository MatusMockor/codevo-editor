import { isTauri } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";
import type { WorkspaceHomeReference, WorkspacePathCase } from "../domain/workspaceRootEligibility";
import { detectHostWorkspacePathCase } from "./hostWorkspacePathCase";

export const MAX_HOME_DIRECTORY_PATH_BYTES = 4096;

export type HomeDirectoryReader = () => Promise<string>;
export type HomeDirectoryRuntimeDetector = () => boolean;

const UTF8_ENCODER = new TextEncoder();

export function createTauriWorkspaceHomeResolver(
  readHomeDirectory: HomeDirectoryReader = homeDir,
  isRuntimeAvailable: HomeDirectoryRuntimeDetector = isTauri,
  detectPathCase: () => WorkspacePathCase = detectHostWorkspacePathCase,
): () => Promise<WorkspaceHomeReference> {
  let cached: Promise<WorkspaceHomeReference> | null = null;
  return () => {
    if (cached !== null) return cached;
    const pending = readWorkspaceHome(readHomeDirectory, isRuntimeAvailable, detectPathCase);
    cached = pending;
    void pending.then((home) => {
      if (home.path !== null || cached !== pending) return;
      cached = null;
    });
    return pending;
  };
}

export const resolveTauriWorkspaceHome = createTauriWorkspaceHomeResolver();

async function readWorkspaceHome(
  readHomeDirectory: HomeDirectoryReader,
  isRuntimeAvailable: HomeDirectoryRuntimeDetector,
  detectPathCase: () => WorkspacePathCase,
): Promise<WorkspaceHomeReference> {
  const path = await readBoundedHomeDirectory(readHomeDirectory, isRuntimeAvailable);
  return { path, pathCase: safePathCase(detectPathCase) };
}

function safePathCase(detectPathCase: () => WorkspacePathCase): WorkspacePathCase {
  try {
    return detectPathCase();
  } catch {
    return "insensitive";
  }
}

async function readBoundedHomeDirectory(
  readHomeDirectory: HomeDirectoryReader,
  isRuntimeAvailable: HomeDirectoryRuntimeDetector,
): Promise<string | null> {
  try {
    if (!isRuntimeAvailable()) return null;
    return parseHomeDirectory(await readHomeDirectory());
  } catch {
    return null;
  }
}

function parseHomeDirectory(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.trim();
  if (path === "" || path.includes("\0")) return null;
  if (UTF8_ENCODER.encode(path).byteLength > MAX_HOME_DIRECTORY_PATH_BYTES) return null;
  if (!path.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(path)) return null;
  return path;
}
