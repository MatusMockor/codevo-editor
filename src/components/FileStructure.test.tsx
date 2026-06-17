// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PhpFileOutline,
  PhpFileOutlineNode,
} from "../domain/phpFileOutline";
import { FileStructure } from "./FileStructure";

describe("FileStructure", () => {
  let host: HTMLDivElement;
  let root: Root;
  let scrollIntoView: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("scrolls the selected symbol when navigating with arrow keys", async () => {
    await renderFileStructure();
    scrollIntoView.mockClear();

    await act(async () => {
      searchInput().dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "ArrowDown",
        }),
      );
    });

    const options = symbolOptions();

    expect(options[1].className).toContain("active");
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("closes with Escape even when focus is on the inherited-members checkbox", async () => {
    const onClose = vi.fn();
    await renderFileStructure({ onClose });

    await act(async () => {
      checkbox().dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Escape",
        }),
      );
    });

    expect(onClose).toHaveBeenCalledOnce();
  });

  async function renderFileStructure(
    overrides: Partial<{
      onClose: () => void;
    }> = {},
  ) {
    await act(async () => {
      root.render(
        <FileStructure
          canIncludeInheritedMembers={true}
          fileName="LocalUser.php"
          isLoading={false}
          isOpen={true}
          onChangeScope={vi.fn()}
          onClose={overrides.onClose ?? vi.fn()}
          onOpenNode={vi.fn()}
          outline={outline()}
          scope="inherited"
        />,
      );
      await Promise.resolve();
    });
  }

  function searchInput(): HTMLInputElement {
    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="Search symbols"]',
    );

    if (!input) {
      throw new Error("Search input was not rendered.");
    }

    return input;
  }

  function checkbox(): HTMLInputElement {
    const input = host.querySelector<HTMLInputElement>('input[type="checkbox"]');

    if (!input) {
      throw new Error("Inherited members checkbox was not rendered.");
    }

    return input;
  }

  function symbolOptions(): HTMLButtonElement[] {
    return Array.from(
      host.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    );
  }
});

function outline(): PhpFileOutline {
  return {
    nodes: [
      node({
        children: [
          node({ id: "method-valid", label: "isValid", lineNumber: 10 }),
          node({ id: "method-empty", label: "isEmpty", lineNumber: 20 }),
          node({ id: "method-enabled", label: "isEnabled", lineNumber: 30 }),
        ],
        id: "class-local-user",
        kind: "class",
        label: "LocalUser",
      }),
    ],
  };
}

function node(
  overrides: Partial<PhpFileOutlineNode> & {
    id: string;
    label: string;
  },
): PhpFileOutlineNode {
  const { id, label, ...rest } = overrides;

  return {
    children: [],
    column: 3,
    fullyQualifiedName: `App\\LocalUser::${label}`,
    id,
    kind: "method",
    label,
    lineNumber: 1,
    path: "/workspace/app/LocalUser.php",
    relativePath: "app/LocalUser.php",
    ...rest,
  };
}
