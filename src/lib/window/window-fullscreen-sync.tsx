import { useSettings } from "@/lib/settings/settings-context";
import { useWindowFullscreenSync } from "@/lib/window/use-window-fullscreen-sync";
import type { WindowController } from "@/lib/window/window-controller";

// Mount-only bridge: feeds the persisted `windowFullscreen` flag + its saver into
// the sync hook. Renders nothing. Lives inside the SettingsProvider.
export function WindowFullscreenSync({
  controller,
}: {
  controller: WindowController;
}) {
  const { settings, saveWindowFullscreen } = useSettings();
  useWindowFullscreenSync({
    controller,
    saved: settings.windowFullscreen,
    onSave: saveWindowFullscreen,
  });
  return null;
}
