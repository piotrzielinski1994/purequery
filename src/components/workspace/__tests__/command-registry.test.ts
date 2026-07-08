import { describe, it, expect } from "vitest";

import {
  PALETTE_COMMANDS,
  type PaletteState,
} from "@/components/workspace/command-registry";

const baseState: PaletteState = {
  openTabCount: 1,
  isSplitView: false,
  isTableActive: false,
};

function splitCommand() {
  const command = PALETTE_COMMANDS.find(
    (def) => def.id === "toggle-split-orientation",
  );
  if (!command) {
    throw new Error("toggle-split-orientation command not registered");
  }
  return command;
}

describe("toggle-split-orientation palette command", () => {
  // The command is gated on a split view; the Script/SQL/Query tabs all set isSplitView, so it must
  // show there and hide elsewhere (regression: it was SQL-only and never appeared on the Script tab).
  it("should be visible when a split view is active", () => {
    expect(splitCommand().when({ ...baseState, isSplitView: true })).toBe(true);
  });

  it("should be hidden when no split view is active", () => {
    expect(splitCommand().when({ ...baseState, isSplitView: false })).toBe(
      false,
    );
  });
});
