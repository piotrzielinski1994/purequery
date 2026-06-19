export type PaletteCommandId =
  | "close-tab"
  | "close-all-tabs"
  | "next-tab"
  | "prev-tab"
  | "new-tab";

export type PaletteState = {
  openTabCount: number;
};

export type PaletteCommandDef = {
  id: PaletteCommandId;
  name: string;
  hint?: string;
  when: (state: PaletteState) => boolean;
};

const hasTabs = (state: PaletteState) => state.openTabCount >= 1;
const hasMultipleTabs = (state: PaletteState) => state.openTabCount >= 2;

export const PALETTE_COMMANDS: readonly PaletteCommandDef[] = [
  { id: "close-tab", name: "Close tab", hint: "Ctrl+W", when: hasTabs },
  { id: "close-all-tabs", name: "Close all tabs", when: hasTabs },
  { id: "next-tab", name: "Next tab", hint: "Tab", when: hasMultipleTabs },
  {
    id: "prev-tab",
    name: "Previous tab",
    hint: "Shift+Tab",
    when: hasMultipleTabs,
  },
  { id: "new-tab", name: "New tab", when: () => true },
];
