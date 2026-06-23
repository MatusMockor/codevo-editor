import { parsePhpClassStructure } from "./phpClassStructure";
import type { Psr4Root } from "./workspace";

/**
 * Pure derivation + rendering for PhpStorm-style "Create Test" (Ctrl+Shift+T).
 *
 * Given the source of a PHP class and the project's PSR-4 roots, this module
 * decides WHERE the matching PHPUnit test lives (path + namespace), WHICH base
 * `TestCase` it should extend (Laravel `Tests\TestCase` when a `Tests\` dev
 * autoload root exists, otherwise plain `PHPUnit\Framework\TestCase`) and which
 * skeleton test methods to emit (one per public, non-static, non-magic method).
 *
 * Design constraints:
 *  - Pure: no I/O, no side effects. The controller owns file creation/opening
 *    and the per-workspace isolation guards.
 *  - Conservative: returns `null` whenever there is nothing meaningful to
 *    generate (not a class, no public instance methods, no PSR-4 root that
 *    prefixes the source FQN). The caller never overwrites an existing file.
 *  - Test path mirrors the source sub-namespace under `tests/Unit/` (PhpStorm
 *    default), so `App\Services\InvoiceService` →
 *    `tests/Unit/Services/InvoiceServiceTest.php`.
 */

const LARAVEL_TESTS_NAMESPACE = "Tests\\";
const LARAVEL_TEST_CASE = "Tests\\TestCase";
const PHPUNIT_TEST_CASE = "PHPUnit\\Framework\\TestCase";
const UNIT_SEGMENT = "Unit";

export interface PhpTestClassPlanInput {
  psr4Roots: readonly Psr4Root[];
  source: string;
}

export interface PhpTestClassPlan {
  baseClassFqn: string;
  methodNames: string[];
  relativePath: string;
  sourceClassName: string;
  testClassName: string;
  testNamespace: string;
}

export function phpTestClassPlan(
  input: PhpTestClassPlanInput,
): PhpTestClassPlan | null {
  const structure = parsePhpClassStructure(input.source);

  if (structure.kind !== "class") {
    return null;
  }

  const sourceFqn = phpClassFqnFromSource(input.source);

  if (!sourceFqn) {
    return null;
  }

  const methodNames = testableMethodNames(structure.methods);

  if (methodNames.length === 0) {
    return null;
  }

  const sourceRoot = matchingSourceRoot(sourceFqn, input.psr4Roots);

  if (!sourceRoot) {
    return null;
  }

  const sourceClassName = shortName(sourceFqn);
  const relativeNamespace = sourceFqn
    .slice(sourceRoot.namespace.length, sourceFqn.length - sourceClassName.length)
    .replace(/^\\+/, "")
    .replace(/\\+$/, "");
  const testClassName = `${sourceClassName}Test`;
  const testsRoot = laravelTestsRoot(input.psr4Roots);

  return {
    baseClassFqn: testsRoot ? LARAVEL_TEST_CASE : PHPUNIT_TEST_CASE,
    methodNames,
    relativePath: testRelativePath(testsRoot, relativeNamespace, testClassName),
    sourceClassName,
    testClassName,
    testNamespace: testNamespace(relativeNamespace),
  };
}

export function renderPhpTestSkeleton(plan: PhpTestClassPlan): string {
  const methods = plan.methodNames.map(renderTestMethod).join("\n\n");

  return [
    "<?php",
    "",
    "declare(strict_types=1);",
    "",
    `namespace ${plan.testNamespace};`,
    "",
    `use ${plan.baseClassFqn};`,
    "",
    `class ${plan.testClassName} extends TestCase`,
    "{",
    methods,
    "}",
    "",
  ].join("\n");
}

function renderTestMethod(methodName: string): string {
  const testName = `test${capitalize(methodName)}`;

  return [
    `    public function ${testName}(): void`,
    "    {",
    "        $this->markTestIncomplete();",
    "    }",
  ].join("\n");
}

function testableMethodNames(
  methods: ReturnType<typeof parsePhpClassStructure>["methods"],
): string[] {
  const seen = new Set<string>();
  const names: string[] = [];

  for (const method of methods) {
    if (method.visibility !== "public" || method.isStatic) {
      continue;
    }

    if (isMagicMethodName(method.name)) {
      continue;
    }

    const key = method.name.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    names.push(method.name);
  }

  return names;
}

function isMagicMethodName(name: string): boolean {
  return name.startsWith("__");
}

function matchingSourceRoot(
  fqn: string,
  psr4Roots: readonly Psr4Root[],
): Psr4Root | null {
  const candidates = psr4Roots
    .filter((root) => root.paths.length > 0)
    .filter((root) => fqn.startsWith(root.namespace))
    .filter((root) => root.namespace !== LARAVEL_TESTS_NAMESPACE);

  if (candidates.length === 0) {
    return null;
  }

  return candidates.reduce((longest, root) =>
    root.namespace.length > longest.namespace.length ? root : longest,
  );
}

function laravelTestsRoot(psr4Roots: readonly Psr4Root[]): Psr4Root | null {
  return (
    psr4Roots.find(
      (root) => root.namespace === LARAVEL_TESTS_NAMESPACE && root.paths.length > 0,
    ) ?? null
  );
}

function testNamespace(relativeNamespace: string): string {
  if (!relativeNamespace) {
    return `${LARAVEL_TESTS_NAMESPACE}${UNIT_SEGMENT}`;
  }

  return `${LARAVEL_TESTS_NAMESPACE}${UNIT_SEGMENT}\\${relativeNamespace}`;
}

function testRelativePath(
  testsRoot: Psr4Root | null,
  relativeNamespace: string,
  testClassName: string,
): string {
  const baseDirectory = trimSlashes(testsRoot?.paths[0] ?? "tests");
  const subDirectory = relativeNamespace.split("\\").filter(Boolean).join("/");
  const segments = [baseDirectory, UNIT_SEGMENT, subDirectory, `${testClassName}.php`]
    .filter(Boolean)
    .join("/");

  return segments;
}

function phpClassFqnFromSource(source: string): string | null {
  const className = phpDeclaredClassName(source);

  if (!className) {
    return null;
  }

  const namespace = phpNamespaceName(source);

  if (!namespace) {
    return className;
  }

  return `${namespace}\\${className}`;
}

function phpDeclaredClassName(source: string): string | null {
  const match = /\b(?:abstract\s+|final\s+)*class\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(
    source,
  );

  return match?.[1] ?? null;
}

function phpNamespaceName(source: string): string | null {
  const match = /\bnamespace\s+([^;{]+)\s*[;{]/.exec(source);

  if (!match?.[1]) {
    return null;
  }

  return match[1].trim().replace(/^\\+/, "") || null;
}

function shortName(fqn: string): string {
  const segments = fqn.split("\\");

  return segments[segments.length - 1] ?? fqn;
}

function capitalize(value: string): string {
  if (!value) {
    return value;
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+/, "").replace(/\/+$/, "");
}
