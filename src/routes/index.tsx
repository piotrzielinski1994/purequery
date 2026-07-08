import { useCallback } from "react";
import { createRoute } from "@tanstack/react-router";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { useSettings } from "@/lib/settings/settings-context";
import type { Settings } from "@/lib/settings/settings";
import { useWorkspaceStore } from "@/lib/workspace/workspace-store-context";
import { rootRoute } from "@/routes/__root";

export function HomePage() {
  const { settings, saveChrome } = useSettings();
  const { tree, persistTree } = useWorkspaceStore();

  // The workspace persists only the UI-chrome slice of Settings. saveChrome is a WRITE-ONLY store
  // save (no setSettings), so a sidebar/console toggle never re-renders the settings tree - it
  // merges over the current theme/shortcuts/windowFullscreen internally. Stable identity
  // ([saveChrome] only), so it never re-fires the provider's persist effect. (Chrome is only ever
  // read as the initial seed.)
  const persistChrome = useCallback(
    (next: Omit<Settings, "theme" | "shortcuts" | "windowFullscreen">) =>
      saveChrome(next),
    [saveChrome],
  );

  return (
    <WorkspaceProvider
      tree={tree}
      onTreeChange={persistTree}
      initialExpandedIds={settings.expandedIds}
      initialOpenTabIds={settings.openTabIds}
      initialActiveTabId={settings.activeTabId ?? undefined}
      initialSidebarHidden={settings.sidebarHidden}
      initialConsoleHidden={settings.consoleHidden}
      initialSplitOrientation={settings.splitOrientation}
      initialLayouts={settings.layouts}
      onPersist={persistChrome}
    >
      <WorkspaceLayout />
    </WorkspaceProvider>
  );
}

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});
