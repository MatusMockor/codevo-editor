import type { EditorPosition } from "./languageServerFeatures";

/**
 * Pure parser that locates the "run test" gutter glyph anchors in a PHP test
 * file. It mirrors `phpImplementationGutterTargets`: a single O(file) pass to
 * map offsets to line/column, then regex sweeps that emit one target per
 * runnable test.
 *
 * Emitted targets:
 *  - one CLASS target on the `class <Name>Test` line. Its `filter` is the class
 *    name so the gutter can run the whole class.
 *  - one METHOD target per recognised PHPUnit test method: a `test*` method, a
 *    method carrying the `#[Test]` attribute, or a method preceded by a
 *    `/** @test * /` docblock. Its `filter` is the method name.
 *  - one METHOD target per Pest `it(...)` / `test(...)` top-level call. Its
 *    `filter` is the Pest description string.
 *
 * The module is intentionally conservative: a file with no test class and no
 * Pest call yields no targets, so the glyph never appears on production code.
 */

export type PhpTestGutterTargetKind = "class" | "method";

export interface PhpTestGutterTarget {
  filter: string;
  kind: PhpTestGutterTargetKind;
  label: string;
  position: EditorPosition;
}

const classDeclarationPattern =
  /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b[^{]*\{/g;
const phpUnitMethodPattern =
  /(?:#\[\s*Test\b[^\]]*\]\s*|\/\*\*[\s\S]*?@test[\s\S]*?\*\/\s*)?(?:(?:final|abstract)\s+)*public\s+(?:static\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
const pestCallPattern =
  /(?:^|\n)[ \t]*(?:it|test)\s*\(\s*(['"])((?:\\.|(?!\1).)*)\1/g;

export function phpTestGutterTargets(source: string): PhpTestGutterTarget[] {
  const lineStartOffsets = computeLineStartOffsets(source);
  const targets: PhpTestGutterTarget[] = [];

  targets.push(...phpUnitTargets(source, lineStartOffsets));
  targets.push(...pestTargets(source, lineStartOffsets));

  return targets;
}

function phpUnitTargets(
  source: string,
  lineStartOffsets: number[],
): PhpTestGutterTarget[] {
  const declaration = firstTestClassDeclaration(source);

  if (!declaration) {
    return [];
  }

  const targets: PhpTestGutterTarget[] = [
    target("class", declaration.className, declaration.nameOffset, lineStartOffsets),
  ];

  const body = source.slice(declaration.bodyStart);

  for (const method of body.matchAll(phpUnitMethodPattern)) {
    const methodName = method[1] || "";

    if (!isTestMethod(methodName, method[0])) {
      continue;
    }

    const methodOffset =
      declaration.bodyStart + (method.index ?? 0) + method[0].lastIndexOf(methodName);
    targets.push(target("method", methodName, methodOffset, lineStartOffsets));
  }

  return targets;
}

function pestTargets(
  source: string,
  lineStartOffsets: number[],
): PhpTestGutterTarget[] {
  const targets: PhpTestGutterTarget[] = [];

  for (const call of source.matchAll(pestCallPattern)) {
    const description = call[2] || "";

    if (!description) {
      continue;
    }

    const matchText = call[0];
    const callOffset =
      (call.index ?? 0) + matchText.length - matchText.replace(/^\n/, "").trimStart().length;
    targets.push(
      target("method", description, callOffset, lineStartOffsets),
    );
  }

  return targets;
}

interface TestClassDeclaration {
  bodyStart: number;
  className: string;
  nameOffset: number;
}

function firstTestClassDeclaration(
  source: string,
): TestClassDeclaration | null {
  for (const declaration of source.matchAll(classDeclarationPattern)) {
    const className = declaration[1] || "";

    if (!className.endsWith("Test")) {
      continue;
    }

    const declarationOffset = declaration.index ?? 0;
    const nameOffset = declarationOffset + declaration[0].indexOf(className);
    const bodyStart = declarationOffset + declaration[0].length;

    return { bodyStart, className, nameOffset };
  }

  return null;
}

function isTestMethod(methodName: string, matchText: string): boolean {
  if (/^test[A-Z0-9_]/.test(methodName) || methodName === "test") {
    return true;
  }

  return /#\[\s*Test\b/.test(matchText) || /@test\b/.test(matchText);
}

function target(
  kind: PhpTestGutterTargetKind,
  filter: string,
  offset: number,
  lineStartOffsets: number[],
): PhpTestGutterTarget {
  return {
    filter,
    kind,
    label: `Run ${filter}`,
    position: lineColumnAt(lineStartOffsets, offset),
  };
}

// Precompute the byte offset at which each line starts, once per source, so
// converting an offset to a line/column is an O(log lines) binary search
// instead of an O(offset) rescan. Mirrors `phpImplementationGutterTargets`.
function computeLineStartOffsets(source: string): number[] {
  const lineStartOffsets = [0];

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "\n") {
      continue;
    }

    lineStartOffsets.push(index + 1);
  }

  return lineStartOffsets;
}

function lineColumnAt(
  lineStartOffsets: number[],
  offset: number,
): EditorPosition {
  let low = 0;
  let high = lineStartOffsets.length - 1;

  while (low < high) {
    const mid = (low + high + 1) >> 1;

    if (lineStartOffsets[mid] <= offset) {
      low = mid;
      continue;
    }

    high = mid - 1;
  }

  return {
    column: offset - lineStartOffsets[low] + 1,
    lineNumber: low + 1,
  };
}
