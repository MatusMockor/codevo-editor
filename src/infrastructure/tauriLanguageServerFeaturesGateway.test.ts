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
    await expect(gateway.definition("/project", position())).resolves.toEqual([]);
    await expect(gateway.implementation("/project", position())).resolves.toEqual([]);
    await expect(gateway.references("/project", position())).resolves.toEqual([]);
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
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("delegates feature commands inside Tauri", async () => {
    const hover = { contents: "Hover text" };
    const completion = {
      isIncomplete: false,
      items: [
        {
          detail: null,
          documentation: null,
          insertText: null,
          kind: 7,
          label: "User",
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
    const invokeCommand = vi.fn<InvokeCommand>(async (command) => {
      if (command === "text_document_hover") {
        return hover;
      }

      if (command === "text_document_completion") {
        return completion;
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

      return definition;
    });
    const gateway = new TauriLanguageServerFeaturesGateway(
      invokeCommand,
      () => true,
    );
    const requestPosition = position();

    await expect(gateway.hover("/project", requestPosition)).resolves.toEqual(hover);
    await expect(gateway.completion("/project", requestPosition)).resolves.toEqual(completion);
    await expect(gateway.definition("/project", requestPosition)).resolves.toEqual(definition);
    await expect(gateway.implementation("/project", requestPosition)).resolves.toEqual(
      definition,
    );
    await expect(gateway.references("/project", requestPosition)).resolves.toEqual(
      definition,
    );
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
    expect(invokeCommand).toHaveBeenCalledWith("text_document_hover", {
      position: requestPosition,
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_completion", {
      position: requestPosition,
      rootPath: "/project",
    });
    expect(invokeCommand).toHaveBeenCalledWith("text_document_definition", {
      position: requestPosition,
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
