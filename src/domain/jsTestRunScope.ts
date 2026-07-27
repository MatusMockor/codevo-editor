import type { TestRunResponse } from "./testResults";
import type { JsTestExecutionAuthority } from "./jsTestExecutionAuthority";
import type {
  JsTestExplorerFileNode,
  JsTestExplorerSuiteNode,
  JsTestExplorerTestNode,
} from "./jsTestExplorerTree";

export const MAX_JS_TEST_SCOPE_FULL_NAME_BYTES = 4_096;

export type JsTestRunScope =
  | { readonly kind: "all" }
  | { readonly kind: "file"; readonly relativeFilePath: string }
  | {
      readonly kind: "suite";
      readonly relativeFilePath: string;
      readonly fullName: string;
    }
  | {
      readonly kind: "test";
      readonly relativeFilePath: string;
      readonly fullName: string;
      readonly nameMatch?: "prefix";
    };

export interface JsTestGateway {
  run(
    rootPath: string,
    scope: JsTestRunScope,
    authority?: JsTestExecutionAuthority,
  ): Promise<TestRunResponse>;
}

export type JsTestRunnableExplorerNode =
  JsTestExplorerFileNode | JsTestExplorerSuiteNode | JsTestExplorerTestNode;

/** Canonical mapping shared by Run and Debug actions in the test explorer. */
export function jsTestRunScopeForExplorerNode(
  rootPath: string,
  node: JsTestRunnableExplorerNode,
): Exclude<JsTestRunScope, { readonly kind: "all" }> {
  const relativeFilePath = relativeTestFilePath(rootPath, node.filePath);
  if (node.kind === "file" || (node.kind === "suite" && node.suitePath.length === 0)) {
    return validatedRunnableScope({ kind: "file", relativeFilePath });
  }

  const fullName =
    node.kind === "suite" ? node.suitePath.join(" ") : [...node.suitePath, node.label].join(" ");
  return validatedRunnableScope(
    node.kind === "suite"
      ? { fullName, kind: "suite", relativeFilePath }
      : {
          fullName,
          kind: "test",
          ...(node.parameterized ? { nameMatch: "prefix" as const } : {}),
          relativeFilePath,
        },
  );
}

function validatedRunnableScope(
  scope: Exclude<JsTestRunScope, { readonly kind: "all" }>,
): Exclude<JsTestRunScope, { readonly kind: "all" }> {
  const validated = validatedJsTestRunScope(scope);
  if (validated.kind === "all") {
    throw new TypeError("Explorer nodes cannot map to the all-tests scope.");
  }
  return validated;
}

export function validatedJsTestRunScope(scope: JsTestRunScope): JsTestRunScope {
  if (!scope || typeof scope !== "object") {
    throw new Error("JavaScript test run scope must be an object.");
  }
  if (scope.kind === "all") return { kind: "all" };
  if (scope.kind !== "file" && scope.kind !== "suite" && scope.kind !== "test") {
    throw new Error("JavaScript test run scope kind is invalid.");
  }

  const relativeFilePath = normalizedJsTestRelativeFilePath(scope.relativeFilePath);
  if (scope.kind === "file") return { kind: "file", relativeFilePath };

  if (!scope.fullName || hasControlCharacter(scope.fullName)) {
    throw new Error("JavaScript test suite and test names must be non-empty and single-line.");
  }
  if (new TextEncoder().encode(scope.fullName).byteLength > MAX_JS_TEST_SCOPE_FULL_NAME_BYTES) {
    throw new Error(
      `JavaScript test suite and test names must be at most ${MAX_JS_TEST_SCOPE_FULL_NAME_BYTES} UTF-8 bytes.`,
    );
  }
  return {
    kind: scope.kind,
    relativeFilePath,
    fullName: scope.fullName,
    ...(scope.kind === "test" && scope.nameMatch === "prefix"
      ? { nameMatch: "prefix" as const }
      : {}),
  };
}

/** Canonical workspace-confined path validator shared by JS test domain models. */
export function normalizedJsTestRelativeFilePath(path: string): string {
  const normalized = path.trim().split("\\").join("/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split("/").some((segment) => !segment || segment === "." || segment === "..") ||
    hasControlCharacter(normalized)
  ) {
    throw new Error("JavaScript test file paths must stay inside the workspace.");
  }
  return normalized;
}

function hasControlCharacter(value: string): boolean {
  return /[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(value);
}

function relativeTestFilePath(rootPath: string, filePath: string): string {
  const root = normalizedPath(rootPath);
  const file = normalizedPath(filePath);
  return file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file.replace(/^\.\//, "");
}

function normalizedPath(path: string): string {
  return path
    .split("\\")
    .join("/")
    .replace(/\/{2,}/g, "/")
    .replace(/\/$/, "");
}
