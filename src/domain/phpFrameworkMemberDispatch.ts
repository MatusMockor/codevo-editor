import type {
  PhpFrameworkMagicDiagnosticMatch,
  PhpFrameworkSourceContext,
} from "./phpFrameworkProviders";
import type { PhpFrameworkMemberDiagnosticPort } from "./phpFrameworkDispatchPorts";

export function isKnownPhpFrameworkStaticMethod(
  source: string,
  className: string,
  methodName: string,
  providers: readonly PhpFrameworkMemberDiagnosticPort[],
  sourceContext?: PhpFrameworkSourceContext,
): boolean {
  return Boolean(
    phpFrameworkStaticMethodMagicDiagnostic(
      source,
      className,
      methodName,
      providers,
      sourceContext,
    ),
  );
}

export function phpFrameworkStaticMethodMagicDiagnostic(
  source: string,
  className: string,
  methodName: string,
  providers: readonly PhpFrameworkMemberDiagnosticPort[],
  sourceContext?: PhpFrameworkSourceContext,
): PhpFrameworkMagicDiagnosticMatch | null {
  for (const provider of providers) {
    if (
      provider.diagnostics?.isKnownStaticMethod?.({
        className,
        methodName,
        source,
        sourceContext,
      })
    ) {
      return { source: provider.diagnostics.magicSource ?? null };
    }
  }

  return null;
}

export function isKnownPhpFrameworkMemberMethod(
  source: string,
  receiverExpression: string,
  methodName: string,
  providers: readonly PhpFrameworkMemberDiagnosticPort[],
  sourceContext?: PhpFrameworkSourceContext,
  receiverClassName?: string | null,
): boolean {
  return Boolean(
    phpFrameworkMemberMethodMagicDiagnostic(
      source,
      receiverExpression,
      methodName,
      providers,
      sourceContext,
      receiverClassName,
    ),
  );
}

export function phpFrameworkMemberMethodMagicDiagnostic(
  source: string,
  receiverExpression: string,
  methodName: string,
  providers: readonly PhpFrameworkMemberDiagnosticPort[],
  sourceContext?: PhpFrameworkSourceContext,
  receiverClassName?: string | null,
): PhpFrameworkMagicDiagnosticMatch | null {
  for (const provider of providers) {
    if (
      provider.diagnostics?.isKnownMemberMethod?.({
        methodName,
        receiverClassName,
        receiverExpression,
        source,
        sourceContext,
      })
    ) {
      return { source: provider.diagnostics.magicSource ?? null };
    }
  }

  return null;
}

export function phpFrameworkMemberPropertyMagicDiagnostic(
  source: string,
  receiverExpression: string,
  propertyName: string,
  providers: readonly PhpFrameworkMemberDiagnosticPort[],
  sourceContext?: PhpFrameworkSourceContext,
  receiverClassName?: string | null,
): PhpFrameworkMagicDiagnosticMatch | null {
  for (const provider of providers) {
    if (
      provider.diagnostics?.isKnownMemberProperty?.({
        propertyName,
        receiverClassName,
        receiverExpression,
        source,
        sourceContext,
      })
    ) {
      return { source: provider.diagnostics.magicSource ?? null };
    }
  }

  return null;
}
