import {
  detectUnknownClassReference,
  phpCreateClassDestination,
  renderPhpTypeSkeleton,
} from "../domain/phpCreateClass";
import { resolvePhpClassName } from "../domain/phpNavigation";
import type { WorkspaceDescriptor } from "../domain/workspace";
import type {
  PhpCodeActionDescriptor,
  PhpCodeActionRange,
} from "./phpCodeActionTypes";

const VENDOR_PSR4_PREFIXES = ["Composer\\", "Illuminate\\", "Symfony\\"];

const PHP_BUILTIN_CLASS_NAMES = new Set(
  [
    "stdClass",
    "Closure",
    "Generator",
    "Stringable",
    "Iterator",
    "IteratorAggregate",
    "Traversable",
    "Countable",
    "ArrayAccess",
    "ArrayObject",
    "ArrayIterator",
    "JsonSerializable",
    "Serializable",
    "SplStack",
    "SplQueue",
    "SplObjectStorage",
    "SplFixedArray",
    "SplDoublyLinkedList",
    "SplPriorityQueue",
    "SplHeap",
    "SplMinHeap",
    "SplMaxHeap",
    "WeakMap",
    "WeakReference",
    "DateTime",
    "DateTimeImmutable",
    "DateTimeInterface",
    "DateInterval",
    "DateTimeZone",
    "DatePeriod",
    "Throwable",
    "Exception",
    "Error",
    "TypeError",
    "ValueError",
    "ArgumentCountError",
    "ArithmeticError",
    "DivisionByZeroError",
    "ErrorException",
    "RuntimeException",
    "LogicException",
    "InvalidArgumentException",
    "OutOfRangeException",
    "OutOfBoundsException",
    "LengthException",
    "DomainException",
    "RangeException",
    "UnexpectedValueException",
    "UnderflowException",
    "OverflowException",
    "BadFunctionCallException",
    "BadMethodCallException",
    "UnhandledMatchError",
    "JsonException",
    "ReflectionClass",
    "ReflectionMethod",
    "ReflectionProperty",
    "ReflectionFunction",
    "ReflectionParameter",
    "ReflectionNamedType",
    "ReflectionEnum",
    "PDO",
    "PDOStatement",
    "PDOException",
    "SimpleXMLElement",
    "DOMDocument",
    "DOMElement",
    "DOMNode",
    "UnitEnum",
    "BackedEnum",
  ].map((name) => name.toLowerCase()),
);

export interface PhpCreateClassWorkspaceCodeActionOptions {
  readTestFileIfExists: (path: string) => Promise<string | null>;
  resolvePhpClassSourcePaths: (className: string) => Promise<string[]>;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
}

export function buildPhpCreateClassCodeAction({
  readTestFileIfExists,
  resolvePhpClassSourcePaths,
  workspaceDescriptor,
  workspaceRoot,
}: PhpCreateClassWorkspaceCodeActionOptions): (
  source: string,
  range: PhpCodeActionRange,
  isRequestedRootActive: () => boolean,
) => Promise<PhpCodeActionDescriptor | null> {
  return async (
    source,
    range,
    isRequestedRootActive,
  ): Promise<PhpCodeActionDescriptor | null> => {
    const requestedRoot = workspaceRoot;
    const requestedDescriptor = workspaceDescriptor;

    if (!requestedRoot || !requestedDescriptor?.php) {
      return null;
    }

    const reference = detectUnknownClassReference(source, range.start);

    if (!reference) {
      return null;
    }

    const fqn = resolvePhpClassName(source, reference.reference);

    if (!fqn || isPhpBuiltinTypeName(fqn)) {
      return null;
    }

    const destination = phpCreateClassDestination(
      requestedRoot,
      requestedDescriptor.php.psr4Roots,
      VENDOR_PSR4_PREFIXES,
      fqn,
    );

    if (!destination) {
      return null;
    }

    const candidatePaths = await resolvePhpClassSourcePaths(fqn);

    if (!isRequestedRootActive()) {
      return null;
    }

    for (const candidatePath of candidatePaths) {
      const existingSource = await readTestFileIfExists(candidatePath);

      if (!isRequestedRootActive()) {
        return null;
      }

      if (existingSource !== null) {
        return null;
      }
    }

    const existingTarget = await readTestFileIfExists(destination.path);

    if (!isRequestedRootActive()) {
      return null;
    }

    if (existingTarget !== null) {
      return null;
    }

    const shortName = fqn.slice(fqn.lastIndexOf("\\") + 1);
    const skeleton = renderPhpTypeSkeleton(
      reference.kind,
      shortName,
      destination.namespace,
    );

    return {
      edits: [],
      isPreferred: true,
      kind: "quickfix",
      newFile: { content: skeleton, path: destination.path },
      title: `Create ${reference.kind} ${shortName}`,
    };
  };
}

function isPhpBuiltinTypeName(fqn: string): boolean {
  const normalized = fqn.trim().replace(/^\\+/, "");

  if (normalized.includes("\\")) {
    return false;
  }

  return PHP_BUILTIN_CLASS_NAMES.has(normalized.toLowerCase());
}
