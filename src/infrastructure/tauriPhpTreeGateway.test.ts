import { describe, expect, it, vi } from "vitest";
import type { PhpTree } from "../domain/phpTree";
import { TauriPhpTreeGateway } from "./tauriPhpTreeGateway";

type PhpTreeGatewayConstructor = ConstructorParameters<typeof TauriPhpTreeGateway>;
type InvokeCommand = NonNullable<PhpTreeGatewayConstructor[0]>;

describe("TauriPhpTreeGateway", () => {
  it("returns an empty tree outside Tauri", async () => {
    const invokeCommand = vi.fn<InvokeCommand>();
    const gateway = new TauriPhpTreeGateway(invokeCommand, () => false);

    await expect(gateway.getPhpTree("/workspace")).resolves.toEqual({
      nodes: [],
    });
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("delegates tree loading inside Tauri", async () => {
    const tree: PhpTree = {
      nodes: [
        {
          children: [],
          column: 5,
          fullyQualifiedName: "App\\Domain\\User",
          id: "symbol:App\\Domain\\User",
          kind: "class",
          label: "User",
          lineNumber: 12,
          path: "/workspace/src/User.php",
          relativePath: "src/User.php",
        },
      ],
    };
    const invokeCommand = vi.fn<InvokeCommand>(async () => tree);
    const gateway = new TauriPhpTreeGateway(invokeCommand, () => true);

    await expect(gateway.getPhpTree("/workspace")).resolves.toEqual(tree);
    expect(invokeCommand).toHaveBeenCalledWith("get_php_tree", {
      root: "/workspace",
    });
  });
});
