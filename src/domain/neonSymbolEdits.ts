import {
  detectNeonParameterReferenceAt,
  detectNeonServiceReferenceAt,
  neonParameterReferences,
  neonParametersFromSource,
  neonServiceDefinitionsFromSource,
  neonServiceReferences,
  type NeonSpan,
} from "./netteDiContainer";

export interface NeonSymbolOccurrence {
  readonly declaration: boolean;
  readonly span: NeonSpan;
}

export interface NeonSymbolIdentity {
  readonly kind: "parameter" | "service";
  readonly name: string;
}

export interface NeonSymbolTarget extends NeonSymbolIdentity {
  readonly selectedSpan: NeonSpan;
}

export interface NeonRenameEdit {
  readonly newText: string;
  readonly span: NeonSpan;
}

export interface NeonRenamePlan {
  readonly edits: readonly NeonRenameEdit[];
  readonly placeholder: string;
  readonly selectedSpan: NeonSpan;
}

export interface NeonRenameTarget {
  readonly placeholder: string;
  readonly selectedSpan: NeonSpan;
}

type NeonRenameSymbol = NeonSymbolTarget;

/** Identifies a renameable-looking symbol without requiring a declaration in this document. */
export function neonSymbolTargetAt(source: string, offset: number): NeonSymbolTarget | null {
  return renameableSymbolAt(source, offset);
}

/** Returns this document's declarations and references for an exact logical symbol. */
export function neonDocumentSymbolOccurrences(
  source: string,
  symbol: NeonSymbolIdentity,
  includeDeclaration = true,
): NeonSymbolOccurrence[] {
  const declarations = includeDeclaration ? declarationSpans(source, symbol) : [];
  return dedupeSpans([
    ...declarations.map((span) => ({ declaration: true, span })),
    ...referenceSpans(source, symbol).map((span) => ({ declaration: false, span })),
  ]);
}

export function canRenameNeonSymbolTo(symbol: NeonSymbolIdentity, newName: string): boolean {
  return (
    validName(symbol.kind, newName) &&
    (symbol.kind !== "parameter" || parentName(symbol.name) === parentName(newName))
  );
}

export function neonSymbolRenameText(
  symbol: NeonSymbolIdentity,
  occurrence: NeonSymbolOccurrence,
  newName: string,
): string {
  return occurrence.declaration && symbol.kind === "parameter"
    ? (newName.split(".").pop() ?? newName)
    : newName;
}

/** Finds conservative same-document NEON references for a declared parameter or service. */
export function neonSymbolOccurrencesAt(
  source: string,
  offset: number,
  includeDeclaration = true,
): NeonSymbolOccurrence[] {
  const symbol = renameableSymbolAt(source, offset);
  if (!symbol || declarationSpans(source, symbol).length !== 1) return [];
  return neonDocumentSymbolOccurrences(source, symbol, includeDeclaration);
}

export function neonRenameTargetAt(source: string, offset: number): NeonRenameTarget | null {
  const symbol = renameableSymbolAt(source, offset);
  if (!symbol || declarationSpans(source, symbol).length !== 1) return null;
  return { placeholder: symbol.name, selectedSpan: symbol.selectedSpan };
}

/** Plans an atomic same-document rename; ambiguous symbols and collisions fail closed. */
export function planNeonSymbolRename(
  source: string,
  offset: number,
  newName: string,
): NeonRenamePlan | null {
  const symbol = renameableSymbolAt(source, offset);
  if (!symbol || !canRenameNeonSymbolTo(symbol, newName)) return null;
  const declarations = declarationSpans(source, symbol);
  if (declarations.length !== 1 || hasCollision(source, symbol, newName)) return null;
  const occurrences = neonSymbolOccurrencesAt(source, offset, true);
  if (occurrences.length === 0) return null;
  return {
    edits: occurrences.map(({ declaration, span }) => ({
      newText: neonSymbolRenameText(symbol, { declaration, span }, newName),
      span,
    })),
    placeholder: symbol.name,
    selectedSpan: symbol.selectedSpan,
  };
}

function parentName(name: string): string {
  return name.split(".").slice(0, -1).join(".");
}

function renameableSymbolAt(source: string, offset: number): NeonRenameSymbol | null {
  const parameterReference = detectNeonParameterReferenceAt(source, offset);
  if (parameterReference) {
    return {
      kind: "parameter",
      name: parameterReference.name,
      selectedSpan: innerSpan(parameterReference.span, 1, 1),
    };
  }
  const serviceReference = detectNeonServiceReferenceAt(source, offset);
  if (serviceReference && !serviceReference.name.includes("\\")) {
    return {
      kind: "service",
      name: serviceReference.name,
      selectedSpan: innerSpan(serviceReference.span, 1, 0),
    };
  }
  for (const parameter of neonParametersFromSource(source)) {
    if (contains(parameter.span, offset)) {
      return { kind: "parameter", name: parameter.name, selectedSpan: parameter.span };
    }
  }
  for (const definition of neonServiceDefinitionsFromSource(source)) {
    const name = definition.service.serviceName;
    if (!name) continue;
    const span = { start: definition.service.offset, end: definition.service.offset + name.length };
    if (source.slice(span.start, span.end) === name && contains(span, offset)) {
      return { kind: "service", name, selectedSpan: span };
    }
  }
  return null;
}

function declarationSpans(source: string, symbol: NeonSymbolIdentity): NeonSpan[] {
  if (symbol.kind === "parameter") {
    return neonParametersFromSource(source)
      .filter(({ name }) => name === symbol.name)
      .map(({ span }) => span);
  }
  return neonServiceDefinitionsFromSource(source).flatMap(({ service }) => {
    if (service.serviceName !== symbol.name) return [];
    const span = { start: service.offset, end: service.offset + symbol.name.length };
    return source.slice(span.start, span.end) === symbol.name ? [span] : [];
  });
}

function referenceSpans(source: string, symbol: NeonSymbolIdentity): NeonSpan[] {
  return symbol.kind === "parameter"
    ? neonParameterReferences(source)
        .filter(({ name }) => name === symbol.name)
        .map(({ span }) => innerSpan(span, 1, 1))
    : neonServiceReferences(source)
        .filter(({ name }) => name === symbol.name)
        .map(({ span }) => innerSpan(span, 1, 0));
}

function hasCollision(source: string, symbol: NeonSymbolIdentity, newName: string): boolean {
  if (newName === symbol.name) return false;
  return symbol.kind === "parameter"
    ? neonParametersFromSource(source).some(({ name }) => name === newName)
    : neonServiceDefinitionsFromSource(source).some(
        ({ service }) => service.serviceName === newName,
      );
}

function validName(kind: NeonSymbolIdentity["kind"], name: string): boolean {
  const segment = /^[A-Za-z_][A-Za-z0-9_-]*$/;
  return (
    name.length <= 128 &&
    (kind === "parameter"
      ? name.split(".").every((part) => segment.test(part))
      : segment.test(name))
  );
}

function innerSpan(span: NeonSpan, prefix: number, suffix: number): NeonSpan {
  return { start: span.start + prefix, end: span.end - suffix };
}

function contains(span: NeonSpan, offset: number): boolean {
  return offset >= span.start && offset <= span.end;
}

function dedupeSpans(occurrences: readonly NeonSymbolOccurrence[]): NeonSymbolOccurrence[] {
  const seen = new Set<string>();
  return occurrences.filter(({ span }) => {
    const key = `${span.start}:${span.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
