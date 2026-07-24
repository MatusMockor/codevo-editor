import type { JsTestRunner } from "./jsTestCommand";
import type {
  JsTestExplorerFileNode,
  JsTestExplorerSuiteNode,
  JsTestExplorerTestNode,
} from "./jsTestExplorerTree";
import {
  jsTestRunScopeForExplorerNode,
  MAX_JS_TEST_SCOPE_FULL_NAME_BYTES,
  validatedJsTestRunScope,
  type JsTestRunScope,
} from "./jsTestRunScope";
import { isWellFormedUnicode } from "./unicodeText";
import type { WorkspaceRuntimeOwner, WorkspaceRuntimeOwnerKey } from "./workspaceRuntimeOwner";

export const MAX_JS_TEST_DEBUG_PATH_BYTES = 4_096;
export const MAX_JS_TEST_DEBUG_FULL_NAME_BYTES = MAX_JS_TEST_SCOPE_FULL_NAME_BYTES;

export type JsTestDebugScope = Exclude<JsTestRunScope, { readonly kind: "all" }>;
export type JsTestDebugExplorerNode =
  JsTestExplorerFileNode | JsTestExplorerSuiteNode | JsTestExplorerTestNode;
export type JsTestDebugNameMatch = "exact" | "prefix";

/** Runner-neutral regex policy consumed identically by Jest and Vitest adapters. */
export interface JsTestDebugNamePattern {
  readonly match: JsTestDebugNameMatch;
  readonly runner: JsTestRunner;
  readonly source: string;
}

/** Pure launch intent. Runtime ownership is identity-based, never inferred from a path. */
export interface JsTestDebugTarget {
  readonly executionRoot: string;
  readonly namePattern: JsTestDebugNamePattern | null;
  readonly ownerKey: WorkspaceRuntimeOwnerKey;
  readonly runner: JsTestRunner;
  readonly scope: JsTestDebugScope;
}

export function jsTestDebugScopeForExplorerNode(
  rootPath: string,
  node: JsTestDebugExplorerNode,
): JsTestDebugScope {
  return validatedJsTestDebugScope(jsTestRunScopeForExplorerNode(rootPath, node));
}

export function validatedJsTestDebugScope(scope: JsTestDebugScope): JsTestDebugScope {
  const validated = validatedJsTestRunScope(scope);
  if (validated.kind === "all") {
    throw new TypeError("JavaScript test debug scope must select a file, suite, or test.");
  }
  requireBoundedUtf8(
    validated.relativeFilePath,
    MAX_JS_TEST_DEBUG_PATH_BYTES,
    "JavaScript test debug file path",
  );
  if (validated.kind !== "file") {
    validatedJsTestDebugFullName(validated.fullName);
  }
  return validated;
}

/** Shared admission for any runner-visible Jest/Vitest name filter. */
export function validatedJsTestDebugFullName(fullName: string): string {
  const scope = validatedJsTestRunScope({
    fullName,
    kind: "test",
    relativeFilePath: "debug-at-cursor.test.ts",
  });
  if (scope.kind !== "test") {
    throw new TypeError("JavaScript test debug full name is invalid.");
  }
  requireBoundedUtf8(
    scope.fullName,
    MAX_JS_TEST_DEBUG_FULL_NAME_BYTES,
    "JavaScript test debug full name",
  );
  return scope.fullName;
}

export function jsTestDebugNamePattern(
  scope: JsTestDebugScope,
  runner: JsTestRunner,
): JsTestDebugNamePattern | null {
  const validated = validatedJsTestDebugScope(scope);
  if (validated.kind === "file") return null;

  const match = validated.kind === "suite" || validated.nameMatch === "prefix" ? "prefix" : "exact";
  const escapedName = escapeRegularExpression(validated.fullName);
  return Object.freeze({
    match,
    runner,
    source: match === "prefix" ? `^${escapedName}(?: |$)` : `^${escapedName}$`,
  });
}

export function createJsTestDebugTarget(
  owner: WorkspaceRuntimeOwner,
  runner: JsTestRunner,
  scope: JsTestDebugScope,
): JsTestDebugTarget {
  const validated = validatedJsTestDebugScope(scope);
  return Object.freeze({
    executionRoot: owner.executionRoot,
    namePattern: jsTestDebugNamePattern(validated, runner),
    ownerKey: owner.ownerKey,
    runner,
    scope: validated,
  });
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function requireBoundedUtf8(value: string, maximumBytes: number, label: string): void {
  if (!isWellFormedUnicode(value)) {
    throw new TypeError(`${label} must contain valid Unicode text.`);
  }
  if (new TextEncoder().encode(value).byteLength > maximumBytes) {
    throw new TypeError(`${label} must be at most ${maximumBytes} UTF-8 bytes.`);
  }
}
