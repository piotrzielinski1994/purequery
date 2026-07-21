import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { RowLimitSection } from "@/components/settings/row-limit-section";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings/settings";
import { SettingsProvider } from "@/lib/settings/settings-context";

function renderSection(rowLimit = DEFAULT_SETTINGS.rowLimit) {
  const seeded: Settings = { ...DEFAULT_SETTINGS, rowLimit };
  const store = createInMemorySettingsStore(seeded);
  render(
    <SettingsProvider store={store}>
      <RowLimitSection />
    </SettingsProvider>,
  );
  return { store };
}

describe("RowLimitSection", () => {
  // behavior: the input seeds from the persisted rowLimit
  it("should seed the input with the persisted rowLimit", async () => {
    renderSection(350);

    const input = await screen.findByLabelText<HTMLInputElement>(/row limit/i);
    expect(input.value).toBe("350");
  });

  // behavior: committing a new positive integer persists it
  it("should persist a new positive-integer rowLimit on blur", async () => {
    const user = userEvent.setup();
    const { store } = renderSection(200);

    const input = await screen.findByLabelText(/row limit/i);
    await user.clear(input);
    await user.type(input, "500");
    await user.tab();

    await waitFor(async () => {
      expect((await store.load()).rowLimit).toBe(500);
    });
  });

  // behavior: an invalid value reverts to the current setting and is not persisted
  it("should revert to the current rowLimit if the value is not a positive integer", async () => {
    const user = userEvent.setup();
    const { store } = renderSection(200);

    const input = await screen.findByLabelText<HTMLInputElement>(/row limit/i);
    await user.clear(input);
    await user.type(input, "0");
    await user.tab();

    await waitFor(() => {
      expect(input.value).toBe("200");
    });
    expect((await store.load()).rowLimit).toBe(200);
  });
});
