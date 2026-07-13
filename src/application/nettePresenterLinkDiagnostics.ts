import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import { detectLatteLinks } from "../domain/latteLinkNavigation";
import type {
  LatteLinkDetection,
  NetteLinkTarget,
} from "../domain/latteLinkNavigation";
import { canProveNettePresenterMethodAbsenceLocally } from "../domain/nettePresenterMethodAbsence";
import { phpMethodPositionInSource } from "./phpMethodPosition";

export interface NettePresenterLinkDiagnosticDependencies {
  joinPath(rootPath: string, relativePath: string): string;
  readFileContent(path: string): Promise<string>;
}

export interface NettePresenterLinkDiagnosticCapabilities {
  parsePresenterLinkTarget(target: string): NetteLinkTarget | null;
  presenterActionMethodCandidates(action: string, isSignal: boolean): string[];
  presenterClassCandidatePathsForLink(
    target: NetteLinkTarget,
    currentRelativePath: string,
  ): string[];
}

export interface NettePresenterLinkDiagnosticContext {
  currentRelativePath: string;
  deps: NettePresenterLinkDiagnosticDependencies;
  frameworkCapabilities: NettePresenterLinkDiagnosticCapabilities;
  isRequestedRootActive(): boolean;
  requestedRoot: string;
}

export interface NettePresenterLinkDiagnosticData {
  candidateMethodNames: string[];
  kind: "missing-presenter-method";
  presenterPath: string;
  target: string;
}

const NETTE_THIS_ACTION = "this";
interface DiagnosticsRunState {
  lineStarts: readonly number[];
  presenterSources: Map<string, string | null>;
}

export async function nettePresenterLinkDiagnostics(
  context: NettePresenterLinkDiagnosticContext,
  source: string,
): Promise<LanguageServerDiagnostic[]> {
  if (!context.isRequestedRootActive()) {
    return [];
  }

  const diagnostics: LanguageServerDiagnostic[] = [];
  const run: DiagnosticsRunState = {
    lineStarts: lineStartsForSource(source),
    presenterSources: new Map(),
  };

  for (const detection of detectLatteLinks(source)) {
    if (!context.isRequestedRootActive()) {
      return [];
    }

    const diagnostic = await diagnosticForDetection(
      context,
      source,
      detection,
      run,
    );

    if (!context.isRequestedRootActive()) {
      return [];
    }

    if (diagnostic) {
      diagnostics.push(diagnostic);
    }
  }

  return diagnostics;
}

async function diagnosticForDetection(
  context: NettePresenterLinkDiagnosticContext,
  source: string,
  detection: LatteLinkDetection,
  run: DiagnosticsRunState,
): Promise<LanguageServerDiagnostic | null> {
  const parsed = context.frameworkCapabilities.parsePresenterLinkTarget(
    detection.target,
  );

  if (!parsed || parsed.action === NETTE_THIS_ACTION) {
    return null;
  }

  const methodNames =
    context.frameworkCapabilities.presenterActionMethodCandidates(
      parsed.action,
      parsed.isSignal,
    );

  if (methodNames.length === 0) {
    return null;
  }

  const candidatePaths =
    context.frameworkCapabilities.presenterClassCandidatePathsForLink(
      parsed,
      context.currentRelativePath,
    );

  if (candidatePaths.length === 0) {
    return null;
  }

  for (const relativePath of candidatePaths) {
    if (!context.isRequestedRootActive()) {
      return null;
    }

    const presenterPath = context.deps.joinPath(
      context.requestedRoot,
      relativePath,
    );
    const presenterSource = await readPresenterSource(
      context,
      presenterPath,
      run,
    );

    if (!context.isRequestedRootActive()) {
      return null;
    }

    if (presenterSource === null) {
      continue;
    }

    if (
      !canProveNettePresenterMethodAbsenceLocally(presenterSource, undefined, {
        barePresenterParentPolicy: "accept",
      })
    ) {
      return null;
    }

    if (phpMethodPositionInSource(presenterSource, methodNames)) {
      return null;
    }

    return missingPresenterMethodDiagnostic(source, detection, {
      candidateMethodNames: methodNames,
      kind: "missing-presenter-method",
      presenterPath,
      target: detection.target,
    }, run.lineStarts);
  }

  return null;
}

function missingPresenterMethodDiagnostic(
  source: string,
  detection: LatteLinkDetection,
  data: NettePresenterLinkDiagnosticData,
  lineStarts: readonly number[],
): LanguageServerDiagnostic {
  const start = lineCharacterAtOffset(source, detection.targetStart, lineStarts);
  const end = lineCharacterAtOffset(source, detection.targetEnd, lineStarts);
  const methods = data.candidateMethodNames.join(" or ");

  return {
    character: start.character,
    code: "nette.missingPresenterMethod",
    data,
    endCharacter: end.character,
    endLine: end.line,
    line: start.line,
    message: `Nette presenter link ${data.target} resolves to ${data.presenterPath}, but ${methods} was not found.`,
    severity: "warning",
    source: "Nette",
  };
}

async function readPresenterSource(
  context: NettePresenterLinkDiagnosticContext,
  presenterPath: string,
  run: DiagnosticsRunState,
): Promise<string | null> {
  if (run.presenterSources.has(presenterPath)) {
    return run.presenterSources.get(presenterPath) ?? null;
  }

  try {
    const source = await context.deps.readFileContent(presenterPath);
    run.presenterSources.set(presenterPath, source);
    return source;
  } catch {
    if (!context.isRequestedRootActive()) {
      return null;
    }

    run.presenterSources.set(presenterPath, null);
    return null;
  }
}

function lineStartsForSource(source: string): readonly number[] {
  const starts = [0];

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") {
      starts.push(index + 1);
    }
  }

  return starts;
}

function lineCharacterAtOffset(
  source: string,
  offset: number,
  lineStarts: readonly number[],
): { character: number; line: number } {
  const target = Math.max(0, Math.min(offset, source.length));
  let low = 0;
  let high = lineStarts.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const lineStart = lineStarts[middle] ?? 0;

    if (lineStart <= target) {
      low = middle + 1;
      continue;
    }

    high = middle - 1;
  }

  const line = Math.max(0, high);
  const lineStart = lineStarts[line] ?? 0;

  return { character: target - lineStart, line };
}
