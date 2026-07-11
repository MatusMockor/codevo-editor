import { describe, expect, it, vi } from "vitest";
import {
  CONFLICT_MARKER_COMMAND_ID,
  applyConflictMarkerCodeAction,
  conflictMarkerDecorations,
  registerConflictMarkerCodeActions,
} from "./conflictMarkerCodeActions";

const conflict =
  "before\n<<<<<<< ours\ncurrent\n=======\nincoming\n>>>>>>> theirs\nafter\n";

describe("conflict marker editor support", () => {
  it("registers a quick-fix provider for every language and filters by intersecting block", () => {
    const model = createModel(conflict, "file:///workspace/example.json");
    const registration: {
      provider?: {
        provideCodeActions(
          model: ReturnType<typeof createModel>,
          requestedRange: {
            endColumn: number;
            endLineNumber: number;
            startColumn: number;
            startLineNumber: number;
          },
        ): { actions: Array<Record<string, unknown>> };
      };
    } = {};
    const registerCodeActionProvider = vi.fn(
      (
        _selector: string,
        provider: NonNullable<typeof registration.provider>,
      ) => {
        registration.provider = provider;
        return { dispose: vi.fn() };
      },
    );
    const monaco = createMonaco(registerCodeActionProvider);

    const disposables = registerConflictMarkerCodeActions(monaco as never, {
      executeEdits: vi.fn(),
      getModel: vi.fn(() => model),
    } as never);

    expect(registerCodeActionProvider).toHaveBeenCalledWith(
      "*",
      expect.any(Object),
    );
    const inside = registration.provider?.provideCodeActions(
      model,
      range(3, 1, 3, 1),
    );
    const outside = registration.provider?.provideCodeActions(
      model,
      range(1, 1, 1, 1),
    );

    expect(inside?.actions).toEqual([
      expect.objectContaining({
        command: expect.objectContaining({ id: CONFLICT_MARKER_COMMAND_ID }),
        kind: "quickfix",
        title: "Accept Current",
      }),
      expect.objectContaining({ kind: "quickfix", title: "Accept Incoming" }),
      expect.objectContaining({ kind: "quickfix", title: "Accept Both" }),
    ]);
    expect(outside?.actions).toEqual([]);
    expect(monaco.editor.getCommand(CONFLICT_MARKER_COMMAND_ID)).toBeDefined();
    disposables.forEach((disposable) => disposable.dispose());
  });

  it("maps marker and section ranges to decoration descriptors", () => {
    const model = createModel(conflict, "file:///workspace/example.txt");

    expect(conflictMarkerDecorations(model as never)).toEqual([
      decoration(2, "conflict-marker-line conflict-marker-current"),
      decoration(4, "conflict-marker-line"),
      decoration(6, "conflict-marker-line conflict-marker-incoming"),
      decoration(3, "conflict-marker-current"),
      decoration(5, "conflict-marker-incoming"),
    ]);
  });

  it("applies a provided quick fix through Monaco's plain command registry", () => {
    const model = createModel(conflict, "file:///workspace/example.ts");
    const registration = providerRegistration();
    const monaco = createMonaco(registration.registerCodeActionProvider);
    const executeEdits = vi.fn();
    const disposables = registerConflictMarkerCodeActions(monaco as never, {
      executeEdits,
      getModel: vi.fn(() => model),
    } as never);
    const actions = registration.provider?.provideCodeActions(
      model,
      range(3, 1, 3, 1),
    ).actions;
    const action = actions?.find(
      (candidate) => candidate.title === "Accept Incoming",
    );
    const commandId = action?.command?.id;
    const command = commandId ? monaco.editor.getCommand(commandId) : undefined;

    expect(commandId).toBe(CONFLICT_MARKER_COMMAND_ID);
    expect(command).toBeDefined();
    monaco.editor.executeCommand(
      commandId ?? "",
      ...(action?.command?.arguments ?? []),
    );
    expect(executeEdits).toHaveBeenCalledWith(CONFLICT_MARKER_COMMAND_ID, [
      {
        forceMoveMarkers: true,
        range: range(2, 1, 7, 1),
        text: "incoming\n",
      },
    ]);

    disposables.forEach((disposable) => disposable.dispose());
    expect(monaco.editor.getCommand(CONFLICT_MARKER_COMMAND_ID)).toBeUndefined();
  });

  it("applies one exact block as a single undoable editor edit", () => {
    const model = createModel(conflict, "file:///workspace/example.ts");
    const executeEdits = vi.fn();
    const editor = {
      executeEdits,
      getModel: vi.fn(() => model),
    };
    const monaco = createMonaco(vi.fn());
    const request = {
      blockEndOffset: 60,
      blockStartOffset: 7,
      expectedBlock:
        "<<<<<<< ours\ncurrent\n=======\nincoming\n>>>>>>> theirs\n",
      modelUri: "file:///workspace/example.ts",
      variant: "both" as const,
    };

    expect(
      applyConflictMarkerCodeAction(
        monaco as never,
        editor as never,
        request,
      ),
    ).toBe(true);
    expect(executeEdits).toHaveBeenCalledWith(CONFLICT_MARKER_COMMAND_ID, [
      {
        forceMoveMarkers: true,
        range: range(2, 1, 7, 1),
        text: "current\nincoming\n",
      },
    ]);
  });

  it("does nothing when the model or parsed block changed after the action was provided", () => {
    const model = createModel(
      conflict.replace("current", "edited"),
      "file:///workspace/example.ts",
    );
    const executeEdits = vi.fn();
    const monaco = createMonaco(vi.fn());
    const request = {
      blockEndOffset: 60,
      blockStartOffset: 7,
      expectedBlock:
        "<<<<<<< ours\ncurrent\n=======\nincoming\n>>>>>>> theirs\n",
      modelUri: "file:///workspace/example.ts",
      variant: "current" as const,
    };

    expect(
      applyConflictMarkerCodeAction(
        monaco as never,
        { executeEdits, getModel: vi.fn(() => model) } as never,
        request,
      ),
    ).toBe(false);
    expect(executeEdits).not.toHaveBeenCalled();
  });

  it("does nothing when the action targets another model URI", () => {
    const model = createModel(conflict, "file:///workspace/example.ts");
    const executeEdits = vi.fn();

    expect(
      applyConflictMarkerCodeAction(
        createMonaco(vi.fn()) as never,
        { executeEdits, getModel: vi.fn(() => model) } as never,
        conflictRequest({ modelUri: "file:///other/example.ts" }),
      ),
    ).toBe(false);
    expect(executeEdits).not.toHaveBeenCalled();
  });

  it("does nothing when an edit before the block shifted its offsets", () => {
    const model = createModel(
      `inserted\n${conflict}`,
      "file:///workspace/example.ts",
    );
    const executeEdits = vi.fn();

    expect(
      applyConflictMarkerCodeAction(
        createMonaco(vi.fn()) as never,
        { executeEdits, getModel: vi.fn(() => model) } as never,
        conflictRequest(),
      ),
    ).toBe(false);
    expect(executeEdits).not.toHaveBeenCalled();
  });

  it("accepts both sides of a diff3 conflict without retaining the base", () => {
    const diff3 =
      "<<<<<<< ours\ncurrent\n||||||| base\nancestor\n=======\nincoming\n>>>>>>> theirs\n";
    const model = createModel(diff3, "file:///workspace/example.ts");
    const executeEdits = vi.fn();

    expect(
      applyConflictMarkerCodeAction(
        createMonaco(vi.fn()) as never,
        { executeEdits, getModel: vi.fn(() => model) } as never,
        {
          blockEndOffset: diff3.length,
          blockStartOffset: 0,
          expectedBlock: diff3,
          modelUri: "file:///workspace/example.ts",
          variant: "both",
        },
      ),
    ).toBe(true);
    expect(executeEdits).toHaveBeenCalledWith(CONFLICT_MARKER_COMMAND_ID, [
      {
        forceMoveMarkers: true,
        range: range(1, 1, 8, 1),
        text: "current\nincoming\n",
      },
    ]);
  });
});

