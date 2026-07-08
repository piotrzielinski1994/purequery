type GuardTarget = {
  addEventListener: (type: string, listener: (event: Event) => void) => void;
  removeEventListener: (type: string, listener: (event: Event) => void) => void;
};

// Suppresses the native browser context menu (Reload / Inspect Element / ...) app-wide - a desktop
// app should never show it. The app's own radix context menus are unaffected: they draw their menu
// and preventDefault on the trigger before this window-level (bubble-phase) guard runs, so this only
// swallows the native menu where no app menu handled the right-click. Returns a cleanup that
// detaches the listener. Mirrors vidui's browser-defaults (context-menu slice only).
export function installBrowserDefaultGuards(target: GuardTarget): () => void {
  const onContextMenu = (event: Event) => event.preventDefault();
  target.addEventListener("contextmenu", onContextMenu);
  return () => {
    target.removeEventListener("contextmenu", onContextMenu);
  };
}
