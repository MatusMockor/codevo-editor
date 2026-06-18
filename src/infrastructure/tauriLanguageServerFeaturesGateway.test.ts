import { describe, expect, it, vi } from "vitest";
import { TauriLanguageServerFeaturesGateway } from "./tauriLanguageServerFeaturesGateway";
import type { LanguageServerTextDocumentPosition } from "../domain/languageServerFeatures";

type FeaturesGatewayConstructor = ConstructorParameters<
  typeof TauriLanguageServerFeaturesGateway
>;
type InvokeCommand = NonNullable<FeaturesGatewayConstructor[0]>;

describe("TauriLanguageServerFeaturesGateway", () => {
  it("returns empty feature results outside Tauri", async () => {
    const invokeCommand = vi.fn<InvokeCommand>();
    const gateway = new TauriLanguageServerFeaturesGateway(
      invokeCommand,
      () => false,
    );

    await expect(gateway.hover("/project", position())).resolves.toBeNull();
    await expect(gateway.completion("/project", position())).resolves.toEqual({
      isIncomplete: false,
      items: [],
    });
    await expect(
      gateway.resolveCompletionItem("/project", completionItem()),
    ).resolves.toEqual(completionItem());
    await expect(gateway.definition("/project", position())).resolves.toEqual([]);
    await expect(
      gateway.documentSymbols("/project", "/project/src/User.php"),
    ).resolves.toEqual([]);
    await expect(gateway.documentHighlights("/project", position())).resolves.toEqual(
      [],
    );
    await expect(
      gateway.documentLinks("/project", "/project/src/User.php"),
    ).resolves.toEqual([]);
    await expect(
      gateway.resolveDocumentLink("/project", documentLink()),
    ).resolves.toEqual(documentLink());
    await expect(gateway.workspaceSymbols("/project", "User")).resolves.toEqual(
      [],
    );
    await expect(gateway.implementation("/project", position())).resolves.toEqual([]);
    await expect(
      gateway.inlayHints("/project", "/project/src/User.php", range()),
    ).resolves.toEqual([]);
    await expect(
      gateway.signatureHelp("/project", position()),
    ).resolves.toBeNull();
    await expect(gateway.references("/project", position())).resolves.toEqual([]);
    await expect(
      gateway.selectionRanges("/project", "/project/src/User.php", [
        { character: 4, line: 10 },
      ]),
    ).resolves.toEqual([]);
    await expect(gateway.rename("/project", position(), "Account")).resolves.toBeNull();
    await expect(
      gateway.codeActions("/project", "/project/src/User.php", range(), {
        diagnostics: [],
        only: ["quickfix"],
      }),
    ).resolves.toEqual([]);
    await expect(
      gateway.resolveCodeAction("/project", codeAction()),
    ).resolves.toEqual(codeAction());
    await expect(
      gateway.executeCommand("/project", command()),
    ).resolves.toBeNull();
    await expect(
      gateway.formatting("/project", "/project/src/User.php", {
        insertSpaces: true,
        tabSize: 2,
      }),
    ).resolves.toEqual([]);
    await expect(
      gateway.rangeFormatting("/project", "/project/src/User.php", range(), {
        insertSpaces: true,
        tabSize: 2,
      }),
    ).resolves.toEqual([]);
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("delegates feature commands inside Tauri", async () => {
    const hover = { contents: "Hover text" };
    const completion = {
      isIncomplete: false,
      items: [
        {
          additionalTextEdits: [],
          commitCharacters: [],
          detail: null,
          documentation: null,
          filterText: null,
          insertText: null,
          insertTextFormat: null,
          kind: 7,
          label: "User",
          sortText: null,
          textEdit: null,
        },
      ],
    };
    const definition = [
      {
        range: {
          end: { character: 8, line: 1 },
          start: { character: 2, line: 1 },
        },
        uri: "file:///project/src/User.php",
      },
    ];
    const rename = {
      changes: {
        "file:///project/src/User.php": [
          {
            newText: "Account",
            range: {
              end: { character: 8, line: 1 },
              start: { character: 2, line: 1 },
            },
          },
        ],
      },
    };
    const codeActions = [
      {
        command: null,
        data: null,
        edit: rename,
        isPreferred: true,
        kind: "quickfix",
        title: "Fix import",
      },
    ];
    const formatting = [
      {
        newText: "  ",
        range: {
          end: { character: 0, line: 2 },
          start: { character: 0, line: 2 },
        },
      },
    ];
    const rangeFormatting = [
      {
        newText: "    ",
        range: {
          end: { character: 4, line: 4 },
          start: { character: 0, line: 4 },
        },
      },
    ];
    const inlayHints = [
      {
        kind: 1,
        label: ": User",
        paddingLeft: true,
        paddingRight: false,
        position: { character: 8, line: 10 },
        tooltip: "Inferred type",
      },
    ];
    const signatureHelp = {
      activeParameter: 0,
      activeSignature: 0,
      signatures: [
        {
          documentation: "Creates a user.",
          label: "createUser(name: string): User",
          parameters: [
            {
              documentation: null,
              label: "name: string",
            },
          ],
        },
      ],
    };
    const documentSymbols = [
      {
        children: [],
        containerName: null,
        detail: null,
        kind: 5,
        name: "User",
        range: range(),
        selectionRange: range(),
      },
    ];
    const documentHighlights = [
      {
        kind: 2,
        range: range(),
      },
    ];
    const documentLinks = [
      {
        data: { file: "/project/src/User.php" },
        range: range(),
        target: null,
        tooltip: "Open file",
      },
    ];
    const resolvedDocumentLink = {
      ...documentLinks[0],
      target: "file:///project/src/User.php",
    };
    const workspaceSymbols = [
      {
        containerName: "App",
        kind: 5,
        location: {
          range: range(),
          uri: "file:///project/src/User.php",
        },
        name: "User",
      },
    ];
    const selectionRanges = [
      {
        parent: {
          parent: null,
          range: {
            end: { character: 20, line: 10 },
            start: { character: 0, line: 10 },
          },
        },
        range: range(),
      },
    ];
    const invokeCommand = vi.fn<InvokeCommand>(async (command) => {
      if (command === "text_document_hover") {
        return hover;
      }

      if (command === "text_document_completion") {
        return completion;
      }

      if (command === "text_document_completion_resolve") {
        return {
          ...completion.items[0],
          documentation: "Resolved docs",
        };
      }

      if (command === "text_document_rename") {
        return rename;
      }

      if (command === "text_document_code_actions") {
        return codeActions;
      }

      if (command === "text_document_code_action_resolve") {
        return codeActions[0];
      }

      if (command === "language_server_execute_command") {
        return rename;
      }

      if (command === "text_document_formatting") {
        return formatting;
      }

      if (command === "text_document_range_formatting") {
        return rangeFormatting;
      }

      if (command === "text_document_inlay_hints") {
        return inlayHints;
      }

      if (command === "text_document_document_symbols") {
        return documentSymbols;
      }

      if (command === "text_document_document_highlights") {
        return documentHighlights;
      }

      if (command === "text_document_document_links") {
        return documentLinks;
      }

      if (command === "text_document_document_link_resolve") {
        return resolvedDocumentLink;
      }

      if (command === "workspace_symbols") {
        return workspaceSymbols;
      }

      if (command === "text_document_selection_ranges") {
        return selectionRanges;
      }

      if (command === "text_document_signature_help") {
        return signatureHelp;
      }

      return definition;
    });
    const gateway = new TauriLanguageServerFeaturesGateway(
      invokeCommand,
      () => true,
    );
    const requestPosition = position();

    await expect(gateway.hover("/project", requestPosition)).resolves.toEqual(hover);
    await expect(gateway.completion("/project", requestPosition)).resolves.toEqual(completion);
    await expect(
      gateway.resolveCompletionItem("/project", completionItem()),
    ).resolves.toEqual({
      ...completion.items[0],
      documentation: "Resolved docs",
    });
    await expect(gateway.definition("/project", requestPosition)).resolves.toEqual(definition);
    await expect(
      gateway.documentSymbols("/project", "/project/src/User.php"),
    ).resolves.toEqual(documentSymbols);
    await expect(
      gateway.documentHighlights("/project", requestPosition),
    ).resolves.toEqual(documentHighlights);
    await expect(
      gateway.documentLinks("/project", "/project/src/User.php"),
    ).resolves.toEqual(documentLinks);
    await expect(
      gateway.resolveDocumentLink("/project", documentLink()),
    ).resolves.toEqual(resolvedDocumentLink);
    await expect(gateway.workspaceSymbols("/project", "User")).resolves.toEqual(
      workspaceSymbols,
    );
    await expect(gateway.implementation("/project", requestPosition)).resolves.toEqual(
      definition,
    );
    await expect(gateway.references("/project", requestPosition)).resolves.toEqual(
      definition,
    );
    await expect(
      gateway.selectionRanges("/project", "/project/src/User.php", [
        { character: 4, line: 10 },
      ]),
    ).resolves.toEqual(selectionRanges);
    await expect(gateway.rename("/project", requestPosition, "Account")).resolves.toEqual(
      rename,
    );
    await expect(
      gateway.codeActions("/project", "/project/src/User.php", range(), {
        diagnostics: [],
        only: ["quickfix"],
      }),
    ).resolves.toEqual(codeActions);
    await expect(
      gateway.resolveCodeAction("/project", codeAction()),
    ).resolves.toEqual(codeActions[0]);
    await expect(
      gateway.executeCommand("/project", command()),
    ).resolves.toEqual(rename);
    await expect(
      gateway.formatting("/project", "/project/src/User.php", {
        insertSpaces: true,
        tabSize: 2,
      }),
    ).resolves.toEqual(formatting);
    await expect(
      gateway.rangeFormatting("/project", "/project/src/User.php", range(), {
        insertSpaces: true,
        tabSize: 4,
      }),
    ).resolves.toEqual(rangeFormatting);
    await expect(
      gateway.inlayHints("/project", "/project/src/User.php", range()),
    ).resolves.toEqual(inlayHints);
    await expect(
      gateway.signatureHelp("/project", requestPosition),
    ).resolves.toEqual(signatureHelp);
    expect(invokeCommand).toHaveBeenCalledWith("text_document_hover", {
      position: requestPosition,
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_completion", {
      position: requestPosition,
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_completion_resolve", {
      item: completionItem(),
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_definition", {
      position: requestPosition,
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_document_symbols", {
      path: "/project/src/User.php",
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_document_highlights", {
      position: requestPosition,
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_document_links", {
      path: "/project/src/User.php",
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith(
      "text_document_document_link_resolve",
      {
        link: documentLink(),
        rootPath: "/project",
      },
    );
    expect(invokeCommand).toHaveBeenCalledWith("workspace_symbols", {
      query: "User",
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_implementation", {
      position: requestPosition,
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_references", {
      position: requestPosition,
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_selection_ranges", {
      path: "/project/src/User.php",
      positions: [{ character: 4, line: 10 }],
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_rename", {
      newName: "Account",
      position: requestPosition,
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_code_actions", {
      context: {
        diagnostics: [],
        only: ["quickfix"],
      },
      path: "/project/src/User.php",
      range: range(),
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_code_action_resolve", {
      action: codeAction(),
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("language_server_execute_command", {
      command: command(),
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_formatting", {
      options: {
        insertSpaces: true,
        tabSize: 2,
      },
      path: "/project/src/User.php",
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_range_formatting", {
      options: {
        insertSpaces: true,
        tabSize: 4,
      },
      path: "/project/src/User.php",
      range: range(),
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_inlay_hints", {
      path: "/project/src/User.php",
      range: range(),
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_signature_help", {
      position: requestPosition,
      rootPath: "/project",
    });
  });
});

function position(): LanguageServerTextDocumentPosition {
  return {
    character: 4,
    line: 10,
    path: "/project/src/User.php",
  };
}

function range() {
  return {
    end: { character: 8, line: 10 },
    start: { character: 4, line: 10 },
  };
}

function codeAction() {
  return {
    command: null,
    data: null,
    edit: null,
    isPreferred: false,
    kind: "quickfix",
    title: "Fix import",
  };
}

function command() {
  return {
    arguments: [{ tsActionId: "unusedIdentifier" }],
    command: "_typescript.applyFixAllCodeAction",
    title: "Fix all",
  };
}

function documentLink() {
  return {
    data: { file: "/project/src/User.php" },
    range: range(),
    target: null,
    tooltip: "Open file",
  };
}

function completionItem() {
  return {
    detail: null,
    documentation: null,
    insertText: null,
    kind: 7,
    label: "User",
  };
}
