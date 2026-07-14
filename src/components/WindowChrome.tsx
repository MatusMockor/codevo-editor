import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Command, CommandContext } from "../application/commandRegistry";
import { detectKeymapPlatform } from "../domain/keymap";
import type { KeymapPlatform } from "../domain/keymap";

interface WindowChromeProps {
  appTitle: string;
  commands: Command[];
  commandContext: CommandContext;
  onCommandError(error: unknown): void;
  onQuitApplication(): void;
}

type WindowMenuKey = "edit" | "file" | "view";

interface WindowMenuItem {
  disabled?: boolean;
  label: string;
  onSelect(): void | Promise<void>;
  separatorBefore?: boolean;
  shortcut?: string;
}

export function WindowChrome({
  appTitle,
  commands,
  commandContext,
  onCommandError,
  onQuitApplication,
}: WindowChromeProps) {
  const [openMenu, setOpenMenu] = useState<WindowMenuKey | null>(null);
  const chromeRef = useRef<HTMLElement | null>(null);
  const platform = detectKeymapPlatform();
  const commandsById = useMemo(
    () => new Map(commands.map((command) => [command.id, command])),
    [commands],
  );
  const menus = useMemo(
    () => ({
      edit: editMenuItems(commandsById, commandContext),
      file: fileMenuItems(
        commandsById,
        commandContext,
        onQuitApplication,
        platform,
      ),
      view: viewMenuItems(commandsById, commandContext),
    }),
    [commandContext, commandsById, onQuitApplication, platform],
  );
  const showNativeControlSpace = platform === "mac";
  const showWindowControls = platform !== "mac";
  const showWindowMenus = platform !== "mac";

  useEffect(() => {
    if (!openMenu) {
      return;
    }

    const closeMenu = (event: MouseEvent) => {
      if (chromeRef.current?.contains(event.target as Node)) {
        return;
      }

      setOpenMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenu(null);
      }
    };

    window.addEventListener("mousedown", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("blur", closeOpenMenu);

    return () => {
      window.removeEventListener("mousedown", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("blur", closeOpenMenu);
    };
  }, [openMenu]);

  function closeOpenMenu() {
    setOpenMenu(null);
  }

  async function runMenuItem(item: WindowMenuItem) {
    if (item.disabled) {
      return;
    }

    setOpenMenu(null);

    try {
      await item.onSelect();
    } catch (error) {
      onCommandError(error);
    }
  }

  async function runWindowAction(action: "close" | "maximize" | "minimize") {
    if (!isTauri()) {
      return;
    }

    const appWindow = getCurrentWindow();

    try {
      if (action === "minimize") {
        await appWindow.minimize();
      } else if (action === "maximize") {
        await appWindow.toggleMaximize();
      } else {
        await appWindow.close();
      }
    } catch (error) {
      onCommandError(error);
    }
  }

  return (
    <header
      className="window-chrome"
      data-platform={platform}
      data-tauri-drag-region=""
      ref={chromeRef}
    >
      <div className="window-chrome-left" data-tauri-drag-region="">
        {showNativeControlSpace ? (
          <span
            aria-hidden="true"
            className="window-native-control-space"
            data-tauri-drag-region=""
          />
        ) : null}
        {showWindowMenus ? (
          <nav aria-label="Application menu" className="window-menu-bar">
            <WindowMenu
              isOpen={openMenu === "file"}
              items={menus.file}
              label="File"
              onOpen={() =>
                setOpenMenu((current) => (current === "file" ? null : "file"))
              }
              onSelectItem={runMenuItem}
            />
            <WindowMenu
              isOpen={openMenu === "edit"}
              items={menus.edit}
              label="Edit"
              onOpen={() =>
                setOpenMenu((current) => (current === "edit" ? null : "edit"))
              }
              onSelectItem={runMenuItem}
            />
            <WindowMenu
              isOpen={openMenu === "view"}
              items={menus.view}
              label="View"
              onOpen={() =>
                setOpenMenu((current) => (current === "view" ? null : "view"))
              }
              onSelectItem={runMenuItem}
            />
          </nav>
        ) : null}
      </div>

      <div className="window-title" data-tauri-drag-region="">
        {appTitle}
      </div>

      <div className="window-chrome-actions" data-tauri-drag-region="">
        {showWindowControls ? (
          <div className="window-controls" aria-label="Window controls">
            <button
              aria-label="Minimize window"
              className="window-control"
              onClick={() => void runWindowAction("minimize")}
              title="Minimize"
              type="button"
            >
              <Minus aria-hidden="true" size={14} strokeWidth={2.2} />
            </button>
            <button
              aria-label="Maximize window"
              className="window-control"
              onClick={() => void runWindowAction("maximize")}
              title="Maximize"
              type="button"
            >
              <Square aria-hidden="true" size={12} strokeWidth={2.2} />
            </button>
            <button
              aria-label="Close window"
              className="window-control window-control-close"
              onClick={() => void runWindowAction("close")}
              title="Close"
              type="button"
            >
              <X aria-hidden="true" size={15} strokeWidth={2.2} />
            </button>
          </div>
        ) : (
          <span
            aria-hidden="true"
            className="window-chrome-action-spacer"
            data-tauri-drag-region=""
          />
        )}
      </div>
    </header>
  );
}

interface WindowMenuProps {
  isOpen: boolean;
  items: WindowMenuItem[];
  label: string;
  onOpen(): void;
  onSelectItem(item: WindowMenuItem): void;
}

function WindowMenu({
  isOpen,
  items,
  label,
  onOpen,
  onSelectItem,
}: WindowMenuProps) {
  return (
    <div className="window-menu-group">
      <button
        aria-expanded={isOpen}
        className={isOpen ? "window-menu-button active" : "window-menu-button"}
        onClick={onOpen}
        type="button"
      >
        {label}
      </button>
      {isOpen ? (
        <div className="window-menu-popover">
          {items.map((item) => (
            <button
              aria-label={item.label}
              className={
                item.separatorBefore
                  ? "window-menu-item separated"
                  : "window-menu-item"
              }
              disabled={item.disabled}
              key={item.label}
              onClick={() => onSelectItem(item)}
              type="button"
            >
              <span>{item.label}</span>
              {item.shortcut ? <kbd>{item.shortcut}</kbd> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function fileMenuItems(
  commandsById: Map<string, Command>,
  context: CommandContext,
  onQuitApplication: () => void,
  platform: KeymapPlatform,
): WindowMenuItem[] {
  return [
    commandMenuItem(commandsById, context, "file.new", "New File"),
    commandMenuItem(commandsById, context, "file.quickOpen", "Quick Open"),
    commandMenuItem(commandsById, context, "editor.save", "Save"),
    commandMenuItem(commandsById, context, "editor.closeTab", "Close", true),
    {
      label: "Quit Codevo Editor",
      onSelect: onQuitApplication,
      separatorBefore: true,
      shortcut: platform === "mac" ? "Cmd+Q" : "Ctrl+Q",
    },
  ];
}

function editMenuItems(
  commandsById: Map<string, Command>,
  context: CommandContext,
): WindowMenuItem[] {
  return [
    commandMenuItem(commandsById, context, "edit.undo", "Undo"),
    commandMenuItem(commandsById, context, "edit.redo", "Redo"),
    commandMenuItem(commandsById, context, "edit.cut", "Cut", true),
    commandMenuItem(commandsById, context, "edit.copy", "Copy"),
    commandMenuItem(commandsById, context, "edit.paste", "Paste"),
    commandMenuItem(commandsById, context, "edit.selectAll", "Select All", true),
  ];
}

function viewMenuItems(
  commandsById: Map<string, Command>,
  context: CommandContext,
): WindowMenuItem[] {
  return [
    commandMenuItem(
      commandsById,
      context,
      "editor.fontZoomIn",
      "Increase Editor Font Size",
    ),
    commandMenuItem(
      commandsById,
      context,
      "editor.fontZoomOut",
      "Decrease Editor Font Size",
    ),
    commandMenuItem(
      commandsById,
      context,
      "editor.fontZoomReset",
      "Reset Editor Font Size",
    ),
    commandMenuItem(
      commandsById,
      context,
      "editor.toggleFontLigatures",
      "Toggle Editor Font Ligatures",
      true,
    ),
    commandMenuItem(
      commandsById,
      context,
      "workbench.openAppearanceSettings",
      "Open Appearance Settings",
      true,
    ),
  ];
}

function commandMenuItem(
  commandsById: Map<string, Command>,
  context: CommandContext,
  id: string,
  fallbackLabel: string,
  separatorBefore = false,
): WindowMenuItem {
  const command = commandsById.get(id);

  return {
    disabled: !command || !command.isEnabled(context),
    label: command?.title ?? fallbackLabel,
    onSelect: () => command?.run(),
    separatorBefore,
    shortcut: command?.shortcut,
  };
}
