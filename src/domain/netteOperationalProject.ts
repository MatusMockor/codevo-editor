import type { PhpProjectDescriptor } from "./workspace";

const NETTE_APPLICATION_PACKAGE = "nette/application";

export function isNetteApplicationProject(php: PhpProjectDescriptor): boolean {
  return php.packages.some(({ name }) => name === NETTE_APPLICATION_PACKAGE);
}
