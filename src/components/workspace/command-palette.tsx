import { formatForDisplay } from "@tanstack/react-hotkeys";
import {
  useChrome,
  useJsonView,
  useStructureView,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { useThemeToggle } from "@/lib/theme/theme-context";
import {
  PALETTE_COMMANDS,
  PALETTE_GROUP_ORDER,
  type PaletteCommandId,
} from "@/components/workspace/command-registry";
import { useSettingsOptional } from "@/lib/settings/settings-context";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { resolveShortcuts } from "@/lib/shortcuts/resolve";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";

type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNewFolder: () => void;
};

export function CommandPalette({
  open,
  onOpenChange,
  onNewFolder,
}: CommandPaletteProps) {
  const {
    openTabIds,
    activeTabId,
    activeNode,
    activeDatabaseTab,
    setActiveTab,
    closeTab,
    closeOtherTabs,
    closeAllTabs,
    newTab,
    addDatabase,
    toggleSplitOrientation,
  } = useWorkspace();
  const { toggleSidebar, toggleConsole } = useChrome();
  const { toggleJsonView } = useJsonView();
  const { toggleStructureView } = useStructureView();
  const toggleTheme = useThemeToggle();

  const cycleTab = (step: number) => {
    if (openTabIds.length === 0) {
      return;
    }
    const current = activeTabId !== null ? openTabIds.indexOf(activeTabId) : -1;
    const length = openTabIds.length;
    const next = (((current + step) % length) + length) % length;
    setActiveTab(openTabIds[next]);
  };

  const closeActiveTab = () => {
    if (activeTabId === null) {
      return;
    }
    closeTab(activeTabId);
  };

  const closeOthers = () => {
    if (activeTabId === null) {
      return;
    }
    closeOtherTabs(activeTabId);
  };

  const handlers: Record<PaletteCommandId, () => void> = {
    "new-database": addDatabase,
    "new-folder": onNewFolder,
    "close-tab": closeActiveTab,
    "close-other-tabs": closeOthers,
    "close-all-tabs": closeAllTabs,
    "next-tab": () => cycleTab(1),
    "prev-tab": () => cycleTab(-1),
    "new-tab": newTab,
    "toggle-split-orientation": toggleSplitOrientation,
    "toggle-sidebar": toggleSidebar,
    "toggle-console": toggleConsole,
    "toggle-theme": toggleTheme,
    "toggle-json-view": toggleJsonView,
    "toggle-structure-view": toggleStructureView,
  };

  const shortcuts =
    useSettingsOptional()?.settings.shortcuts ?? DEFAULT_SETTINGS.shortcuts;
  const effective = resolveShortcuts(shortcuts);

  const isSplitView =
    activeNode?.kind === "database" &&
    (activeDatabaseTab === "sql" ||
      activeDatabaseTab === "query" ||
      activeDatabaseTab === "script");
  const isTableActive = activeNode?.kind === "table";
  const state = {
    openTabCount: openTabIds.length,
    isSplitView,
    isTableActive,
  };
  const commands = PALETTE_COMMANDS.filter((def) => def.when(state));

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command…" />
      <CommandList>
        <CommandEmpty>No matching commands</CommandEmpty>
        {PALETTE_GROUP_ORDER.map((group) => {
          const groupCommands = commands.filter((def) => def.group === group);
          if (groupCommands.length === 0) {
            return null;
          }
          return (
            <CommandGroup key={group} heading={group}>
              {groupCommands.map((def) => (
                <CommandItem
                  key={def.id}
                  value={def.name}
                  onSelect={() => {
                    handlers[def.id]();
                    onOpenChange(false);
                  }}
                >
                  <span>{def.name}</span>
                  {def.actionId && (
                    <CommandShortcut>
                      {formatForDisplay(effective[def.actionId])}
                    </CommandShortcut>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}
