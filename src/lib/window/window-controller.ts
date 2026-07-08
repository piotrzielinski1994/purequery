import { getCurrentWindow } from "@tauri-apps/api/window";

// Port for the native window's fullscreen state. Browser/test builds use the
// noop; the native build wraps the current Tauri window. Kept behind a port so
// the window-state sync hook stays unit-testable without a real webview.
export type WindowController = {
  isFullscreen: () => Promise<boolean>;
  setFullscreen: (fullscreen: boolean) => Promise<void>;
  // Notifies with the NEW fullscreen value whenever it changes; returns an
  // unsubscribe. Tauri has no dedicated fullscreen event, so changes are derived
  // from the window resize stream (filtered to actual flips).
  onFullscreenChange: (
    listener: (fullscreen: boolean) => void,
  ) => Promise<() => void>;
};

// The slice of the Tauri Window we depend on - narrowed so a fake can stand in.
export type TauriWindow = {
  isFullscreen: () => Promise<boolean>;
  setFullscreen: (fullscreen: boolean) => Promise<void>;
  onResized: (handler: () => void) => Promise<() => void>;
};

export function createWindowController(
  getWindow: () => TauriWindow = getCurrentWindow,
): WindowController {
  const win = getWindow();
  return {
    isFullscreen: () => win.isFullscreen(),
    setFullscreen: (fullscreen) => win.setFullscreen(fullscreen),
    onFullscreenChange: async (listener) => {
      let last = await win.isFullscreen();
      return win.onResized(() => {
        win.isFullscreen().then((current) => {
          if (current === last) {
            return;
          }
          last = current;
          listener(current);
        });
      });
    },
  };
}

export function createNoopWindowController(): WindowController {
  return {
    isFullscreen: () => Promise.resolve(false),
    setFullscreen: () => Promise.resolve(),
    onFullscreenChange: () => Promise.resolve(() => {}),
  };
}
