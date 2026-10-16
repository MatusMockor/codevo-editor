import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import type { XtermTerminal } from "../terminalSession";
import type { XtermScreen } from "./useXtermHost";

export function xtermTerminalPort(screen: XtermScreen): XtermTerminal {
  const { terminal } = screen;

  return {
    get cols() {
      return terminal.cols;
    },
    get rows() {
      return terminal.rows;
    },
    attachCustomKeyEventHandler: (handler) => terminal.attachCustomKeyEventHandler(handler),
    dispose: () => screen.dispose(),
    loadAddon: (addon) => terminal.loadAddon(addon as FitAddon),
    onData: (listener) => terminal.onData(listener),
    onResize: (listener) => terminal.onResize(listener),
    open: (container) => terminal.open(container),
    get buffer() {
      return terminal.buffer;
    },
    registerLinkProvider: (provider) => terminal.registerLinkProvider(provider),
    registerMarker: (cursorYOffset) => terminal.registerMarker(cursorYOffset),
    registerDecoration: (options) => {
      const decoration = terminal.registerDecoration({
        marker: options.marker as ReturnType<Terminal["registerMarker"]>,
      });

      if (!decoration) {
        return undefined;
      }

      decoration.onRender((element) => {
        element.classList.add("terminal-command-decoration");
        element.style.backgroundColor = options.backgroundColor;
        element.title = options.tooltip;

        if (!options.foregroundColor) {
          return;
        }

        element.style.color = options.foregroundColor;
      });

      return decoration;
    },
    scrollToLine: (line) => terminal.scrollToLine(line),
    write: (data, callback) => terminal.write(data, callback),
  };
}
