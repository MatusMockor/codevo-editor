import type { PhpFrameworkProvider } from "./phpFrameworkProviders";
import type { PhpProjectDescriptor } from "./workspace";

const SYMFONY_PROJECT_PACKAGES = new Set([
  "symfony/framework-bundle",
  "symfony/symfony",
]);

export function isSymfonyPhpProject(php: PhpProjectDescriptor): boolean {
  return php.packages.some(({ name }) => SYMFONY_PROJECT_PACKAGES.has(name));
}

/** Detection-only provider; workflow capabilities are contributed in focused slices. */
export const phpSymfonyFrameworkProvider: PhpFrameworkProvider = {
  appliesTo: isSymfonyPhpProject,
  id: "symfony",
  presentation: { activityLabel: "Symfony" },
};
