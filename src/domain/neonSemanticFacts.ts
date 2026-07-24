import {
  neonParameterReferences,
  neonParametersFromSource,
  neonServiceAliasesFromSource,
  neonServiceDefinitionsFromSource,
  neonServiceReferences,
  type NeonSpan,
} from "./netteDiContainer";

export interface NeonSemanticDeclarationFact {
  readonly name: string;
  readonly span: NeonSpan;
}

export interface NeonSemanticReferenceFact {
  readonly name: string;
  readonly span: NeonSpan;
}

export interface NeonSemanticAliasFact {
  readonly name: string;
  readonly nameSpan: NeonSpan;
  readonly targetName: string;
  readonly targetSpan: NeonSpan;
}

/** Complete semantic facts for one NEON document. */
export interface NeonSemanticDocumentFacts {
  readonly aliases: readonly NeonSemanticAliasFact[];
  readonly parameterDeclarations: readonly NeonSemanticDeclarationFact[];
  readonly parameterReferences: readonly NeonSemanticReferenceFact[];
  readonly path: string;
  readonly serviceDeclarations: readonly NeonSemanticDeclarationFact[];
  readonly serviceReferences: readonly NeonSemanticReferenceFact[];
}

/**
 * Builds source-local facts only. Whether the effective include graph is complete
 * is deliberately owned by the caller that assembles a workspace snapshot.
 */
export function neonSemanticDocumentFactsFromSource(
  path: string,
  source: string,
): NeonSemanticDocumentFacts {
  const aliases = neonServiceAliasesFromSource(source).map((alias) =>
    Object.freeze({
      name: alias.serviceName,
      nameSpan: Object.freeze({
        start: alias.offset,
        end: alias.offset + alias.serviceName.length,
      }),
      targetName: alias.targetName,
      targetSpan: Object.freeze({ ...alias.targetSpan }),
    }),
  );
  const parameterDeclarations = neonParametersFromSource(source).map(({ name, span }) =>
    frozenNamedSpan(name, span),
  );
  const parameterReferences = neonParameterReferences(source).map(({ name, span }) =>
    frozenNamedSpan(name, span),
  );
  const serviceDeclarations = neonServiceDefinitionsFromSource(source).flatMap(({ service }) => {
    const name = service.serviceName;
    return name
      ? [frozenNamedSpan(name, { start: service.offset, end: service.offset + name.length })]
      : [];
  });
  const serviceReferences = neonServiceReferences(source).map(({ name, span }) =>
    frozenNamedSpan(name, span),
  );
  return Object.freeze({
    aliases: Object.freeze(aliases),
    parameterDeclarations: Object.freeze(parameterDeclarations),
    parameterReferences: Object.freeze(parameterReferences),
    path,
    serviceDeclarations: Object.freeze(serviceDeclarations),
    serviceReferences: Object.freeze(serviceReferences),
  });
}

function frozenNamedSpan(name: string, span: NeonSpan): NeonSemanticDeclarationFact {
  return Object.freeze({ name, span: Object.freeze({ ...span }) });
}
