export const terminalShellIntegrationBufferLimit = 4_096;

export type TerminalShellIntegrationEvent =
  | { kind: "promptStart" }
  | { kind: "commandStart" }
  | { kind: "preExec" }
  | { exitCode: number | null; kind: "commandEnd" }
  | { cwd: string; kind: "cwd" };

export interface TerminalShellIntegrationFeedResult {
  events: TerminalShellIntegrationEvent[];
}

export class TerminalShellIntegrationScanner {
  private buffer = "";

  feed(chunk: string): TerminalShellIntegrationFeedResult {
    this.buffer += chunk;
    const events: TerminalShellIntegrationEvent[] = [];
    let offset = 0;

    while (offset < this.buffer.length) {
      const start = this.buffer.indexOf("\u001b]", offset);

      if (start < 0) {
        this.buffer = this.buffer.endsWith("\u001b") ? "\u001b" : "";
        return { events };
      }

      const terminator = findTerminator(this.buffer, start + 2);

      if (!terminator) {
        this.buffer = this.buffer.slice(start);

        if (this.buffer.length > terminalShellIntegrationBufferLimit) {
          this.buffer = "";
        }

        return { events };
      }

      const payload = this.buffer.slice(start + 2, terminator.index);
      const event = parsePayload(payload);

      if (event) {
        events.push(event);
      }

      offset = terminator.index + terminator.length;
    }

    this.buffer = "";
    return { events };
  }
}

interface TrackedSession {
  cwd: string | null;
  scanner: TerminalShellIntegrationScanner;
}

export class TerminalShellIntegrationRegistry {
  private readonly roots = new Map<string, Map<number, TrackedSession>>();

  cwd(rootPath: string, sessionId: number): string | null {
    return this.roots.get(rootPath)?.get(sessionId)?.cwd ?? null;
  }

  feed(
    rootPath: string,
    sessionId: number,
    chunk: string,
  ): TerminalShellIntegrationFeedResult {
    const session = this.session(rootPath, sessionId);
    const result = session.scanner.feed(chunk);

    for (const event of result.events) {
      if (event.kind !== "cwd") {
        continue;
      }

      session.cwd = event.cwd;
    }

    return result;
  }

  reset(rootPath: string, sessionId: number): void {
    const sessions = this.roots.get(rootPath);

    if (!sessions) {
      return;
    }

    sessions.delete(sessionId);

    if (sessions.size > 0) {
      return;
    }

    this.roots.delete(rootPath);
  }

  private session(rootPath: string, sessionId: number): TrackedSession {
    let sessions = this.roots.get(rootPath);

    if (!sessions) {
      sessions = new Map();
      this.roots.set(rootPath, sessions);
    }

    let session = sessions.get(sessionId);

    if (!session) {
      session = {
        cwd: null,
        scanner: new TerminalShellIntegrationScanner(),
      };
      sessions.set(sessionId, session);
    }

    return session;
  }
}

function findTerminator(
  value: string,
  start: number,
): { index: number; length: number } | null {
  for (let index = start; index < value.length; index += 1) {
    if (value[index] === "\u0007") {
      return { index, length: 1 };
    }

    if (value[index] === "\u001b" && value[index + 1] === "\\") {
      return { index, length: 2 };
    }
  }

  return null;
}

function parsePayload(payload: string): TerminalShellIntegrationEvent | null {
  if (payload === "133;A") {
    return { kind: "promptStart" };
  }

  if (payload === "133;B") {
    return { kind: "commandStart" };
  }

  if (payload === "133;C") {
    return { kind: "preExec" };
  }

  if (payload.startsWith("133;D;")) {
    return {
      exitCode: parseExitCode(payload.slice("133;D;".length)),
      kind: "commandEnd",
    };
  }

  if (!payload.startsWith("7;")) {
    return null;
  }

  return parseCwd(payload.slice(2));
}

function parseExitCode(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }

  const exitCode = Number(value);

  if (!Number.isSafeInteger(exitCode)) {
    return null;
  }

  return exitCode;
}

function parseCwd(value: string): TerminalShellIntegrationEvent | null {
  try {
    const url = new URL(value);

    if (url.protocol !== "file:") {
      return null;
    }

    return { cwd: decodeURIComponent(url.pathname), kind: "cwd" };
  } catch {
    return null;
  }
}
