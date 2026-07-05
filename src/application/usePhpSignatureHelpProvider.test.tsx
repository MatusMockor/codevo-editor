// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import {
  usePhpSignatureHelpProvider,
  type PhpSignatureHelpProvider,
} from "./usePhpSignatureHelpProvider";

const ROOT = "/workspace";

type ProviderOptions = Parameters<typeof usePhpSignatureHelpProvider>[0];
type ReceiverResolver = ProviderOptions["resolvePhpReceiverMethodCompletions"];
type StaticResolver = ProviderOptions["resolvePhpStaticMethodCompletions"];

function positionAfter(source: string, needle: string) {
  const offset = source.indexOf(needle);

  if (offset < 0) {
    throw new Error(`Missing test needle: ${needle}`);
  }

  return positionAt(source, offset + needle.length);
}

function positionAt(source: string, offset: number) {
  const before = source.slice(0, offset);
  const lines = before.split("\n");
  const lastLine = lines[lines.length - 1] ?? "";

  return {
    column: lastLine.length + 1,
    lineNumber: lines.length,
  };
}

function phpMethodCompletion(
  overrides: Partial<PhpMethodCompletion> = {},
): PhpMethodCompletion {
  return {
    declaringClassName: "App\\Support\\Request",
    name: "get",
    parameters: "string $key, mixed $default = null",
    returnType: "mixed",
    visibility: "public",
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });

  return { promise, resolve };
}

