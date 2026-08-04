import { describe, expect, it, vi } from "vitest";
import {
  createMonotonicLanguageServerRequestIdAllocator,
  DECORATIVE_LANGUAGE_SERVER_FEATURES,
  INTERACTIVE_LANGUAGE_SERVER_FEATURES,
  JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS,
  languageServerRequestPriority,
  TauriLanguageServerFeaturesGateway,
} from "./tauriLanguageServerFeaturesGateway";
import type {
  LanguageServerSignatureHelpContext,
  LanguageServerTextDocumentPosition,
} from "../domain/languageServerFeatures";

type FeaturesGatewayConstructor = ConstructorParameters<typeof TauriLanguageServerFeaturesGateway>;
type InvokeCommand = NonNullable<FeaturesGatewayConstructor[0]>;

describe("TauriLanguageServerFeaturesGateway", () => {
  it("fails closed instead of reusing an exhausted request identifier", () => {
    const allocate = createMonotonicLanguageServerRequestIdAllocator(Number.MAX_SAFE_INTEGER - 1);

    expect(allocate()).toBe(Number.MAX_SAFE_INTEGER);
    expect(allocate).toThrow("Language-server request identifier space is exhausted.");
  });

  it("preserves a structured JSON-RPC code-action rejection", async () => {
    const responseError = {
      code: -32802,
      message: "Server cancelled obsolete code action",
    };
    const invokeCommand = vi.fn<InvokeCommand>().mockRejectedValue(responseError);
    const gateway = new TauriLanguageServerFeaturesGateway(
      invokeCommand,
      () => true,
      JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS,
    );

    await expect(
      gateway.codeActions(
        "/project",
        "/project/src/User.ts",
        range(),
        {
          diagnostics: [],
          only: ["quickfix"],
        },
        11,
      ),
    ).rejects.toBe(responseError);
  });

  it("preserves legacy string code-action rejections", async () => {
    const invokeCommand = vi.fn<InvokeCommand>().mockRejectedValue("PHPactor request failed");
    const gateway = new TauriLanguageServerFeaturesGateway(invokeCommand, () => true);

    await expect(
      gateway.codeActions("/project", "/project/src/User.php", range(), {
        diagnostics: [],
        only: ["quickfix"],
      }),
    ).rejects.toBe("PHPactor request failed");
  });

  it("preserves a structured JSON-RPC code-action resolve rejection", async () => {
    const responseError = {
      code: -32801,
      message: "Resolved action is content-modified",
    };
    const invokeCommand = vi.fn<InvokeCommand>().mockRejectedValue(responseError);
    const gateway = new TauriLanguageServerFeaturesGateway(
      invokeCommand,
      () => true,
      JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS,
    );

    await expect(gateway.resolveCodeAction("/project", codeAction(), 12)).rejects.toBe(
      responseError,
    );
  });

  it("returns empty feature results outside Tauri", async () => {
    const invokeCommand = vi.fn<InvokeCommand>();
    const gateway = new TauriLanguageServerFeaturesGateway(invokeCommand, () => false);

    await expect(gateway.hover("/project", position())).resolves.toBeNull();
    await expect(gateway.completion("/project", position())).resolves.toEqual({
      isIncomplete: false,
      items: [],
    });
    await expect(gateway.resolveCompletionItem("/project", completionItem())).resolves.toEqual(
      completionItem(),
    );
    await expect(gateway.definition("/project", position())).resolves.toEqual([]);
    await expect(gateway.sourceDefinition("/project", position())).resolves.toEqual([]);
    await expect(gateway.declaration("/project", position())).resolves.toEqual([]);
    await expect(gateway.typeDefinition("/project", position())).resolves.toEqual([]);
    await expect(gateway.documentSymbols("/project", "/project/src/User.php")).resolves.toEqual([]);
    await expect(gateway.documentHighlights("/project", position())).resolves.toEqual([]);
    await expect(gateway.documentLinks("/project", "/project/src/User.php")).resolves.toEqual([]);
    await expect(gateway.resolveDocumentLink("/project", documentLink())).resolves.toEqual(
      documentLink(),
    );
    await expect(gateway.foldingRanges("/project", "/project/src/User.php")).resolves.toEqual([]);
    await expect(gateway.workspaceSymbols("/project", "User")).resolves.toEqual([]);
    await expect(gateway.implementation("/project", position())).resolves.toEqual([]);
    await expect(gateway.inlayHints("/project", "/project/src/User.php", range())).resolves.toEqual(
      [],
    );
    await expect(gateway.resolveInlayHint("/project", inlayHint())).resolves.toEqual(inlayHint());
    await expect(gateway.signatureHelp("/project", position())).resolves.toBeNull();
    await expect(gateway.prepareRename("/project", position())).resolves.toBeNull();
    await expect(gateway.references("/project", position())).resolves.toEqual([]);
    await expect(
      gateway.selectionRanges("/project", "/project/src/User.php", [{ character: 4, line: 10 }]),
    ).resolves.toEqual([]);
    await expect(gateway.linkedEditingRanges("/project", position())).resolves.toBeNull();
    await expect(gateway.semanticTokens("/project", "/project/src/User.php")).resolves.toBeNull();
    await expect(gateway.rename("/project", position(), "Account")).resolves.toBeNull();
    await expect(
      gateway.codeActions("/project", "/project/src/User.php", range(), {
        diagnostics: [],
        only: ["quickfix"],
      }),
    ).resolves.toEqual([]);
    await expect(gateway.resolveCodeAction("/project", codeAction())).resolves.toEqual(
      codeAction(),
    );
    await expect(gateway.codeLenses("/project", "/project/src/User.php")).resolves.toEqual([]);
    await expect(gateway.resolveCodeLens("/project", codeLens())).resolves.toEqual(codeLens());
    await expect(gateway.prepareCallHierarchy("/project", position())).resolves.toEqual([]);
    await expect(gateway.incomingCalls("/project", callHierarchyItem())).resolves.toEqual([]);
    await expect(gateway.outgoingCalls("/project", callHierarchyItem())).resolves.toEqual([]);
    await expect(gateway.prepareTypeHierarchy("/project", position())).resolves.toEqual([]);
    await expect(gateway.typeHierarchySupertypes("/project", typeHierarchyItem())).resolves.toEqual(
      [],
    );
    await expect(gateway.typeHierarchySubtypes("/project", typeHierarchyItem())).resolves.toEqual(
      [],
    );
    await expect(gateway.executeCommand("/project", command())).resolves.toBeNull();
    await expect(gateway.willCreateFiles("/project", "/project/src/User.ts")).resolves.toBeNull();
    await expect(
      gateway.didCreateFiles("/project", "/project/src/User.ts"),
    ).resolves.toBeUndefined();
    await expect(
      gateway.willRenameFiles("/project", "/project/src/User.ts", "/project/src/Account.ts"),
    ).resolves.toBeNull();
    await expect(
      gateway.didRenameFiles("/project", "/project/src/User.ts", "/project/src/Account.ts"),
    ).resolves.toBeUndefined();
    await expect(gateway.willDeleteFiles("/project", "/project/src/User.ts")).resolves.toBeNull();
    await expect(
      gateway.didDeleteFiles("/project", "/project/src/User.ts"),
    ).resolves.toBeUndefined();
    await expect(
      gateway.didChangeWatchedFiles("/project", [
        {
          changeType: "created",
          path: "/project/src/User.ts",
        },
      ]),
    ).resolves.toBeUndefined();
    await expect(
      gateway.didChangeConfiguration("/project", {
        suggest: { autoImports: false },
      }),
    ).resolves.toBeUndefined();
    await expect(
      gateway.formatting("/project", "/project/src/User.php", {
        insertSpaces: true,
        tabSize: 2,
      }),
    ).resolves.toEqual([]);
    await expect(
      gateway.onTypeFormatting(
        "/project",
        "/project/src/User.php",
        { character: 4, line: 10 },
        ";",
        {
          insertSpaces: true,
          tabSize: 2,
        },
      ),
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
    const codeLenses = [
      {
        command: command(),
        data: { kind: "references" },
        range: range(),
      },
    ];
    const callHierarchyItems = [callHierarchyItem()];
    const incomingCalls = [
      {
        from: callHierarchyItem("renderUser"),
        fromRanges: [range()],
      },
    ];
    const outgoingCalls = [
      {
        fromRanges: [range()],
        to: callHierarchyItem("loadUser"),
      },
    ];
    const typeHierarchyItems = [typeHierarchyItem()];
    const supertypes = [typeHierarchyItem("BaseUser")];
    const subtypes = [typeHierarchyItem("AdminUser")];
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
    const onTypeFormatting = [
      {
        newText: "\n  ",
        range: {
          end: { character: 0, line: 5 },
          start: { character: 0, line: 5 },
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
    const prepareRename = {
      defaultBehavior: false,
      placeholder: "user",
      range: range(),
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
    const foldingRanges = [
      {
        endCharacter: null,
        endLine: 20,
        kind: "region",
        startCharacter: null,
        startLine: 10,
      },
    ];
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
    const linkedEditingRanges = {
      ranges: [range()],
      wordPattern: "[A-Za-z]+",
    };
    const semanticTokens = {
      data: [0, 6, 4, 8, 0],
      resultId: "semantic-1",
    };
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

      if (command === "text_document_code_lenses") {
        return codeLenses;
      }

      if (command === "text_document_code_lens_resolve") {
        return codeLenses[0];
      }

      if (command === "text_document_prepare_call_hierarchy") {
        return callHierarchyItems;
      }

      if (command === "text_document_incoming_calls") {
        return incomingCalls;
      }

      if (command === "text_document_outgoing_calls") {
        return outgoingCalls;
      }

      if (command === "text_document_prepare_type_hierarchy") {
        return typeHierarchyItems;
      }

      if (command === "text_document_type_hierarchy_supertypes") {
        return supertypes;
      }

      if (command === "text_document_type_hierarchy_subtypes") {
        return subtypes;
      }

      if (command === "language_server_execute_command") {
        return rename;
      }

      if (command === "language_server_execute_command_locations") {
        return { isIncomplete: false, locations: definition, totalCount: definition.length };
      }

      if (command === "text_document_references") {
        return { isIncomplete: false, locations: definition, totalCount: definition.length };
      }

      if (command === "text_document_will_create_files") {
        return rename;
      }

      if (command === "workspace_did_create_files") {
        return undefined;
      }

      if (command === "text_document_will_rename_files") {
        return rename;
      }

      if (command === "workspace_did_rename_files") {
        return undefined;
      }

      if (command === "text_document_will_delete_files") {
        return rename;
      }

      if (command === "workspace_did_delete_files") {
        return undefined;
      }

      if (command === "workspace_did_change_watched_files") {
        return undefined;
      }

      if (command === "workspace_did_change_configuration") {
        return undefined;
      }

      if (command === "text_document_formatting") {
        return formatting;
      }

      if (command === "text_document_range_formatting") {
        return rangeFormatting;
      }

      if (command === "text_document_on_type_formatting") {
        return onTypeFormatting;
      }

      if (command === "text_document_inlay_hints") {
        return inlayHints;
      }

      if (command === "text_document_inlay_hint_resolve") {
        return {
          ...inlayHints[0],
          tooltip: "Resolved inferred type",
        };
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

      if (command === "text_document_folding_ranges") {
        return foldingRanges;
      }

      if (command === "workspace_symbols") {
        return workspaceSymbols;
      }

      if (command === "text_document_selection_ranges") {
        return selectionRanges;
      }

      if (command === "text_document_linked_editing_ranges") {
        return linkedEditingRanges;
      }

      if (command === "text_document_semantic_tokens") {
        return semanticTokens;
      }

      if (command === "text_document_range_semantic_tokens") {
        return semanticTokens;
      }

      if (command === "text_document_signature_help") {
        return signatureHelp;
      }

      if (command === "text_document_prepare_rename") {
        return prepareRename;
      }

      return definition;
    });
    const gateway = new TauriLanguageServerFeaturesGateway(invokeCommand, () => true);
    const requestPosition = position();

    await expect(gateway.hover("/project", requestPosition)).resolves.toEqual(hover);
    await expect(
      gateway.completion("/project", requestPosition, {
        triggerCharacter: ".",
        triggerKind: 2,
      }),
    ).resolves.toEqual(completion);
    await expect(gateway.resolveCompletionItem("/project", completionItem())).resolves.toEqual({
      ...completion.items[0],
      documentation: "Resolved docs",
    });
    await expect(gateway.definition("/project", requestPosition)).resolves.toEqual(definition);
    await expect(gateway.sourceDefinition("/project", requestPosition)).resolves.toEqual(
      definition,
    );
    await expect(gateway.declaration("/project", requestPosition)).resolves.toEqual(definition);
    await expect(gateway.documentSymbols("/project", "/project/src/User.php")).resolves.toEqual(
      documentSymbols,
    );
    await expect(gateway.documentHighlights("/project", requestPosition)).resolves.toEqual(
      documentHighlights,
    );
    await expect(gateway.documentLinks("/project", "/project/src/User.php")).resolves.toEqual(
      documentLinks,
    );
    await expect(gateway.resolveDocumentLink("/project", documentLink())).resolves.toEqual(
      resolvedDocumentLink,
    );
    await expect(gateway.foldingRanges("/project", "/project/src/User.php")).resolves.toEqual(
      foldingRanges,
    );
    await expect(gateway.workspaceSymbols("/project", "User")).resolves.toEqual(workspaceSymbols);
    await expect(gateway.implementation("/project", requestPosition)).resolves.toEqual(definition);
    await expect(gateway.typeDefinition("/project", requestPosition)).resolves.toEqual(definition);
    await expect(gateway.references("/project", requestPosition)).resolves.toEqual(definition);
    await expect(
      gateway.selectionRanges("/project", "/project/src/User.php", [{ character: 4, line: 10 }]),
    ).resolves.toEqual(selectionRanges);
    await expect(gateway.linkedEditingRanges("/project", requestPosition)).resolves.toEqual(
      linkedEditingRanges,
    );
    await expect(gateway.semanticTokens("/project", "/project/src/User.php")).resolves.toEqual(
      semanticTokens,
    );
    await expect(
      gateway.rangeSemanticTokens("/project", "/project/src/User.php", range()),
    ).resolves.toEqual(semanticTokens);
    await expect(gateway.rename("/project", requestPosition, "Account")).resolves.toEqual(rename);
    await expect(
      gateway.codeActions("/project", "/project/src/User.php", range(), {
        diagnostics: [],
        only: ["quickfix"],
      }),
    ).resolves.toEqual(codeActions);
    await expect(gateway.resolveCodeAction("/project", codeAction())).resolves.toEqual(
      codeActions[0],
    );
    await expect(gateway.codeLenses("/project", "/project/src/User.php")).resolves.toEqual(
      codeLenses,
    );
    await expect(gateway.resolveCodeLens("/project", codeLens())).resolves.toEqual(codeLenses[0]);
    await expect(gateway.prepareCallHierarchy("/project", requestPosition)).resolves.toEqual(
      callHierarchyItems,
    );
    await expect(gateway.incomingCalls("/project", callHierarchyItems[0])).resolves.toEqual(
      incomingCalls,
    );
    await expect(gateway.outgoingCalls("/project", callHierarchyItems[0])).resolves.toEqual(
      outgoingCalls,
    );
    await expect(gateway.prepareTypeHierarchy("/project", requestPosition)).resolves.toEqual(
      typeHierarchyItems,
    );
    await expect(
      gateway.typeHierarchySupertypes("/project", typeHierarchyItems[0]),
    ).resolves.toEqual(supertypes);
    await expect(gateway.typeHierarchySubtypes("/project", typeHierarchyItems[0])).resolves.toEqual(
      subtypes,
    );
    await expect(gateway.executeCommand("/project", command())).resolves.toEqual(rename);
    await expect(gateway.executeCommandLocations("/project", command())).resolves.toEqual(
      definition,
    );
    await expect(gateway.willCreateFiles("/project", "/project/src/User.ts")).resolves.toEqual(
      rename,
    );
    await expect(
      gateway.didCreateFiles("/project", "/project/src/User.ts"),
    ).resolves.toBeUndefined();
    await expect(
      gateway.willRenameFiles("/project", "/project/src/User.ts", "/project/src/Account.ts"),
    ).resolves.toEqual(rename);
    await expect(
      gateway.didRenameFiles("/project", "/project/src/User.ts", "/project/src/Account.ts"),
    ).resolves.toBeUndefined();
    await expect(gateway.willDeleteFiles("/project", "/project/src/User.ts")).resolves.toEqual(
      rename,
    );
    await expect(
      gateway.didDeleteFiles("/project", "/project/src/User.ts"),
    ).resolves.toBeUndefined();
    await expect(
      gateway.didChangeWatchedFiles("/project", [
        {
          changeType: "created",
          path: "/project/src/User.ts",
        },
        {
          changeType: "deleted",
          path: "/project/src/Old.ts",
        },
      ]),
    ).resolves.toBeUndefined();
    await expect(
      gateway.didChangeConfiguration("/project", {
        suggest: { autoImports: false },
      }),
    ).resolves.toBeUndefined();
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
      gateway.onTypeFormatting(
        "/project",
        "/project/src/User.php",
        { character: 1, line: 5 },
        "\n",
        {
          insertSpaces: true,
          tabSize: 2,
        },
      ),
    ).resolves.toEqual(onTypeFormatting);
    await expect(gateway.inlayHints("/project", "/project/src/User.php", range())).resolves.toEqual(
      inlayHints,
    );
    await expect(gateway.resolveInlayHint("/project", inlayHints[0])).resolves.toEqual({
      ...inlayHints[0],
      tooltip: "Resolved inferred type",
    });
    await expect(gateway.signatureHelp("/project", requestPosition)).resolves.toEqual(
      signatureHelp,
    );
    const signatureContext: LanguageServerSignatureHelpContext = {
      activeSignatureHelp: signatureHelp,
      isRetrigger: true,
      triggerCharacter: ",",
      triggerKind: 2,
    };
    await expect(
      gateway.signatureHelp("/project", requestPosition, signatureContext),
    ).resolves.toEqual(signatureHelp);
    await expect(gateway.prepareRename("/project", requestPosition)).resolves.toEqual(
      prepareRename,
    );
    expect(invokeCommand).toHaveBeenCalledWith("text_document_hover", {
      position: requestPosition,
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_completion", {
      context: {
        triggerCharacter: ".",
        triggerKind: 2,
      },
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
    expect(invokeCommand).toHaveBeenCalledWith("text_document_declaration", {
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
    expect(invokeCommand).toHaveBeenCalledWith("text_document_document_link_resolve", {
      link: documentLink(),
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_folding_ranges", {
      path: "/project/src/User.php",
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("workspace_symbols", {
      query: "User",
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_implementation", {
      position: requestPosition,
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_type_definition", {
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
    expect(invokeCommand).toHaveBeenCalledWith("text_document_linked_editing_ranges", {
      position: requestPosition,
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_semantic_tokens", {
      path: "/project/src/User.php",
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_range_semantic_tokens", {
      path: "/project/src/User.php",
      range: range(),
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
    expect(invokeCommand).toHaveBeenCalledWith("text_document_code_lenses", {
      path: "/project/src/User.php",
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_code_lens_resolve", {
      lens: codeLens(),
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_prepare_call_hierarchy", {
      position: requestPosition,
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_incoming_calls", {
      item: callHierarchyItems[0],
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_outgoing_calls", {
      item: callHierarchyItems[0],
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_prepare_type_hierarchy", {
      position: requestPosition,
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_type_hierarchy_supertypes", {
      item: typeHierarchyItems[0],
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_type_hierarchy_subtypes", {
      item: typeHierarchyItems[0],
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("language_server_execute_command", {
      command: command(),
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("language_server_execute_command_locations", {
      command: command(),
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_will_create_files", {
      path: "/project/src/User.ts",
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("workspace_did_create_files", {
      path: "/project/src/User.ts",
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_will_rename_files", {
      newPath: "/project/src/Account.ts",
      oldPath: "/project/src/User.ts",
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("workspace_did_rename_files", {
      newPath: "/project/src/Account.ts",
      oldPath: "/project/src/User.ts",
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_will_delete_files", {
      path: "/project/src/User.ts",
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("workspace_did_delete_files", {
      path: "/project/src/User.ts",
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("workspace_did_change_watched_files", {
      changes: [
        {
          changeType: "created",
          path: "/project/src/User.ts",
        },
        {
          changeType: "deleted",
          path: "/project/src/Old.ts",
        },
      ],
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("workspace_did_change_configuration", {
      rootPath: "/project",
      settings: {
        suggest: { autoImports: false },
      },
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
    expect(invokeCommand).toHaveBeenCalledWith("text_document_on_type_formatting", {
      ch: "\n",
      options: {
        insertSpaces: true,
        tabSize: 2,
      },
      path: "/project/src/User.php",
      position: { character: 1, line: 5 },
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_inlay_hints", {
      path: "/project/src/User.php",
      range: range(),
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_inlay_hint_resolve", {
      hint: inlayHints[0],
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_signature_help", {
      position: requestPosition,
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_signature_help", {
      context: signatureContext,
      position: requestPosition,
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_prepare_rename", {
      position: requestPosition,
      rootPath: "/project",
    });
  });

  it("identifies cancellable PHP navigation and cursor requests without changing legacy calls", async () => {
    const invokeCommand = vi.fn<InvokeCommand>(async () => []);
    const gateway = new TauriLanguageServerFeaturesGateway(invokeCommand, () => true);
    const identified = gateway.identifiedRequests;
    const requestPosition = position();
    const sessionId = 23;
    const requests = [
      {
        command: "text_document_hover",
        request: identified.hover("/project", requestPosition, sessionId),
      },
      {
        command: "text_document_completion",
        request: identified.completion("/project", requestPosition, undefined, sessionId),
      },
      {
        command: "text_document_definition",
        request: identified.definition("/project", requestPosition, sessionId),
      },
      {
        command: "text_document_declaration",
        request: identified.declaration("/project", requestPosition, sessionId),
      },
      {
        command: "text_document_implementation",
        request: identified.implementation("/project", requestPosition, sessionId),
      },
      {
        command: "text_document_type_definition",
        request: identified.typeDefinition("/project", requestPosition, sessionId),
      },
      {
        command: "text_document_references",
        request: identified.references("/project", requestPosition, sessionId),
      },
      {
        command: "text_document_signature_help",
        request: identified.signatureHelp("/project", requestPosition, undefined, sessionId),
      },
    ];

    expect(new Set(requests.map(({ request }) => request.requestId)).size).toBe(requests.length);
    await Promise.all(
      requests.map(async ({ command, request }) => {
        expect(request.sessionId).toBe(sessionId);
        expect(invokeCommand).toHaveBeenCalledWith(command, {
          position: requestPosition,
          requestId: request.requestId,
          rootPath: "/project",
          sessionId,
        });
        await request;
      }),
    );

    await identified.cancelRequest("/project", sessionId, requests[0]!.request.requestId);
    expect(invokeCommand).toHaveBeenCalledWith("cancel_lsp_request", {
      requestId: requests[0]!.request.requestId,
      rootPath: "/project",
      serverKind: "php",
      sessionId,
    });
  });

  it.each([-1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid PHP identified-request session authority %s before IPC",
    (sessionId) => {
      const invokeCommand = vi.fn<InvokeCommand>();
      const gateway = new TauriLanguageServerFeaturesGateway(invokeCommand, () => true);

      expect(() =>
        gateway.identifiedRequests.definition("/project", position(), sessionId),
      ).toThrow("Language-server request requires a valid active session.");
      expect(invokeCommand).not.toHaveBeenCalled();
    },
  );

  it("routes cancellation from explicit server family even when the command map is mixed", async () => {
    const phpInvokeCommand = vi.fn<InvokeCommand>().mockResolvedValue(undefined);
    const javascriptTypeScriptInvokeCommand = vi.fn<InvokeCommand>().mockResolvedValue(undefined);
    const mixedCommands = {
      ...JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS,
      hover: "custom_hover",
    };
    const phpGateway = new TauriLanguageServerFeaturesGateway(
      phpInvokeCommand,
      () => true,
      JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS,
      "php",
    );
    const javascriptTypeScriptGateway = new TauriLanguageServerFeaturesGateway(
      javascriptTypeScriptInvokeCommand,
      () => true,
      mixedCommands,
      "javascriptTypeScript",
    );

    await phpGateway.identifiedRequests.cancelRequest("/project", 11, 101);
    await javascriptTypeScriptGateway.identifiedRequests.cancelRequest("/project", 12, 102);

    expect(phpInvokeCommand).toHaveBeenCalledWith("cancel_lsp_request", {
      requestId: 101,
      rootPath: "/project",
      serverKind: "php",
      sessionId: 11,
    });
    expect(javascriptTypeScriptInvokeCommand).toHaveBeenCalledWith("cancel_lsp_request", {
      requestId: 102,
      rootPath: "/project",
      serverKind: "javascriptTypeScript",
      sessionId: 12,
    });
  });

  it("identifies cancellable JavaScript and TypeScript navigation and cursor requests", async () => {
    const definition = [
      {
        range: {
          end: { character: 8, line: 1 },
          start: { character: 2, line: 1 },
        },
        uri: "file:///project/src/User.ts",
      },
    ];
    const invokeCommand = vi.fn<InvokeCommand>(async (command) =>
      command.endsWith("_references")
        ? { isIncomplete: false, locations: definition, totalCount: definition.length }
        : definition,
    );
    const gateway = new TauriLanguageServerFeaturesGateway(
      invokeCommand,
      () => true,
      JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS,
    );
    const requestPosition = position();
    const sessionId = 11;
    const requests = [
      {
        command: "javascript_typescript_text_document_definition",
        request: gateway.definition("/project", requestPosition, sessionId),
      },
      {
        command: "javascript_typescript_text_document_source_definition",
        request: gateway.sourceDefinition("/project", requestPosition, sessionId),
      },
      {
        command: "javascript_typescript_text_document_declaration",
        request: gateway.declaration("/project", requestPosition, sessionId),
      },
      {
        command: "javascript_typescript_text_document_implementation",
        request: gateway.implementation("/project", requestPosition, sessionId),
      },
      {
        command: "javascript_typescript_text_document_type_definition",
        request: gateway.typeDefinition("/project", requestPosition, sessionId),
      },
      {
        command: "javascript_typescript_text_document_references",
        request: gateway.references("/project", requestPosition, true, sessionId),
      },
      {
        command: "javascript_typescript_text_document_document_highlights",
        request: gateway.documentHighlights("/project", requestPosition, sessionId),
      },
      {
        command: "javascript_typescript_text_document_linked_editing_ranges",
        request: gateway.linkedEditingRanges("/project", requestPosition, sessionId),
      },
    ];

    expect(new Set(requests.map(({ request }) => request.requestId)).size).toBe(requests.length);
    await Promise.all(
      requests.map(({ request }) => {
        expect(request.sessionId).toBe(sessionId);
        return expect(request).resolves.toEqual(definition);
      }),
    );
    for (const { command, request } of requests) {
      if (languageServerRequestPriority(command) === "decorative") {
        continue;
      }
      expect(invokeCommand).toHaveBeenCalledWith(command, {
        ...(command.endsWith("_references") ? { includeDeclaration: true } : {}),
        position: requestPosition,
        requestId: request.requestId,
        rootPath: "/project",
        sessionId,
      });
    }
    expect(invokeCommand).toHaveBeenCalledWith(
      "javascript_typescript_text_document_document_highlights",
      {
        position: requestPosition,
        requestId: expect.any(Number),
        rootPath: "/project",
        sessionId,
      },
    );
  });

  it("forwards the exact JavaScript and TypeScript reference declaration context", async () => {
    const invokeCommand = vi.fn<InvokeCommand>(async () => ({
      isIncomplete: false,
      locations: [],
      totalCount: 0,
    }));
    const gateway = new TauriLanguageServerFeaturesGateway(
      invokeCommand,
      () => true,
      JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS,
    );
    const requestPosition = position();

    const excludingDeclarations = gateway.references("/project", requestPosition, false, 41);
    await expect(excludingDeclarations).resolves.toEqual([]);
    expect(excludingDeclarations.sessionId).toBe(41);
    expect(invokeCommand).toHaveBeenCalledWith("javascript_typescript_text_document_references", {
      includeDeclaration: false,
      position: requestPosition,
      requestId: excludingDeclarations.requestId,
      rootPath: "/project",
      sessionId: 41,
    });

    const includingDeclarations = gateway.references("/project", requestPosition, true, 42);
    await expect(includingDeclarations).resolves.toEqual([]);
    expect(includingDeclarations.sessionId).toBe(42);
    expect(invokeCommand).toHaveBeenCalledWith("javascript_typescript_text_document_references", {
      includeDeclaration: true,
      position: requestPosition,
      requestId: includingDeclarations.requestId,
      rootPath: "/project",
      sessionId: 42,
    });
  });

  it("identifies cancellable JavaScript and TypeScript code-action provide and resolve requests", async () => {
    const response = codeAction();
    const invokeCommand = vi.fn<InvokeCommand>(async () => response);
    const gateway = new TauriLanguageServerFeaturesGateway(
      invokeCommand,
      () => true,
      JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS,
    );
    const sessionId = 17;
    const provide = gateway.codeActions(
      "/project",
      "/project/src/User.ts",
      range(),
      { diagnostics: [], only: ["quickfix"] },
      sessionId,
    );
    const resolve = gateway.resolveCodeAction("/project", response, sessionId);

    expect(provide.sessionId).toBe(sessionId);
    expect(resolve.sessionId).toBe(sessionId);
    expect(provide.requestId).not.toBe(resolve.requestId);
    expect(invokeCommand).toHaveBeenCalledWith("javascript_typescript_text_document_code_actions", {
      context: { diagnostics: [], only: ["quickfix"] },
      path: "/project/src/User.ts",
      range: range(),
      requestId: provide.requestId,
      rootPath: "/project",
      sessionId,
    });
    expect(invokeCommand).toHaveBeenCalledWith(
      "javascript_typescript_text_document_code_action_resolve",
      {
        action: response,
        requestId: resolve.requestId,
        rootPath: "/project",
        sessionId,
      },
    );
    await expect(provide).resolves.toBe(response);
    await expect(resolve).resolves.toBe(response);
  });

  it("identifies JavaScript and TypeScript rename and completion-resolve requests", async () => {
    const item = completionItem();
    const invokeCommand = vi.fn<InvokeCommand>(async (command) => {
      if (command.endsWith("completion_resolve")) {
        return item;
      }
      return command.endsWith("formatting") ? [] : null;
    });
    const gateway = new TauriLanguageServerFeaturesGateway(
      invokeCommand,
      () => true,
      JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS,
      "javascriptTypeScript",
    );
    const sessionId = 19;
    const prepare = gateway.identifiedRequests.prepareRename!("/project", position(), sessionId);
    const rename = gateway.identifiedRequests.rename!("/project", position(), "Account", sessionId);
    const resolve = gateway.identifiedRequests.resolveCompletionItem!("/project", item, sessionId);
    const formatting = gateway.identifiedRequests.formatting!(
      "/project",
      "/project/src/User.ts",
      { insertSpaces: true, tabSize: 2 },
      sessionId,
    );

    expect(
      new Set([prepare.requestId, rename.requestId, resolve.requestId, formatting.requestId]).size,
    ).toBe(4);
    expect(prepare.sessionId).toBe(sessionId);
    expect(rename.sessionId).toBe(sessionId);
    expect(resolve.sessionId).toBe(sessionId);
    expect(formatting.sessionId).toBe(sessionId);
    expect(invokeCommand).toHaveBeenCalledWith(
      "javascript_typescript_text_document_prepare_rename",
      {
        position: position(),
        requestId: prepare.requestId,
        rootPath: "/project",
        sessionId,
      },
    );
    expect(invokeCommand).toHaveBeenCalledWith("javascript_typescript_text_document_rename", {
      newName: "Account",
      position: position(),
      requestId: rename.requestId,
      rootPath: "/project",
      sessionId,
    });
    expect(invokeCommand).toHaveBeenCalledWith(
      "javascript_typescript_text_document_completion_resolve",
      {
        item,
        requestId: resolve.requestId,
        rootPath: "/project",
        sessionId,
      },
    );
    expect(invokeCommand).toHaveBeenCalledWith("javascript_typescript_text_document_formatting", {
      options: { insertSpaces: true, tabSize: 2 },
      path: "/project/src/User.ts",
      requestId: formatting.requestId,
      rootPath: "/project",
      sessionId,
    });
    await expect(prepare).resolves.toBeNull();
    await expect(rename).resolves.toBeNull();
    await expect(resolve).resolves.toBe(item);
    await expect(formatting).resolves.toEqual([]);

    await gateway.cancelRequest("/project", sessionId, rename.requestId);
    expect(invokeCommand).toHaveBeenCalledWith("cancel_lsp_request", {
      requestId: rename.requestId,
      rootPath: "/project",
      serverKind: "javascriptTypeScript",
      sessionId,
    });
  });

  it("identifies cancellable JavaScript and TypeScript workspace-symbol requests", async () => {
    const symbols = [
      {
        containerName: "App",
        kind: 5,
        location: {
          range: range(),
          uri: "file:///project/src/User.ts",
        },
        name: "User",
      },
    ];
    const invokeCommand = vi.fn<InvokeCommand>(async () => symbols);
    const gateway = new TauriLanguageServerFeaturesGateway(
      invokeCommand,
      () => true,
      JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS,
    );
    const request = gateway.workspaceSymbols("/project", "User", 18);

    expect(request.sessionId).toBe(18);
    expect(request.requestId).toEqual(expect.any(Number));
    expect(invokeCommand).toHaveBeenCalledWith("javascript_typescript_workspace_symbols", {
      query: "User",
      requestId: request.requestId,
      rootPath: "/project",
      sessionId: 18,
    });
    await expect(request).resolves.toEqual(symbols);
  });

  it.each([undefined, -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "fails closed before invoking with invalid session authority %s",
    (sessionId) => {
      const invokeCommand = vi.fn<InvokeCommand>();
      const gateway = new TauriLanguageServerFeaturesGateway(
        invokeCommand,
        () => true,
        JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS,
      );

      expect(() => gateway.definition("/project", position(), sessionId)).toThrow(
        "JavaScript/TypeScript language-server request requires an active session.",
      );
      expect(() => gateway.documentHighlights("/project", position(), sessionId)).toThrow(
        "JavaScript/TypeScript language-server request requires an active session.",
      );
      expect(() => gateway.linkedEditingRanges("/project", position(), sessionId)).toThrow(
        "JavaScript/TypeScript language-server request requires an active session.",
      );
      expect(() =>
        gateway.codeActions(
          "/project",
          "/project/src/User.ts",
          range(),
          { diagnostics: [], only: ["quickfix"] },
          sessionId,
        ),
      ).toThrow("JavaScript/TypeScript language-server request requires an active session.");
      expect(() => gateway.resolveCodeAction("/project", codeAction(), sessionId)).toThrow(
        "JavaScript/TypeScript language-server request requires an active session.",
      );
      expect(() =>
        gateway.identifiedRequests.prepareRename!("/project", position(), sessionId as number),
      ).toThrow("JavaScript/TypeScript language-server request requires an active session.");
      expect(() =>
        gateway.identifiedRequests.rename!("/project", position(), "Account", sessionId as number),
      ).toThrow("JavaScript/TypeScript language-server request requires an active session.");
      expect(() =>
        gateway.identifiedRequests.resolveCompletionItem!(
          "/project",
          completionItem(),
          sessionId as number,
        ),
      ).toThrow("JavaScript/TypeScript language-server request requires an active session.");
      expect(() =>
        gateway.identifiedRequests.formatting!(
          "/project",
          "/project/src/User.ts",
          { insertSpaces: true, tabSize: 2 },
          sessionId as number,
        ),
      ).toThrow("JavaScript/TypeScript language-server request requires an active session.");
      expect(() => gateway.workspaceSymbols("/project", "User", sessionId)).toThrow(
        "JavaScript/TypeScript language-server request requires an active session.",
      );
      expect(invokeCommand).not.toHaveBeenCalled();
    },
  );

  it("preserves the identified request after a late gateway settlement", async () => {
    const definition = [
      {
        range: {
          end: { character: 8, line: 1 },
          start: { character: 2, line: 1 },
        },
        uri: "file:///project/src/User.ts",
      },
    ];
    let resolveRequest: (value: typeof definition) => void = () => undefined;
    const result = new Promise<typeof definition>((resolve) => {
      resolveRequest = resolve;
    });
    const invokeCommand = vi.fn<InvokeCommand>(() => result);
    const gateway = new TauriLanguageServerFeaturesGateway(
      invokeCommand,
      () => true,
      JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS,
    );
    const requestPosition = position();
    const sessionId = 12;
    const request = gateway.definition("/project", requestPosition, sessionId);
    const requestId = request.requestId;

    expect(invokeCommand).toHaveBeenCalledWith("javascript_typescript_text_document_definition", {
      position: requestPosition,
      requestId,
      rootPath: "/project",
      sessionId,
    });
    resolveRequest(definition);

    await expect(request).resolves.toEqual(definition);
    expect(request.requestId).toBe(requestId);
  });

  it("delegates JavaScript and TypeScript range semantic tokens through the JS/TS command map", async () => {
    const semanticTokens = {
      data: [0, 6, 4, 8, 0],
      resultId: "semantic-1",
    };
    const invokeCommand = vi.fn<InvokeCommand>(async () => semanticTokens);
    const gateway = new TauriLanguageServerFeaturesGateway(
      invokeCommand,
      () => true,
      JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS,
    );

    const sessionId = 13;
    const request = gateway.rangeSemanticTokens(
      "/project",
      "/project/src/User.ts",
      range(),
      sessionId,
    );
    expect(request.requestId).toEqual(expect.any(Number));
    expect(request.sessionId).toBe(sessionId);
    await expect(request).resolves.toEqual(semanticTokens);
    expect(invokeCommand).toHaveBeenCalledWith(
      "javascript_typescript_text_document_range_semantic_tokens",
      {
        path: "/project/src/User.ts",
        range: range(),
        requestId: request.requestId,
        rootPath: "/project",
        sessionId,
      },
    );
  });

  it("delegates JavaScript and TypeScript execute-command locations through the JS/TS command map", async () => {
    const locations = [
      {
        range: {
          end: { character: 8, line: 1 },
          start: { character: 2, line: 1 },
        },
        uri: "file:///project/src/User.ts",
      },
    ];
    const invokeCommand = vi.fn<InvokeCommand>(async () => ({
      isIncomplete: true,
      locations,
      totalCount: 3,
    }));
    const gateway = new TauriLanguageServerFeaturesGateway(
      invokeCommand,
      () => true,
      JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS,
    );

    const sessionId = 17;
    const request = gateway.executeCommandLocations("/project", command(), sessionId);

    await expect(request).resolves.toEqual(locations);
    await expect(request).resolves.toMatchObject({
      isIncomplete: true,
      totalCount: 3,
    });
    expect(request.sessionId).toBe(sessionId);
    expect(request.requestId).toEqual(expect.any(Number));
    expect(invokeCommand).toHaveBeenCalledWith(
      "javascript_typescript_language_server_execute_command_locations",
      {
        command: command(),
        requestId: request.requestId,
        rootPath: "/project",
        sessionId,
      },
    );
  });

  it("delegates JavaScript and TypeScript file create and delete operations through the JS/TS command map", async () => {
    const edit = { changes: {} };
    const invokeCommand = vi.fn<InvokeCommand>(async (command) => {
      if (command.includes("_did_")) {
        return undefined;
      }

      return edit;
    });
    const gateway = new TauriLanguageServerFeaturesGateway(
      invokeCommand,
      () => true,
      JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS,
    );

    await expect(gateway.willCreateFiles("/project", "/project/src/User.ts")).resolves.toEqual(
      edit,
    );
    await expect(
      gateway.didCreateFiles("/project", "/project/src/User.ts"),
    ).resolves.toBeUndefined();
    await expect(gateway.willDeleteFiles("/project", "/project/src/User.ts")).resolves.toEqual(
      edit,
    );
    await expect(
      gateway.didDeleteFiles("/project", "/project/src/User.ts"),
    ).resolves.toBeUndefined();

    expect(invokeCommand).toHaveBeenCalledWith(
      "javascript_typescript_workspace_will_create_files",
      {
        path: "/project/src/User.ts",
        rootPath: "/project",
      },
    );
    expect(invokeCommand).toHaveBeenCalledWith("javascript_typescript_workspace_did_create_files", {
      path: "/project/src/User.ts",
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith(
      "javascript_typescript_workspace_will_delete_files",
      {
        path: "/project/src/User.ts",
        rootPath: "/project",
      },
    );
    expect(invokeCommand).toHaveBeenCalledWith("javascript_typescript_workspace_did_delete_files", {
      path: "/project/src/User.ts",
      rootPath: "/project",
    });
  });

  it("classifies every prioritised feature for both language servers", () => {
    for (const feature of INTERACTIVE_LANGUAGE_SERVER_FEATURES) {
      expect(languageServerRequestPriority(JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS[feature])).toBe(
        "interactive",
      );
      expect(DECORATIVE_LANGUAGE_SERVER_FEATURES).not.toContain(feature);
    }
    for (const feature of DECORATIVE_LANGUAGE_SERVER_FEATURES) {
      expect(languageServerRequestPriority(JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS[feature])).toBe(
        "decorative",
      );
    }
    expect(languageServerRequestPriority("cancel_lsp_request")).toBe("cancellation");
    expect(languageServerRequestPriority(JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS.formatting)).toBe(
      "immediate",
    );
    expect(languageServerRequestPriority("text_document_completion")).toBe("interactive");
    expect(languageServerRequestPriority("text_document_document_highlights")).toBe("decorative");
  });

  it("defers decorative traffic behind an in-flight interactive request", async () => {
    const settleDefinition: Array<() => void> = [];
    const invokeCommand = vi.fn<InvokeCommand>(async (command) => {
      if (!command.endsWith("_definition")) {
        return [];
      }
      await new Promise<void>((resolve) => settleDefinition.push(resolve));
      return [];
    });
    const gateway = new TauriLanguageServerFeaturesGateway(
      invokeCommand,
      () => true,
      JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS,
    );

    const definition = gateway.definition("/project", position(), 21);
    const highlights = gateway.documentHighlights("/project", position(), 21);
    await Promise.resolve();

    expect(invokeCommand).toHaveBeenCalledTimes(1);
    expect(invokeCommand).toHaveBeenCalledWith(
      "javascript_typescript_text_document_definition",
      expect.anything(),
    );

    settleDefinition.forEach((settle) => settle());
    await Promise.all([definition, highlights]);
    expect(invokeCommand).toHaveBeenCalledTimes(2);
  });

  it("sends exact JS/TS session and scheduler request authority for decorative IPC", async () => {
    const invokeCommand = vi.fn<InvokeCommand>(async () => []);
    const gateway = new TauriLanguageServerFeaturesGateway(
      invokeCommand,
      () => true,
      JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS,
      "javascriptTypeScript",
    );
    const requests = [
      {
        args: { path: "/project/src/User.ts", rootPath: "/project" },
        command: JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS.codeLenses,
        request: () => gateway.codeLenses("/project", "/project/src/User.ts", 41),
      },
      {
        args: { lens: codeLens(), rootPath: "/project" },
        command: JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS.codeLensResolve,
        request: () => gateway.resolveCodeLens("/project", codeLens(), 41),
      },
      {
        args: { path: "/project/src/User.ts", range: range(), rootPath: "/project" },
        command: JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS.inlayHints,
        request: () => gateway.inlayHints("/project", "/project/src/User.ts", range(), 41),
      },
      {
        args: { hint: inlayHint(), rootPath: "/project" },
        command: JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS.inlayHintResolve,
        request: () => gateway.resolveInlayHint("/project", inlayHint(), 41),
      },
    ];

    for (const { args, command, request: createRequest } of requests) {
      const request = createRequest();
      await request;
      expect(request.sessionId).toBe(41);
      expect(invokeCommand).toHaveBeenCalledWith(command, {
        ...args,
        requestId: request.requestId,
        sessionId: 41,
      });
    }
  });

  it("cancels a deferred decorative request without reaching the language server", async () => {
    const settleDefinition: Array<() => void> = [];
    const invokeCommand = vi.fn<InvokeCommand>(async (command) => {
      if (!command.endsWith("_definition")) {
        return [];
      }
      await new Promise<void>((resolve) => settleDefinition.push(resolve));
      return [];
    });
    const gateway = new TauriLanguageServerFeaturesGateway(
      invokeCommand,
      () => true,
      JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS,
      "javascriptTypeScript",
    );

    const definition = gateway.definition("/project", position(), 21);
    const highlights = gateway.documentHighlights("/project", position(), 21);
    await gateway.cancelRequest("/project", 21, highlights.requestId);

    await expect(highlights).resolves.toEqual([]);
    expect(invokeCommand).not.toHaveBeenCalledWith("cancel_lsp_request", expect.anything());
    expect(invokeCommand).not.toHaveBeenCalledWith(
      "javascript_typescript_text_document_document_highlights",
      expect.anything(),
    );

    settleDefinition.forEach((settle) => settle());
    await definition;
    expect(invokeCommand).not.toHaveBeenCalledWith(
      "javascript_typescript_text_document_document_highlights",
      expect.anything(),
    );
  });

  it("cancels a released decorative request through its dispatched wire identifier", async () => {
    const settleDefinition: Array<() => void> = [];
    const settleHighlights: Array<() => void> = [];
    const invokeCommand = vi.fn<InvokeCommand>(async (command) => {
      if (command.endsWith("_definition")) {
        await new Promise<void>((resolve) => settleDefinition.push(resolve));
        return [];
      }
      if (command.endsWith("_document_highlights")) {
        await new Promise<void>((resolve) => settleHighlights.push(resolve));
        return [];
      }
      return [];
    });
    const gateway = new TauriLanguageServerFeaturesGateway(
      invokeCommand,
      () => true,
      JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS,
      "javascriptTypeScript",
    );

    const definition = gateway.definition("/project", position(), 21);
    const highlights = gateway.documentHighlights("/project", position(), 21);
    settleDefinition.forEach((settle) => settle());
    await definition;
    await Promise.resolve();

    const dispatched = invokeCommand.mock.calls.find(([command]) =>
      command.endsWith("_document_highlights"),
    );
    const dispatchedRequestId = (dispatched?.[1] as { requestId: number }).requestId;
    expect(dispatchedRequestId).not.toBe(highlights.requestId);

    await gateway.cancelRequest("/project", 21, highlights.requestId);
    expect(invokeCommand).toHaveBeenCalledWith("cancel_lsp_request", {
      requestId: dispatchedRequestId,
      rootPath: "/project",
      serverKind: "javascriptTypeScript",
      sessionId: 21,
    });

    settleHighlights.forEach((settle) => settle());
    await highlights;
  });

  it("isolates same-root scheduler and cancellation authority across session generations", async () => {
    const settleOldDefinition: Array<() => void> = [];
    const invokeCommand = vi.fn<InvokeCommand>(async (command, args) => {
      if (command.endsWith("_definition") && args?.sessionId === 21) {
        await new Promise<void>((resolve) => settleOldDefinition.push(resolve));
      }
      return [];
    });
    const gateway = new TauriLanguageServerFeaturesGateway(
      invokeCommand,
      () => true,
      JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS,
      "javascriptTypeScript",
    );

    const oldDefinition = gateway.definition("/project", position(), 21);
    const oldHighlights = gateway.documentHighlights("/project", position(), 21);
    const oldInlayHints = gateway.inlayHints("/project", "/project/src/User.ts", range(), 21);
    await gateway.cancelRequest("/project", 22, oldHighlights.requestId);
    expect(invokeCommand).not.toHaveBeenCalledWith("cancel_lsp_request", expect.anything());

    const replacementHighlights = gateway.documentHighlights("/project", position(), 22);
    const replacementInlayHints = gateway.inlayHints(
      "/project",
      "/project/src/User.ts",
      range(),
      22,
    );
    await Promise.all([replacementHighlights, replacementInlayHints]);
    const returnedHighlights = gateway.documentHighlights("/project", position(), 23);
    await returnedHighlights;

    expect(invokeCommand).toHaveBeenCalledWith(
      "javascript_typescript_text_document_document_highlights",
      expect.objectContaining({ rootPath: "/project", sessionId: 22 }),
    );
    expect(invokeCommand).toHaveBeenCalledWith(
      "javascript_typescript_text_document_document_highlights",
      expect.objectContaining({ rootPath: "/project", sessionId: 23 }),
    );
    expect(invokeCommand).not.toHaveBeenCalledWith(
      "javascript_typescript_text_document_document_highlights",
      expect.objectContaining({ sessionId: 21 }),
    );
    expect(
      invokeCommand.mock.calls.filter(([command]) =>
        command.endsWith("_text_document_inlay_hints"),
      ),
    ).toHaveLength(1);

    await expect(oldHighlights).resolves.toEqual([]);

    settleOldDefinition.forEach((settle) => settle());
    await oldDefinition;
    await oldInlayHints;
    expect(
      invokeCommand.mock.calls.filter(([command]) =>
        command.endsWith("_text_document_inlay_hints"),
      ),
    ).toHaveLength(1);
  });

  it("preserves live dispatched cancellation while ordinary immediate traffic is saturated", async () => {
    const definitionOwner = deferredPromise();
    const highlightsOwner = deferredPromise();
    const immediateOwner = deferredPromise();
    const invokeCommand = vi.fn<InvokeCommand>(async (command) => {
      if (command.endsWith("_definition")) await definitionOwner.promise;
      if (command.endsWith("_document_highlights")) await highlightsOwner.promise;
      if (command.endsWith("_document_symbols")) await immediateOwner.promise;
      return [];
    });
    const gateway = new TauriLanguageServerFeaturesGateway(
      invokeCommand,
      () => true,
      JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS,
      "javascriptTypeScript",
    );

    const definition = gateway.definition("/project", position(), 31);
    const highlights = gateway.documentHighlights("/project", position(), 31);
    definitionOwner.resolve();
    await definition;
    await Promise.resolve();
    const dispatched = invokeCommand.mock.calls.find(([command]) =>
      command.endsWith("_document_highlights"),
    );
    const wireRequestId = (dispatched?.[1] as { requestId: number }).requestId;
    expect(wireRequestId).not.toBe(highlights.requestId);

    const immediate = Array.from({ length: 64 }, (_, index) =>
      gateway.documentSymbols("/project", `/project/src/file-${index}.ts`),
    );
    await gateway.cancelRequest("/project", 31, highlights.requestId);
    expect(invokeCommand).toHaveBeenCalledWith("cancel_lsp_request", {
      requestId: wireRequestId,
      rootPath: "/project",
      serverKind: "javascriptTypeScript",
      sessionId: 31,
    });

    highlightsOwner.resolve();
    immediateOwner.resolve();
    await Promise.all([highlights, ...immediate]);
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

function deferredPromise() {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
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

function codeLens() {
  return {
    command: null,
    data: { kind: "references" },
    range: range(),
  };
}

function inlayHint() {
  return {
    data: { hintId: 1 },
    kind: 1,
    label: ": User",
    paddingLeft: true,
    paddingRight: false,
    position: { character: 8, line: 10 },
    tooltip: "Inferred type",
  };
}

function callHierarchyItem(name = "handleClick") {
  return {
    data: { id: name },
    detail: "src/User.php",
    kind: 12,
    name,
    range: range(),
    selectionRange: range(),
    tags: [1],
    uri: "file:///project/src/User.php",
  };
}

function typeHierarchyItem(name = "User") {
  return {
    data: { id: name },
    detail: "src/User.php",
    kind: 5,
    name,
    range: range(),
    selectionRange: range(),
    tags: [1],
    uri: "file:///project/src/User.php",
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
