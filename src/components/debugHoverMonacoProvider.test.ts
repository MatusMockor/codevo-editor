import type * as Monaco from "monaco-editor";
import { describe, expect, it, vi } from "vitest";
import type { DebugHoverEvaluationPort } from "../application/useDebugHoverEvaluation";
import type { DebugEvaluationResult } from "../domain/debugEvaluationPolicy";
import type { DebugInspectionOwner } from "../domain/debugVariablePages";
import type { EditorDocument } from "../domain/workspace";
import {
  DEBUG_HOVER_COPY_EVALUATE_PATH_COMMAND_ID,
  MAX_DEBUG_HOVER_IN_FLIGHT,
  MAX_DEBUG_HOVER_MARKDOWN_BYTES,
  MAX_DEBUG_HOVER_RENDERED_TYPE_BYTES,
  MAX_DEBUG_HOVER_RENDERED_VALUE_BYTES,
  registerDebugHoverMonacoProviders,
} from "./debugHoverMonacoProvider";

const owner: DebugInspectionOwner = {
  rootKey: "/workspace",
  sessionId: 4,
  pauseGeneration: 2,
  frameId: 11,
};
const position = { column: 7, lineNumber: 1 } as Monaco.Position;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

describe("debug hover Monaco provider", () => {
  it("registers and disposes separate providers without replacing LSP hover", () => {
    const fixture = providerFixture();
    const existingLspProvider = { provideHover: vi.fn() };
    fixture.monaco.languages.registerHoverProvider("typescript", existingLspProvider);
    const registration = registerDebugHoverMonacoProviders(fixture.monaco, fixture.context);

    expect(fixture.registrations.map(([language]) => language)).toEqual([
      "typescript",
      "javascript",
      "javascriptreact",
      "typescript",
      "typescriptreact",
    ]);
    expect(fixture.registrations[0]?.[1]).toBe(existingLspProvider);
    registration.dispose();
    registration.dispose();
    expect(fixture.disposals).toHaveBeenCalledTimes(5);
  });

  it("evaluates the indexed expression with its exact owner and reuses the version cache", async () => {
    const fixture = providerFixture();
    const provider = registeredProvider(fixture);

    const first = await provider.provideHover(fixture.model, position, cancellation());
    const second = await provider.provideHover(fixture.model, position, cancellation());

    expect(fixture.port.evaluate).toHaveBeenNthCalledWith(1, owner, "user.name", expect.anything());
    expect(first?.range).toEqual({
      endColumn: 10,
      endLineNumber: 1,
      startColumn: 1,
      startLineNumber: 1,
    });
    expect(second).not.toBeNull();
    expect(fixture.model.getValue).toHaveBeenCalledOnce();

    fixture.model.version = 2;
    await provider.provideHover(fixture.model, position, cancellation());
    expect(fixture.model.getValue).toHaveBeenCalledTimes(2);
  });

  it("fails closed for a foreign root, an unrouted model, or a changed model path", async () => {
    const fixture = providerFixture();
    const provider = registeredProvider(fixture);
    fixture.state.admittedRoot = "/foreign";
    await expect(
      provider.provideHover(fixture.model, position, cancellation()),
    ).resolves.toBeNull();
    fixture.state.admittedRoot = "/workspace";
    fixture.state.document = null;
    await expect(
      provider.provideHover(fixture.model, position, cancellation()),
    ).resolves.toBeNull();
    fixture.state.document = document("/workspace/other.ts");
    await expect(
      provider.provideHover(fixture.model, position, cancellation()),
    ).resolves.toBeNull();
    expect(fixture.port.evaluate).not.toHaveBeenCalled();
  });

  it("drops old same-model requests and results after model edits", async () => {
    const fixture = providerFixture();
    const first = deferred<DebugEvaluationResult | null>();
    const second = deferred<DebugEvaluationResult | null>();
    fixture.port.evaluate.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const provider = registeredProvider(fixture);
    const firstHover = provider.provideHover(fixture.model, position, cancellation());
    const secondHover = provider.provideHover(fixture.model, position, cancellation());
    second.resolve({ status: "ok", value: "new" });
    await expect(secondHover).resolves.not.toBeNull();
    first.resolve({ status: "ok", value: "old" });
    await expect(firstHover).resolves.toBeNull();

    const edited = deferred<DebugEvaluationResult | null>();
    fixture.port.evaluate.mockReturnValueOnce(edited.promise);
    const editedHover = provider.provideHover(fixture.model, position, cancellation());
    fixture.model.version += 1;
    edited.resolve({ status: "ok", value: "stale" });
    await expect(editedHover).resolves.toBeNull();
  });

  it("invalidates a pending model request when the newest position has no expression", async () => {
    const fixture = providerFixture();
    const pending = deferred<DebugEvaluationResult | null>();
    fixture.port.evaluate.mockReturnValueOnce(pending.promise);
    const provider = registeredProvider(fixture);
    const oldHover = provider.provideHover(fixture.model, position, cancellation());

    await expect(
      provider.provideHover(
        fixture.model,
        { column: 5, lineNumber: 1 } as Monaco.Position,
        cancellation(),
      ),
    ).resolves.toBeNull();
    pending.resolve({ status: "ok", value: "old" });
    await expect(oldHover).resolves.toBeNull();
  });

  it("honors cancellation and disposal after dispatch", async () => {
    const fixture = providerFixture();
    const pending = deferred<DebugEvaluationResult | null>();
    fixture.port.evaluate.mockReturnValue(pending.promise);
    const registration = registerDebugHoverMonacoProviders(fixture.monaco, fixture.context);
    const provider = fixture.registrations[0]![1];
    const token = cancellation();
    const cancelledHover = provider.provideHover(fixture.model, position, token);
    token.isCancellationRequested = true;
    pending.resolve({ status: "ok", value: "cancelled" });
    await expect(cancelledHover).resolves.toBeNull();

    const disposed = deferred<DebugEvaluationResult | null>();
    fixture.port.evaluate.mockReturnValueOnce(disposed.promise);
    const disposedHover = provider.provideHover(fixture.model, position, cancellation());
    registration.dispose();
    disposed.resolve({ status: "ok", value: "disposed" });
    await expect(disposedHover).resolves.toBeNull();
  });

  it("caps physical evaluations globally at four", async () => {
    const pending = Array.from({ length: MAX_DEBUG_HOVER_IN_FLIGHT }, () =>
      deferred<DebugEvaluationResult | null>(),
    );
    const fixtures = pending.map(() => providerFixture());
    fixtures.forEach((fixture, index) =>
      fixture.port.evaluate.mockReturnValueOnce(pending[index]!.promise),
    );
    const hovers = fixtures.map((fixture) =>
      registeredProvider(fixture).provideHover(fixture.model, position, cancellation()),
    );
    const fifth = providerFixture();
    await expect(
      registeredProvider(fifth).provideHover(fifth.model, position, cancellation()),
    ).resolves.toBeNull();
    expect(
      fixtures.reduce((total, fixture) => total + fixture.port.evaluate.mock.calls.length, 0),
    ).toBe(MAX_DEBUG_HOVER_IN_FLIGHT);
    expect(fifth.port.evaluate).not.toHaveBeenCalled();
    expect(fifth.model.getValue).not.toHaveBeenCalled();
    pending.forEach((request) => request.resolve({ status: "ok", value: "done" }));
    await Promise.all(hovers);
  });

  it("renders capped values and types as untrusted non-HTML Markdown", async () => {
    const fixture = providerFixture();
    fixture.port.evaluate.mockResolvedValue({
      status: "ok",
      value: `<img src=x onerror=alert(1)>\rstandalone\r\n\`\`\`\n[link](command:run)\n${"ž".repeat(MAX_DEBUG_HOVER_RENDERED_VALUE_BYTES)}`,
      type: `[command](command:run)${"t".repeat(MAX_DEBUG_HOVER_RENDERED_TYPE_BYTES)}`,
    });
    const hover = await registeredProvider(fixture).provideHover(
      fixture.model,
      position,
      cancellation(),
    );
    const markdown = hover?.contents[0] as Monaco.IMarkdownString;

    expect(markdown.isTrusted).toBe(false);
    expect(markdown.supportHtml).toBe(false);
    expect(markdown.value).toContain("    <img src=x onerror=alert(1)>");
    expect(markdown.value).not.toContain("\r");
    expect(markdown.value).toContain("    ```");
    expect(markdown.value).toContain("    [link](command:run)");
    expect(markdown.value).toContain("\\[command\\]\\(command:run\\)");
    expect(new TextEncoder().encode(markdown.value).byteLength).toBeLessThanOrEqual(
      MAX_DEBUG_HOVER_MARKDOWN_BYTES,
    );
  });

  it("offers only the allowlisted Copy as Expression action for an official evaluateName", async () => {
    const fixture = providerFixture();
    fixture.port.evaluate.mockResolvedValue({
      status: "ok",
      value: "Ada",
      evaluateName: "users[0].name",
    });
    const hover = await registeredProvider(fixture).provideHover(
      fixture.model,
      position,
      cancellation(),
    );
    const markdown = hover?.contents[0] as Monaco.IMarkdownString;

    expect(markdown.isTrusted).toEqual({
      enabledCommands: [DEBUG_HOVER_COPY_EVALUATE_PATH_COMMAND_ID],
    });
    expect(markdown.value).toContain(
      `[Copy as Expression](command:${DEBUG_HOVER_COPY_EVALUATE_PATH_COMMAND_ID}?`,
    );
    expect(markdown.value).not.toContain("users[0].name");
    expect(fixture.port.registerCopyEvaluatePath).toHaveBeenCalledWith(
      owner,
      expect.objectContaining({ evaluateName: "users[0].name" }),
      expect.any(Function),
    );

    await fixture.commands[0]!.run(undefined, "forged");
    expect(fixture.port.copyEvaluatePath).not.toHaveBeenCalled();
    await fixture.commands[0]!.run(undefined, "0123456789abcdef0123456789abcdef0123");
    await fixture.commands[0]!.run(undefined, "0123456789abcdef0123456789abcdef0123");
    expect(fixture.port.copyEvaluatePath).toHaveBeenCalledOnce();
    expect(fixture.port.copyEvaluatePath).toHaveBeenCalledWith(
      "0123456789abcdef0123456789abcdef0123",
    );
  });

  it("revokes outstanding actions and unregisters the command on provider disposal", async () => {
    const fixture = providerFixture();
    fixture.port.evaluate.mockResolvedValue({
      status: "ok",
      value: "Ada",
      evaluateName: "user.name",
    });
    const registration = registerDebugHoverMonacoProviders(fixture.monaco, fixture.context);
    await fixture.registrations[0]![1].provideHover(fixture.model, position, cancellation());

    registration.dispose();
    expect(fixture.port.revokeCopyEvaluatePath).toHaveBeenCalledExactlyOnceWith(
      "0123456789abcdef0123456789abcdef0123",
    );
    expect(fixture.disposals).toHaveBeenCalledTimes(5);
    await fixture.commands[0]!.run(undefined, "0123456789abcdef0123456789abcdef0123");
    expect(fixture.port.copyEvaluatePath).not.toHaveBeenCalled();
  });

  it("renders concise escaped policy errors and suppresses infrastructure failures", async () => {
    const fixture = providerFixture();
    fixture.port.evaluate.mockResolvedValueOnce({
      status: "error",
      kind: "side-effect",
      message: "[blocked](command:run)",
    });
    const provider = registeredProvider(fixture);
    const hover = await provider.provideHover(fixture.model, position, cancellation());
    expect((hover?.contents[0] as Monaco.IMarkdownString).value).toBe(
      "Debug evaluation unavailable: \\[blocked\\]\\(command:run\\)",
    );
    fixture.port.evaluate.mockRejectedValueOnce(new Error("transport detail"));
    await expect(
      provider.provideHover(fixture.model, position, cancellation()),
    ).resolves.toBeNull();
  });
});

