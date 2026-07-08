export interface NetteCreateComponentTypeResolver {
  resolveDeclaredType(source: string, typeHint: string | null): string | null;
}