function renderProvider(
  overrides: Partial<ProviderOptions> = {},
): {
  currentWorkspaceRootRef: { current: string | null };
  provider: () => PhpSignatureHelpProvider;
  resolvePhpReceiverMethodCompletions: ReturnType<typeof vi.fn<ReceiverResolver>>;
  resolvePhpStaticMethodCompletions: ReturnType<typeof vi.fn<StaticResolver>>;
  unmount: () => void;
} {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { provider: PhpSignatureHelpProvider | null } = {
    provider: null,
  };
  const currentWorkspaceRootRef = { current: ROOT };
  const resolvePhpReceiverMethodCompletions = vi.fn<ReceiverResolver>(
    async () => [],
  );
  const resolvePhpStaticMethodCompletions = vi.fn<StaticResolver>(
    async () => [],
  );
  const options: ProviderOptions = {
    currentWorkspaceRootRef,
    resolvePhpReceiverMethodCompletions,
    resolvePhpStaticMethodCompletions,
    workspaceRoot: ROOT,
    ...overrides,
  };

  function Harness() {
    captured.provider = usePhpSignatureHelpProvider(options);
    return null;
  }

  act(() => {
    root.render(<Harness />);
  });

  return {
    currentWorkspaceRootRef,
    provider: () => {
      if (!captured.provider) {
        throw new Error("hook not mounted");
      }

      return captured.provider;
    },
    resolvePhpReceiverMethodCompletions,
    resolvePhpStaticMethodCompletions,
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe("usePhpSignatureHelpProvider", () => {
  it("returns receiver-call signature parameters and argument index", async () => {
    const source = `<?php
$request->get($key,
`;
    const harness = renderProvider({
      resolvePhpReceiverMethodCompletions: vi.fn<ReceiverResolver>(async () => [
        phpMethodCompletion(),
      ]),
    });

    const signature = await harness
      .provider()
      .providePhpMethodSignature(source, positionAfter(source, "$key,"));

    expect(signature).toMatchObject({
      argumentIndex: 1,
      method: {
        declaringClassName: "App\\Support\\Request",
        name: "get",
        returnType: "mixed",
      },
      parameters: [
        {
          defaultValue: null,
          name: "$key",
          optional: false,
          raw: "string $key",
          type: "string",
        },
        {
          defaultValue: "null",
          name: "$default",
          optional: true,
          raw: "mixed $default = null",
          type: "mixed",
        },
      ],
    });
    expect(signature?.method.visibility).toBe("public");
    expect(Object.keys(signature?.method ?? {})).not.toContain("visibility");

    harness.unmount();
  });

  it("maps a named argument to the matching parameter index", async () => {
    const source = `<?php
$request->get(default: null, key: 'id'
`;
    const harness = renderProvider({
      resolvePhpReceiverMethodCompletions: vi.fn<ReceiverResolver>(async () => [
        phpMethodCompletion(),
      ]),
    });

    const signature = await harness
      .provider()
      .providePhpMethodSignature(source, positionAfter(source, "key: 'id'"));

    expect(signature?.argumentIndex).toBe(0);
    expect(signature?.parameters.map((parameter) => parameter.name)).toEqual([
      "$key",
      "$default",
    ]);

    harness.unmount();
  });

  it("uses only the static resolver for static-call signatures", async () => {
    const source = "<?php\nCommentFactory::make(5";
    const staticResolver = vi.fn<StaticResolver>(async () => [
      phpMethodCompletion({
        declaringClassName: "Database\\Factories\\CommentFactory",
        isStatic: true,
        name: "make",
        parameters: "int $count = 1",
        returnType: "static",
      }),
    ]);
    const harness = renderProvider({
      resolvePhpStaticMethodCompletions: staticResolver,
    });

    const signature = await harness
      .provider()
      .providePhpMethodSignature(source, positionAfter(source, "5"));

    expect(signature?.method).toMatchObject({
      declaringClassName: "Database\\Factories\\CommentFactory",
      isStatic: true,
      name: "make",
    });
    expect(staticResolver).toHaveBeenCalledWith(source, "CommentFactory");
    expect(harness.resolvePhpReceiverMethodCompletions).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("returns null when the workspace root goes stale after awaiting a resolver", async () => {
    const source = "<?php\n$request->get('id'";
    const deferred = createDeferred<PhpMethodCompletion[]>();
    const harness = renderProvider({
      resolvePhpReceiverMethodCompletions: vi.fn<ReceiverResolver>(
        async () => deferred.promise,
      ),
    });

    const signaturePromise = harness
      .provider()
      .providePhpMethodSignature(source, positionAfter(source, "'id'"));
    harness.currentWorkspaceRootRef.current = "/other-workspace";
    deferred.resolve([phpMethodCompletion()]);

    await expect(signaturePromise).resolves.toBeNull();

    harness.unmount();
  });

  it("reuses signature resolution for parameter inlay hints", async () => {
    const source = "<?php\n$request->get('id', 'fallback');\n";
    const receiverResolver = vi.fn<ReceiverResolver>(async () => [
      phpMethodCompletion(),
    ]);
    const harness = renderProvider({
      resolvePhpReceiverMethodCompletions: receiverResolver,
    });

    const hints = await harness.provider().providePhpParameterInlayHints(source, {
      endLine: 1,
      startLine: 1,
    });

    expect(receiverResolver).toHaveBeenCalledTimes(1);
    expect(receiverResolver).toHaveBeenCalledWith(
      source,
      expect.objectContaining({ lineNumber: 2 }),
      "$request",
    );
    expect(hints).toEqual([
      { character: 14, line: 1, name: "key" },
      { character: 20, line: 1, name: "default" },
    ]);

    harness.unmount();
  });

  it("returns no inlay hints when the workspace root goes stale during signature resolution", async () => {
    const source = "<?php\n$request->get('id');\n";
    const deferred = createDeferred<PhpMethodCompletion[]>();
    const harness = renderProvider({
      resolvePhpReceiverMethodCompletions: vi.fn<ReceiverResolver>(
        async () => deferred.promise,
      ),
    });

    const hintsPromise = harness.provider().providePhpParameterInlayHints(source, {
      endLine: 1,
      startLine: 1,
    });
    harness.currentWorkspaceRootRef.current = "/other-workspace";
    deferred.resolve([phpMethodCompletion()]);

    await expect(hintsPromise).resolves.toEqual([]);

    harness.unmount();
  });

  it("caps inlay signature resolution at forty calls per range", async () => {
    const calls = Array.from(
      { length: 41 },
      (_, index) => `$request->get('id-${index}');`,
    );
    const source = `<?php\n${calls.join("\n")}\n`;
    const receiverResolver = vi.fn<ReceiverResolver>(async () => [
      phpMethodCompletion(),
    ]);
    const harness = renderProvider({
      resolvePhpReceiverMethodCompletions: receiverResolver,
    });

    const hints = await harness.provider().providePhpParameterInlayHints(source, {
      endLine: 41,
      startLine: 1,
    });

    expect(receiverResolver).toHaveBeenCalledTimes(40);
    expect(hints).toHaveLength(40);

    harness.unmount();
  });
});
