/**
 * Atomicity core for the PhpStorm "Extract Interface" refactor.
 *
 * Extract Interface is a TWO-part change: it CREATES a sibling
 * `<Class>Interface.php` and EDITS the current class to add `implements
 * <Class>Interface`. From the user's perspective this must be atomic - the
 * class edit may only land once the interface file is safely on disk. The host
 * (a monaco command) applies the in-document class edit AFTER calling this
 * function and ONLY when {@link shouldApplyClassEditAfterWrite} approves the
 * outcome, so a missing/failed file creation can never leave the class
 * implementing an interface that does not exist.
 *
 * Pure orchestration over injected ports (no monaco / no gateway / no React),
 * so the contract is unit-testable: the existence probe runs BEFORE the write
 * (never overwrite a pre-existing interface), and ANY failure - the probe or
 * the write throwing - is reported as `write-failed` rather than swallowed, so
 * the caller withholds the class edit.
 */

export type PhpExtractInterfaceWriteResult =
  | { status: "target-exists" }
  | { error: unknown; status: "write-failed" }
  | { status: "written" };

export interface PhpExtractInterfaceWritePorts {
  /** Resolves `true` when a file already exists at `path`. */
  fileExists(path: string): Promise<boolean>;
  /** Persists `content` to `path` (parent directory assumed to exist). */
  writeFile(path: string, content: string): Promise<void>;
}

export async function writeExtractedInterfaceFile(
  path: string,
  content: string,
  ports: PhpExtractInterfaceWritePorts,
): Promise<PhpExtractInterfaceWriteResult> {
  try {
    if (await ports.fileExists(path)) {
      return { status: "target-exists" };
    }

    await ports.writeFile(path, content);

    return { status: "written" };
  } catch (error) {
    return { error, status: "write-failed" };
  }
}

/**
 * The paired in-document class edit (`implements <Class>Interface`) is applied
 * ONLY when the interface file was freshly written. An already-present target
 * or a failed write leaves the class untouched.
 */
export function shouldApplyClassEditAfterWrite(
  result: PhpExtractInterfaceWriteResult,
): boolean {
  return result.status === "written";
}