function conflictRequest(
  overrides: Partial<{
    blockEndOffset: number;
    blockStartOffset: number;
    expectedBlock: string;
    modelUri: string;
    variant: "both" | "current" | "incoming";
  }> = {},
): {
  blockEndOffset: number;
  blockStartOffset: number;
  expectedBlock: string;
  modelUri: string;
  variant: "both" | "current" | "incoming";
} {
  return {
    blockEndOffset: 60,
    blockStartOffset: 7,
    expectedBlock:
      "<<<<<<< ours\ncurrent\n=======\nincoming\n>>>>>>> theirs\n",
    modelUri: "file:///workspace/example.ts",
    variant: "current",
    ...overrides,
  };
}

function decoration(
  lineNumber: number,
  className: string,
): {
  options: { className: string; isWholeLine: boolean };
  range: ReturnType<typeof range>;
} {
  return {
    options: {
      className,
      isWholeLine: true,
    },
    range: range(lineNumber, 1, lineNumber, 1),
  };
}

function range(
  startLineNumber: number,
  startColumn: number,
  endLineNumber: number,
  endColumn: number,
): {
  endColumn: number;
  endLineNumber: number;
  startColumn: number;
  startLineNumber: number;
} {
  return {
    endColumn,
    endLineNumber,
    startColumn,
    startLineNumber,
  };
}