function providerFixture() {
  const registrations: Array<[string, Monaco.languages.HoverProvider]> = [];
  const disposals = vi.fn();
  const commands: Array<{ run: (...args: unknown[]) => Promise<void> }> = [];
  const monaco = {
    editor: {
      addCommand: vi.fn((command: { run: (...args: unknown[]) => Promise<void> }) => {
        commands.push(command);
        return { dispose: disposals };
      }),
    },
    languages: {
      registerHoverProvider: vi.fn((language: string, provider: Monaco.languages.HoverProvider) => {
        registrations.push([language, provider]);
        return { dispose: disposals };
      }),
    },
  } as unknown as typeof Monaco;
  const currentModel = model("/workspace/app.ts");
  const getOwner = vi.fn<DebugHoverEvaluationPort["getOwner"]>(() => owner);
  const evaluate = vi.fn<DebugHoverEvaluationPort["evaluate"]>(async () => ({
    status: "ok",
    value: "Ada",
  }));
  const port = {
    copyEvaluatePath: vi.fn(async () => true),
    evaluate,
    getOwner,
    registerCopyEvaluatePath: vi.fn(() => "0123456789abcdef0123456789abcdef0123"),
    revokeCopyEvaluatePath: vi.fn(),
  } satisfies DebugHoverEvaluationPort;
  const state: { admittedRoot: string | null; document: EditorDocument | null } = {
    admittedRoot: "/workspace" as string | null,
    document: document("/workspace/app.ts") as EditorDocument | null,
  };
  const fixture = {
    model: currentModel,
    monaco,
    port,
    commands,
    registrations,
    disposals,
    state,
  };
  return {
    ...fixture,
    context: {
      debugHover: port as DebugHoverEvaluationPort,
      getAdmittedWorkspaceRoot: () => state.admittedRoot,
      resolveDocumentForModel: (candidate: Monaco.editor.ITextModel) =>
        candidate === currentModel
          ? state.document
          : candidate.uri.fsPath.startsWith("/workspace/") && state.document
            ? { ...state.document, path: candidate.uri.fsPath }
            : null,
    },
  };
}

function registeredProvider(fixture: ReturnType<typeof providerFixture>) {
  registerDebugHoverMonacoProviders(fixture.monaco, fixture.context);
  return fixture.registrations[0]![1];
}

function cancellation() {
  return { isCancellationRequested: false } as Monaco.CancellationToken & {
    isCancellationRequested: boolean;
  };
}

function document(path: string): EditorDocument {
  return { content: "user.name", language: "typescript", name: "app.ts", path, savedContent: "" };
}

function model(path: string) {
  return {
    getValue: vi.fn(() => "user.name"),
    getVersionId: vi.fn(function (this: { version: number }) {
      return this.version;
    }),
    uri: { fsPath: path, path, scheme: "file", toString: () => `file://${path}` },
    version: 1,
  } as unknown as Monaco.editor.ITextModel & {
    version: number;
    getValue: ReturnType<typeof vi.fn>;
  };
}
