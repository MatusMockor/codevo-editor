import {
  netteCreateComponentFactoryContexts,
  netteDelegatedFormFactoryInCreateComponent,
  netteFormFieldDefinitionsInCreateComponent,
  netteFormFieldDefinitionsInFactoryCreateMethod,
  netteFormFactoryCreateMethodExists,
  netteMethodParameterFormFactoryInCreateComponent,
} from "../domain/netteComponents";
import { netteAncestorComponentSources } from "./netteComponentAncestry";
import type { NetteControlDependencies } from "./netteControlContracts";
import { componentOwnerCandidatePathsForTemplate } from "./netteTemplateOwnerCandidates";

export interface NetteLatteComponentReceiverTypeContext {
  deps: NetteControlDependencies;
  isRequestedRootActive(): boolean;
  requestedRoot: string;
  templateRelativePath: string;
}

interface StaticNetteFormFieldReceiver {
  componentName: string;
  fieldName: string;
}

interface OwnerFieldTypeResult {
  componentFactoryFound: boolean;
  typeName: string | null;
}

const STATIC_CONTROL_FORM_FIELD_RECEIVER =
  /^\s*\$control\s*\[\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\1\s*\]\s*\[\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\3\s*\]\s*$/;

/**
 * Resolves the concrete receiver behind a static Nette Form field lookup.
 * Dynamic keys, deeper chains and unrecognised field builders stay unresolved.
 */
export async function resolveNetteLatteComponentReceiverType(
  context: NetteLatteComponentReceiverTypeContext,
  receiverExpression: string,
): Promise<string | null> {
  const receiver = staticNetteFormFieldReceiver(receiverExpression);

  if (!receiver || !context.templateRelativePath) {
    return null;
  }

  for (const relativePath of componentOwnerCandidatePathsForTemplate(
    context.templateRelativePath,
  )) {
    if (!context.isRequestedRootActive()) {
      return null;
    }

    const path = context.deps.joinPath(context.requestedRoot, relativePath);
    let ownerSource: string;

    try {
      ownerSource = await context.deps.readFileContent(path);
    } catch {
      if (!context.isRequestedRootActive()) {
        return null;
      }

      continue;
    }

    if (!context.isRequestedRootActive()) {
      return null;
    }

    const direct = await fieldTypeFromOwner(context, ownerSource, receiver);

    if (!context.isRequestedRootActive()) {
      return null;
    }

    if (direct.typeName || direct.componentFactoryFound) {
      return direct.typeName;
    }

    const ancestors = await netteAncestorComponentSources(
      context.deps,
      context.isRequestedRootActive,
      ownerSource,
    );

    if (!context.isRequestedRootActive()) {
      return null;
    }

    for (const ancestor of ancestors) {
      const inherited = await fieldTypeFromOwner(
        context,
        ancestor.source,
        receiver,
      );

      if (!context.isRequestedRootActive()) {
        return null;
      }

      if (inherited.typeName || inherited.componentFactoryFound) {
        return inherited.typeName;
      }
    }
  }

  return null;
}

function staticNetteFormFieldReceiver(
  receiverExpression: string,
): StaticNetteFormFieldReceiver | null {
  const match = STATIC_CONTROL_FORM_FIELD_RECEIVER.exec(receiverExpression);
  const componentName = match?.[2];
  const fieldName = match?.[4];

  if (!componentName || !fieldName) {
    return null;
  }

  return { componentName, fieldName };
}

async function fieldTypeFromOwner(
  context: NetteLatteComponentReceiverTypeContext,
  ownerSource: string,
  receiver: StaticNetteFormFieldReceiver,
): Promise<OwnerFieldTypeResult> {
  const componentFactoryFound = netteCreateComponentFactoryContexts(
    ownerSource,
  ).some((factory) => factory.componentName === receiver.componentName);

  if (!componentFactoryFound) {
    return { componentFactoryFound: false, typeName: null };
  }

  const directField = netteFormFieldDefinitionsInCreateComponent(
    ownerSource,
    receiver.componentName,
  ).find((field) => field.name === receiver.fieldName);

  if (directField) {
    return { componentFactoryFound: true, typeName: directField.controlClass };
  }

  const factoryClassName = delegatedFactoryClassName(
    ownerSource,
    receiver.componentName,
  );

  if (!factoryClassName || !context.deps.readPhpClassSource) {
    return { componentFactoryFound: true, typeName: null };
  }

  const factoryClass =
    context.deps.resolveDeclaredType(ownerSource, factoryClassName) ??
    factoryClassName;
  const factorySource = await context.deps.readPhpClassSource(factoryClass);

  if (!context.isRequestedRootActive() || !factorySource) {
    return { componentFactoryFound: true, typeName: null };
  }

  const typeName = await fieldTypeFromFactoryHierarchy(
    context,
    factorySource.source,
    factoryClass,
    receiver.fieldName,
  );

  return {
    componentFactoryFound: true,
    typeName,
  };
}

async function fieldTypeFromFactoryHierarchy(
  context: NetteLatteComponentReceiverTypeContext,
  factorySource: string,
  factoryClass: string,
  fieldName: string,
): Promise<string | null> {
  const directField = netteFormFieldDefinitionsInFactoryCreateMethod(
    factorySource,
    factoryClass,
  ).find((field) => field.name === fieldName);

  if (netteFormFactoryCreateMethodExists(factorySource, factoryClass)) {
    return directField?.controlClass ?? null;
  }

  const ancestors = await netteAncestorComponentSources(
    context.deps,
    context.isRequestedRootActive,
    factorySource,
  );

  if (!context.isRequestedRootActive()) {
    return null;
  }

  for (const ancestor of ancestors) {
    const field = netteFormFieldDefinitionsInFactoryCreateMethod(
      ancestor.source,
    ).find((definition) => definition.name === fieldName);

    if (!netteFormFactoryCreateMethodExists(ancestor.source)) {
      continue;
    }

    return field?.controlClass ?? null;
  }

  return null;
}

function delegatedFactoryClassName(
  ownerSource: string,
  componentName: string,
): string | null {
  const propertyFactory = netteDelegatedFormFactoryInCreateComponent(
    ownerSource,
    componentName,
  );

  if (propertyFactory) {
    return propertyFactory.factoryClass;
  }

  return (
    netteMethodParameterFormFactoryInCreateComponent(ownerSource, componentName)
      ?.factoryClass ?? null
  );
}