function createModel(initialValue: string, uri: string): {
  getLineMaxColumn(lineNumber: number): number;
  getOffsetAt(position: { column: number; lineNumber: number }): number;
  getPositionAt(offset: number): { column: number; lineNumber: number };
  getValue(): string;
  setValue(nextValue: string): void;
  uri: { toString(): string };
} {
  let value = initialValue;
  const lines = () => value.split("\n");

  return {
    getLineMaxColumn: (lineNumber: number) =>
      (lines()[lineNumber - 1]?.length ?? 0) + 1,
    getOffsetAt: (position: { column: number; lineNumber: number }) => {
      const before = lines().slice(0, position.lineNumber - 1);
      return before.reduce((length, line) => length + line.length + 1, 0) +
        position.column -
        1;
    },
    getPositionAt: (offset: number) => {
      const before = value.slice(0, offset).split("\n");
      return {
        column: (before[before.length - 1]?.length ?? 0) + 1,
        lineNumber: before.length,
      };
    },
    getValue: () => value,
    setValue: (nextValue: string) => {
      value = nextValue;
    },
    uri: { toString: () => uri },
  };
}

function createMonaco(
  registerCodeActionProvider: ReturnType<typeof vi.fn>,
): {
  editor: {
    addCommand(command: {
      id: string;
      run(accessor: unknown, ...args: unknown[]): unknown;
    }): { dispose(): void };
    executeCommand(id: string, ...args: unknown[]): unknown;
    getCommand(id: string):
      | {
          run(accessor: unknown, ...args: unknown[]): unknown;
        }
      | undefined;
  };
  languages: { registerCodeActionProvider: ReturnType<typeof vi.fn> };
  Range: new (
    startLineNumber: number,
    startColumn: number,
    endLineNumber: number,
    endColumn: number,
  ) => {
    endColumn: number;
    endLineNumber: number;
    startColumn: number;
    startLineNumber: number;
  };
} {
  const commands = new Map<
    string,
    { run(accessor: unknown, ...args: unknown[]): unknown }
  >();

  return {
    editor: {
      addCommand: (command) => {
        commands.set(command.id, command);
        return {
          dispose: () => {
            commands.delete(command.id);
          },
        };
      },
      executeCommand: (id, ...args) => {
        const command = commands.get(id);

        if (!command) {
          throw new Error(`Command not found: ${id}`);
        }

        return command.run({}, ...args);
      },
      getCommand: (id) => commands.get(id),
    },
    languages: { registerCodeActionProvider },
    Range: class {
      endColumn: number;
      endLineNumber: number;
      startColumn: number;
      startLineNumber: number;

      constructor(
        startLineNumber: number,
        startColumn: number,
        endLineNumber: number,
        endColumn: number,
      ) {
        this.startLineNumber = startLineNumber;
        this.startColumn = startColumn;
        this.endLineNumber = endLineNumber;
        this.endColumn = endColumn;
      }
    },
  };
}

function providerRegistration(): {
  provider?: {
    provideCodeActions(
      model: ReturnType<typeof createModel>,
      requestedRange: ReturnType<typeof range>,
    ): {
      actions: Array<{
        command?: { arguments?: unknown[]; id: string };
        title: string;
      }>;
    };
  };
  registerCodeActionProvider: ReturnType<typeof vi.fn>;
} {
  const registration: ReturnType<typeof providerRegistration> = {
    registerCodeActionProvider: vi.fn(),
  };
  registration.registerCodeActionProvider.mockImplementation(
    (_selector: string, provider: NonNullable<typeof registration.provider>) => {
      registration.provider = provider;
      return { dispose: vi.fn() };
    },
  );

  return registration;
}
