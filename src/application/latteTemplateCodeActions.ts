import { missingLatteTemplateReferenceAt } from "../domain/netteTemplateReferences";
import {
  nettePresenterMethodCodeActionsFromDiagnosticData,
} from "./nettePresenterMethodCodeActions";
import type { NettePresenterLinkDiagnosticData } from "./nettePresenterLinkDiagnostics";
import type {
  PhpCodeActionContext,
  PhpCodeActionDescriptor,
  PhpCodeActionRange,
} from "./phpCodeActionTypes";
import {
  LATTE_TEMPLATE_CACHE_TTL_MS,
  LATTE_TEMPLATE_SCAN_DIRECTORIES,
  MAX_LATTE_SCAN_DEPTH,
  MAX_LATTE_TEMPLATE_FILES,
  type LatteProviderFlowFactoryOptions,
} from "./latteProviderFlowContext";
import { latteProviderRequestContext } from "./latteProviderRequestContext";
import { listLatteTemplateRelativePaths } from "./netteTemplateDiscovery";

export async function provideLatteCodeActions(
  options: LatteProviderFlowFactoryOptions,
  source: string,
  range: PhpCodeActionRange,
  context?: PhpCodeActionContext,
): Promise<PhpCodeActionDescriptor[]> {
  const request = latteProviderRequestContext(options);

  if (!request) {
    return [];
  }

  const {
    currentTemplateRelativePath,
    deps,
    isRequestedRootActive,
    requestedRoot,
  } = request;
  const diagnosticActions = await latteDiagnosticCodeActions({
    context,
    isRequestedRootActive,
    range,
    source,
    readFileContent: deps.readFileContent,
  });

  if (!isRequestedRootActive()) {
    return [];
  }

  const templateRelativePaths = await listLatteTemplateRelativePaths({
    cache: options.caches.templateCache,
    deps,
    isRequestedRootActive,
    maxDepth: MAX_LATTE_SCAN_DEPTH,
    maxTemplates: MAX_LATTE_TEMPLATE_FILES,
    requestedRoot,
    scanDirectories: LATTE_TEMPLATE_SCAN_DIRECTORIES,
    ttlMs: LATTE_TEMPLATE_CACHE_TTL_MS,
  });

  if (!isRequestedRootActive() || templateRelativePaths.length === 0) {
    return diagnosticActions;
  }

  const missing = missingLatteTemplateReferenceAt(
    source,
    range.start,
    currentTemplateRelativePath,
    templateRelativePaths,
  );

  if (!missing) {
    return diagnosticActions;
  }

  const path = deps.joinPath(requestedRoot, missing.relativePath);
  const existing = await fileContentOrNull(deps.readFileContent, path);

  if (!isRequestedRootActive() || existing !== null) {
    return diagnosticActions;
  }

  return [
    ...diagnosticActions,
    {
      edits: [],
      isPreferred: true,
      kind: "quickfix",
      newFile: {
        content: "",
        path,
        title: "Create Latte Template",
      },
      title: `Create Latte template ${missing.name}`,
    },
  ];
}

async function latteDiagnosticCodeActions({
  context,
  isRequestedRootActive,
  range,
  source,
  readFileContent,
}: {
  context: PhpCodeActionContext | undefined;
  isRequestedRootActive(): boolean;
  range: PhpCodeActionRange;
  source: string;
  readFileContent(path: string): Promise<string>;
}): Promise<PhpCodeActionDescriptor[]> {
  const diagnostics = context?.diagnostics ?? [];
  const actions: PhpCodeActionDescriptor[] = [];

  for (const diagnostic of diagnostics) {
    if (!isRequestedRootActive()) {
      return [];
    }

    if (
      !latteCodeActionRangeIntersectsDiagnostic(
        source,
        range,
        diagnostic.range,
      )
    ) {
      continue;
    }

    const data = netteMissingPresenterMethodDiagnosticData(diagnostic.data);

    if (!data) {
      continue;
    }

    if (!diagnosticTargetStillMatches(source, diagnostic.range, data.target)) {
      continue;
    }

    const presenterSource = await fileContentOrNull(
      readFileContent,
      data.presenterPath,
    );

    if (!isRequestedRootActive()) {
      return [];
    }

    if (presenterSource === null) {
      continue;
    }

    actions.push(
      ...nettePresenterMethodCodeActionsFromDiagnosticData({
        candidateMethodNames: data.candidateMethodNames,
        presenterPath: data.presenterPath,
        presenterSource,
      }),
    );
  }

  return actions;
}

function diagnosticTargetStillMatches(
  source: string,
  range: PhpCodeActionContext["diagnostics"][number]["range"],
  target: string,
): boolean {
  const start = offsetAtLineColumn(source, {
    column: range.startColumn,
    lineNumber: range.startLineNumber,
  });
  const end = offsetAtLineColumn(source, {
    column: range.endColumn,
    lineNumber: range.endLineNumber,
  });

  return source.slice(start, end) === target;
}

function netteMissingPresenterMethodDiagnosticData(
  data: unknown,
): NettePresenterLinkDiagnosticData | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const candidate = data as Partial<NettePresenterLinkDiagnosticData>;

  if (candidate.kind !== "missing-presenter-method") {
    return null;
  }

  if (
    !Array.isArray(candidate.candidateMethodNames) ||
    typeof candidate.presenterPath !== "string" ||
    typeof candidate.target !== "string"
  ) {
    return null;
  }

  if (
    !candidate.candidateMethodNames.every(
      (methodName): methodName is string => typeof methodName === "string",
    )
  ) {
    return null;
  }

  return {
    candidateMethodNames: candidate.candidateMethodNames,
    kind: "missing-presenter-method",
    presenterPath: candidate.presenterPath,
    target: candidate.target,
  };
}

function latteCodeActionRangeIntersectsDiagnostic(
  source: string,
  range: PhpCodeActionRange,
  diagnosticRange: PhpCodeActionContext["diagnostics"][number]["range"],
): boolean {
  const start = offsetAtLineColumn(source, {
    column: diagnosticRange.startColumn,
    lineNumber: diagnosticRange.startLineNumber,
  });
  const end = offsetAtLineColumn(source, {
    column: diagnosticRange.endColumn,
    lineNumber: diagnosticRange.endLineNumber,
  });

  return range.start <= end && range.end >= start;
}

function offsetAtLineColumn(
  source: string,
  position: { column: number; lineNumber: number },
): number {
  let lineNumber = 1;
  let lineStart = 0;

  for (let index = 0; index < source.length; index += 1) {
    if (lineNumber >= position.lineNumber) {
      break;
    }

    if (source[index] !== "\n") {
      continue;
    }

    lineNumber += 1;
    lineStart = index + 1;
  }

  return Math.max(0, Math.min(source.length, lineStart + position.column - 1));
}

async function fileContentOrNull(
  readFileContent: (path: string) => Promise<string>,
  path: string,
): Promise<string | null> {
  try {
    return await readFileContent(path);
  } catch {
    return null;
  }
}
