import { useWorkspace } from "@/components/workspace/workspace-context";
import {
  PALETTE_COMMANDS,
  type PaletteCommandId,
} from "@/components/workspace/command-registry";
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";

type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const {
    openTabIds,
    activeTabId,
    setActiveTab,
    closeTab,
    closeAllTabs,
    newTab,
  } = useWorkspace();

  const cycleTab = (step: number) => {
    if (openTabIds.length === 0) {
      return;
    }
    const current =
      activeTabId !== null ? openTabIds.indexOf(activeTabId) : -1;
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

  const handlers: Record<PaletteCommandId, () => void> = {
    "close-tab": closeActiveTab,
    "close-all-tabs": closeAllTabs,
    "next-tab": () => cycleTab(1),
    "prev-tab": () => cycleTab(-1),
    "new-tab": newTab,
  };

  const state = { openTabCount: openTabIds.length };
  const commands = PALETTE_COMMANDS.filter((def) => def.when(state));

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command…" />
      <CommandList>
        <CommandEmpty>No matching commands</CommandEmpty>
        {commands.map((def) => (
          <CommandItem
            key={def.id}
            value={def.name}
            onSelect={() => {
              handlers[def.id]();
              onOpenChange(false);
            }}
          >
            <span>{def.name}</span>
            {def.hint && <CommandShortcut>{def.hint}</CommandShortcut>}
          </CommandItem>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
