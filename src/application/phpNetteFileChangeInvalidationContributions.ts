import type { PhpFrameworkFileChangeInvalidationContribution } from "./phpFrameworkFileChangeInvalidationContributions";

export interface PhpNetteFileChangeInvalidationDependencies {
  invalidateLatteExpressionDataForPath(rootPath: string, path: string): void;
  invalidateNeonConfigForPath(rootPath: string, path: string): void;
}

export function createPhpNetteFileChangeInvalidationContributions({
  invalidateLatteExpressionDataForPath,
  invalidateNeonConfigForPath,
}: PhpNetteFileChangeInvalidationDependencies): readonly PhpFrameworkFileChangeInvalidationContribution[] {
  return [
    {
      id: "latte-expression-data",
      supports: (descriptor) => descriptor.kind === "latteExpressionData",
      invalidate: ({ rootPath, path }) =>
        invalidateLatteExpressionDataForPath(rootPath, path),
    },
    {
      id: "neon-config",
      supports: (descriptor) => descriptor.kind === "neonConfig",
      invalidate: ({ rootPath, path }) =>
        invalidateNeonConfigForPath(rootPath, path),
    },
  ];
}
