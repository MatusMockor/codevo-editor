import {
  immutableJsTestBatchPackages,
  MAX_JS_TEST_BATCH_PACKAGES,
  type JsTestBatchPackagePlan,
} from "../domain/jsTestBatch";
import type { JsTestExplorerTestDiscovery } from "../domain/jsTestExplorerTree";
import { normalizedJsTestRelativeFilePath } from "../domain/jsTestRunScope";
import type { JsTestExecutionRootResolver } from "./jsTestExecutionRootResolver";

const MAX_PLAN_FILES = 500;
const MAX_PLAN_FILE_PATH_BYTES = 2 * 1024 * 1024;
const PLAN_RESOLVE_CONCURRENCY = 4;

export type JsTestMonorepoPlan =
  | {
      readonly packages: readonly JsTestBatchPackagePlan[];
      readonly status: "available";
    }
  | {
      readonly reason:
        | "discovery-truncated"
        | "file-overflow"
        | "invalid-discovery"
        | "package-overflow"
        | "stale";
      readonly status: "unavailable";
    };

/**
 * Builds a display-layer plan only. Rust re-resolves every retained package and executable
 * authority before spawning; this immutable projection prevents UI selection drift meanwhile.
 */
export async function jsTestMonorepoPlan(options: {
  readonly discoveries: readonly JsTestExplorerTestDiscovery[];
  readonly discoveryTruncated: boolean;
  readonly filePaths?: readonly string[];
  readonly isCurrent?: () => boolean;
  readonly resolveExecutionRoot: JsTestExecutionRootResolver;
}): Promise<JsTestMonorepoPlan> {
  if (options.isCurrent?.() === false) return unavailable("stale");
  const resolveExecutionRoot =
    options.resolveExecutionRoot.forGeneration?.() ?? options.resolveExecutionRoot;
  if (options.discoveryTruncated) return unavailable("discovery-truncated");
  const files = new Set<string>();
  let retainedPathBytes = 0;
  try {
    const filePaths = options.filePaths ?? discoveryFilePaths(options.discoveries);
    for (const filePath of filePaths) {
      const normalized = normalizedJsTestRelativeFilePath(filePath);
      if (!files.has(normalized)) {
        retainedPathBytes += new TextEncoder().encode(normalized).byteLength;
        if (files.size >= MAX_PLAN_FILES || retainedPathBytes > MAX_PLAN_FILE_PATH_BYTES) {
          return unavailable("file-overflow");
        }
        files.add(normalized);
      }
    }
  } catch {
    return unavailable("invalid-discovery");
  }

  const paths = new Set<string>();
  if (files.size === 0) {
    if (options.isCurrent?.() === false) return unavailable("stale");
    const authority = await safeResolve(resolveExecutionRoot, { kind: "all" });
    if (options.isCurrent?.() === false) return unavailable("stale");
    if (!authority) return unavailable("invalid-discovery");
    paths.add(authority.packageRootRelativePath);
  } else {
    // Files in one directory necessarily share the same nearest package boundary for this
    // immutable planning generation. Resolve one representative instead of issuing hundreds
    // of duplicate IPC requests for common generated/parameterized test suites.
    const representativesByDirectory = new Map<string, string>();
    for (const relativeFilePath of [...files].sort(compareText)) {
      const separator = relativeFilePath.lastIndexOf("/");
      const directory = separator < 0 ? "" : relativeFilePath.slice(0, separator);
      if (!representativesByDirectory.has(directory)) {
        representativesByDirectory.set(directory, relativeFilePath);
      }
    }
    const representatives = [...representativesByDirectory.values()];
    for (let offset = 0; offset < representatives.length; offset += PLAN_RESOLVE_CONCURRENCY) {
      if (options.isCurrent?.() === false) return unavailable("stale");
      const authorities = await Promise.all(
        representatives.slice(offset, offset + PLAN_RESOLVE_CONCURRENCY).map((relativeFilePath) =>
          safeResolve(resolveExecutionRoot, {
            kind: "file",
            relativeFilePath,
          }),
        ),
      );
      if (options.isCurrent?.() === false) return unavailable("stale");
      if (authorities.some((authority) => authority === null)) {
        return unavailable("invalid-discovery");
      }
      for (const authority of authorities) {
        if (authority) paths.add(authority.packageRootRelativePath);
      }
      if (paths.size > MAX_JS_TEST_BATCH_PACKAGES) return unavailable("package-overflow");
    }
  }

  try {
    const packages = immutableJsTestBatchPackages(
      [...paths].sort(compareText).map((packageRootRelativePath) => ({ packageRootRelativePath })),
    );
    return Object.freeze({
      packages,
      status: "available" as const,
    });
  } catch {
    return unavailable("invalid-discovery");
  }
}

function* discoveryFilePaths(
  discoveries: readonly JsTestExplorerTestDiscovery[],
): Generator<string> {
  for (const discovery of discoveries) yield discovery.filePath;
}

async function safeResolve(
  resolver: JsTestExecutionRootResolver,
  scope: Parameters<JsTestExecutionRootResolver>[0],
) {
  try {
    return await resolver(scope);
  } catch {
    return null;
  }
}

function unavailable(reason: Extract<JsTestMonorepoPlan, { status: "unavailable" }>["reason"]) {
  return Object.freeze({ reason, status: "unavailable" as const });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
