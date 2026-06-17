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
    const invokeCommand = vi.fn<InvokeCommand>(async (command) => {
      if (command === "text_document_hover") {
        return hover;
      }

      if (command === "text_document_completion") {
        return completion;
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
  });
});

function position(): LanguageServerTextDocumentPosition {
  return {
    character: 4,
    line: 10,
    path: "/project/src/User.php",
  };
}
