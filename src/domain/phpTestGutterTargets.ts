import type { PhpTestFilterMatch } from "./phpTestCommand";
import { computeLineStartOffsets, lineColumnAt } from "./sourceLineOffsets";
import type {
  TestGutterTarget,
  TestGutterTargetKind,
} from "./testGutterTargets";

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
 * Each target also carries a `match` mode telling the command builder how the
 * filter must be encoded for the shell: PHPUnit class/method names are
 * `identifier` (strict `[A-Za-z0-9_]` allow-list); Pest descriptions are
 * `description` (free-form text, safely single-quoted).
 *
 * The module is intentionally conservative: a file with no test class and no
 * Pest call yields no targets, so the glyph never appears on production code.
 * `abstract` test classes are skipped entirely - an abstract class cannot be
 * instantiated, so neither a class-level nor a method-level run would execute
 * anything (and the search continues to the next, concrete `*Test` class).
 */

export type PhpTestGutterTargetKind = TestGutterTargetKind;

export type PhpTestGutterTarget = TestGutterTarget;

const classDeclarationPattern =
  /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b[^{]*\{/g;
// Matches only the method header plus an optional immediately-preceding
// `#[Test]` attribute (bracket-bounded, so linear). A `/** @test */` docblock is
// no longer part of this pattern: the previous form chained two lazy `[\s\S]*?`
// spans across the closing `*/` delimiter, which degraded quadratically on
// malformed/unclosed docblocks (the per-keystroke case in a test file being
// edited). Docblocks are now pre-extracted with a single lazy span instead.
const phpUnitMethodPattern =
  /(?:#\[\s*Test\b[^\]]*\]\s*)?(?:(?:final|abstract)\s+)*public\s+(?:static\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
const pestCallPattern =
  /(?:^|\n)[ \t]*(?:it|test)\s*\(\s*(['"])((?:\\.|(?!\1).)*)\1/g;

export function phpTestGutterTargets(source: string): PhpTestGutterTarget[] {
  const lineStartOffsets = computeLineStartOffsets(source);
  const targets: PhpTestGutterTarget[] = [];

  targets.push(...phpUnitTargets(source, lineStartOffsets));
  targets.push(...pestTargets(source, lineStartOffsets));

  return targets;
}

/**
 * Chooses the target for a "Run All Tests in File" run from the gutter targets
 * of a file.
 *
 * For a pure PHPUnit file the class target runs the whole class via
 * `--filter <ClassName>`. But that filter would skip Pest `it()` / `test()`
 * tests, so as soon as any Pest target is present (a Pest file, or a mixed file
 * that also declares a concrete `*Test` class), we return `null` to signal a
 * whole-suite run (no `--filter`). `null` is also returned when there are no
 * targets at all.
 */
export function runAllTestsTarget(
  targets: readonly PhpTestGutterTarget[],
): PhpTestGutterTarget | null {
  if (targets.some(isPestTarget)) {
    return null;
  }

  return targets.find((target) => target.kind === "class") ?? null;
}

// Pest `it()` / `test()` targets are the only ones encoded as free-form
// descriptions; PHPUnit class and method targets are strict identifiers.
function isPestTarget(target: PhpTestGutterTarget): boolean {
  return target.kind === "method" && target.match === "description";
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
    target(
      "class",
      "identifier",
      declaration.className,
      declaration.nameOffset,
      lineStartOffsets,
    ),
  ];

  const body = source.slice(declaration.bodyStart);
  const testDocBlockEndOffsets = phpUnitTestDocBlockEndOffsets(body);

  for (const method of body.matchAll(phpUnitMethodPattern)) {
    const methodName = method[1] || "";
    const matchOffset = method.index ?? 0;
    const precededByTestDocBlock = phpUnitDocBlockImmediatelyPrecedes(
      body,
      testDocBlockEndOffsets,
      matchOffset,
    );

    if (!isTestMethod(methodName, method[0]) && !precededByTestDocBlock) {
      continue;
    }

    const methodOffset =
      declaration.bodyStart + matchOffset + method[0].lastIndexOf(methodName);
    targets.push(
      target("method", "identifier", methodName, methodOffset, lineStartOffsets),
    );
  }

  return targets;
}

// Pre-extracts every closed `/** ... */` docblock that contains `@test` and
// returns the offset immediately after each one's closing `*/`. This uses
// `indexOf` rather than a global lazy regex so malformed files with many
// unclosed `/**` starts scan the remainder once instead of retrying from every
// opener while the user is mid-typing.
function phpUnitTestDocBlockEndOffsets(body: string): number[] {
  const endOffsets: number[] = [];
  let searchOffset = 0;

  while (searchOffset < body.length) {
    const startOffset = body.indexOf("/**", searchOffset);

    if (startOffset === -1) {
      break;
    }

    const endOffset = body.indexOf("*/", startOffset + 3);

    if (endOffset === -1) {
      break;
    }

    const blockEndOffset = endOffset + 2;
    const block = body.slice(startOffset, blockEndOffset);

    if (/@test\b/.test(block)) {
      endOffsets.push(blockEndOffset);
    }

    searchOffset = blockEndOffset;
  }

  return endOffsets;
}

// True when one of the `@test` docblocks ends right before `methodOffset`, with
// only whitespace in between - the exact "/** @test * / public function" shape the
// previous combined regex recognised.
function phpUnitDocBlockImmediatelyPrecedes(
  body: string,
  testDocBlockEndOffsets: readonly number[],
  methodOffset: number,
): boolean {
  return testDocBlockEndOffsets.some(
    (endOffset) =>
      endOffset <= methodOffset &&
      body.slice(endOffset, methodOffset).trim() === "",
  );
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
      target("method", "description", description, callOffset, lineStartOffsets),
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

    // An abstract class cannot be instantiated, so neither `--filter <Class>`
    // nor a method run would execute anything. Skip it and keep searching for a
    // concrete `*Test` class.
    if (isAbstractClassDeclaration(source, declarationOffset)) {
      continue;
    }

    const nameOffset = declarationOffset + declaration[0].indexOf(className);
    const bodyStart = declarationOffset + declaration[0].length;

    return { bodyStart, className, nameOffset };
  }

  return null;
}

// A `class` keyword is preceded by zero or more class modifiers, which in PHP
// are only `abstract`, `final` and `readonly`. We match a run of exactly those
// keywords immediately before the keyword and check whether `abstract` is
// present.
const classModifiersBeforeClassPattern =
  /(?:\b(?:abstract|final|readonly)\b\s+)*$/;

// Matches a line comment (`//...` or `#...`) or a block comment (`/* ... */`),
// used to blank out comment text before scanning for class modifiers so a
// comment ending in the word "abstract" right above a concrete class is not
// mistaken for the `abstract` modifier.
const commentPattern = /\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\//g;

function isAbstractClassDeclaration(
  source: string,
  classKeywordOffset: number,
): boolean {
  const preceding = source
    .slice(0, classKeywordOffset)
    .replace(commentPattern, " ");
  const modifiers =
    preceding.match(classModifiersBeforeClassPattern)?.[0] ?? "";

  return /\babstract\b/.test(modifiers);
}

function isTestMethod(methodName: string, matchText: string): boolean {
  if (/^test[A-Z0-9_]/.test(methodName) || methodName === "test") {
    return true;
  }

  return /#\[\s*Test\b/.test(matchText) || /@test\b/.test(matchText);
}

function target(
  kind: PhpTestGutterTargetKind,
  match: PhpTestFilterMatch,
  filter: string,
  offset: number,
  lineStartOffsets: number[],
): PhpTestGutterTarget {
  return {
    filter,
    kind,
    label: `Run ${filter}`,
    match,
    position: lineColumnAt(lineStartOffsets, offset),
  };
}
