import { ShortcutsSection, UpdatesSection, useUpdater } from "@pziel/pureui";
import { createRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { RowLimitSection } from "@/components/settings/row-limit-section";
import { ThemeSection } from "@/components/settings/theme-section";
import { useSettings } from "@/lib/settings/settings-context";
import { SHORTCUT_ACTIONS, type ShortcutScope } from "@/lib/shortcuts/registry";
import { findConflict, resolveShortcuts } from "@/lib/shortcuts/resolve";
import { createSonnerUpdateToastSink } from "@/lib/updater/update-toast-sink";
import { rootRoute } from "@/routes/__root";

const SCOPE_LABELS: Record<ShortcutScope, string> = {
  global: "Global",
  tab: "Tabs",
  grid: "Data grid",
  tree: "Sidebar",
  editor: "Query editor",
};

const SCOPE_ORDER: ShortcutScope[] = [
  "global",
  "tab",
  "grid",
  "tree",
  "editor",
];

function ShortcutSettings() {
  const {
    settings,
    addShortcut,
    removeShortcut,
    replaceShortcut,
    resetShortcut,
  } = useSettings();

  const groups = SCOPE_ORDER.map((scope) => ({
    label: SCOPE_LABELS[scope],
    actions: SHORTCUT_ACTIONS.filter((action) => action.scope === scope),
  }));

  return (
    <ShortcutsSection
      actions={SHORTCUT_ACTIONS}
      effective={resolveShortcuts(settings.shortcuts)}
      overrides={settings.shortcuts}
      store={{
        add: addShortcut,
        remove: removeShortcut,
        replace: replaceShortcut,
        reset: resetShortcut,
      }}
      findConflict={findConflict}
      groups={groups}
      help={
        <>
          Press Edit and type a new combination. Escape cancels recording, so it
          cannot be assigned.
        </>
      }
    />
  );
}

function SettingsPage() {
  const { controller, getVersion } = useUpdater();
  const [sink] = useState(createSonnerUpdateToastSink);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-baseline gap-3">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <Link to="/" className="text-sm text-muted-foreground underline">
          Back to workspace
        </Link>
      </div>
      <ThemeSection />
      <RowLimitSection />
      <ShortcutSettings />
      <UpdatesSection
        controller={controller}
        getVersion={getVersion}
        sink={sink}
        notify={{ info: toast, error: toast.error }}
      />
    </div>
  );
}

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});
