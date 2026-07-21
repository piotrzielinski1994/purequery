import { beforeEach, describe, expect, it, vi } from "vitest";

// Themes feature. The Tauri adapter splits theme.colors into a separate
// theme.json store (key "colors"), leaving only theme: { mode } in settings.json.
// On load it recombines theme.colors from theme.json. We fake the
// @tauri-apps/plugin-store LazyStore surface (get/set/save) per-file: the mock
// records every LazyStore instance keyed by its path, so we can assert WHICH file
// each value lands in.

type FakeStore = {
  path: string;
  data: Map<string, unknown>;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

const stores = new Map<string, FakeStore>();

function makeFakeStore(path: string): FakeStore {
  const data = new Map<string, unknown>();
  const store: FakeStore = {
    path,
    data,
    get: vi.fn((key: string) => Promise.resolve(data.get(key))),
    set: vi.fn((key: string, value: unknown) => {
      data.set(key, value);
      return Promise.resolve();
    }),
    save: vi.fn(() => Promise.resolve()),
    delete: vi.fn((key: string) => Promise.resolve(data.delete(key))),
  };
  return store;
}

vi.mock("@tauri-apps/plugin-store", () => ({
  // LazyStore is `new`-ed in the adapter, so the mock must be constructable.
  // We return the SAME fake per path (the adapter constructs one per file), so
  // we can assert which file each value landed in.
  LazyStore: class {
    constructor(path: string) {
      const fake = stores.get(path) ?? makeFakeStore(path);
      stores.set(path, fake);
      return fake as unknown as object;
    }
  },
}));

// The adapter also logs failures through the file logger - keep it inert.
vi.mock("@/lib/logging/file-log", () => ({
  logMessage: vi.fn(),
}));

import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings/settings";
import { createTauriSettingsStore } from "@/lib/settings/tauri-store";

const SETTINGS_FILE = "settings.json";
const THEME_FILE = "theme.json";

// Ensure a fake exists for the given path (the adapter may not construct the
// theme store yet under RED - seeding through here lets the assertion be the
// failure, not a structural undefined-deref).
function ensureStore(path: string): FakeStore {
  const existing = stores.get(path);
  if (existing) {
    return existing;
  }
  const created = makeFakeStore(path);
  stores.set(path, created);
  return created;
}

const settingsStore = () => ensureStore(SETTINGS_FILE);
const themeStore = () => ensureStore(THEME_FILE);

const seededColors: Settings["theme"]["colors"] = {
  light: { tokens: { primary: "oklch(0.55 0.22 27)" }, editor: {} },
  dark: { tokens: {}, editor: { string: "oklch(0.74 0.15 60)" } },
};

beforeEach(() => {
  stores.clear();
});

describe("createTauriSettingsStore theme split (save)", () => {
  // AC-006 - side-effect-contract: on save, colors land in theme.json under "colors".
  it("should write theme.colors to the theme.json store under the colors key", async () => {
    const store = createTauriSettingsStore();
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      theme: { mode: "dark", colors: seededColors },
    };

    await store.save(settings);

    expect(themeStore().data.get("colors")).toEqual(seededColors);
  });

  // AC-003, AC-006 - side-effect-contract: settings.json's theme carries ONLY
  // { mode } (no real color override duplicated into settings.json).
  it("should leave only theme.mode in the settings.json store (no colors)", async () => {
    const store = createTauriSettingsStore();
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      theme: { mode: "dark", colors: seededColors },
    };

    await store.save(settings);

    const persisted = settingsStore().data.get("settings") as
      | Settings
      | undefined;
    expect(persisted).toBeDefined();
    expect(persisted!.theme.mode).toBe("dark");
    // colors are stripped from the settings.json payload OR left as empty sparse
    // maps - either way no real color override is duplicated here.
    expect(persisted!.theme.colors.light.tokens).toEqual({});
    expect(persisted!.theme.colors.dark.editor).toEqual({});
  });

  // AC-006 - side-effect-contract: both stores are persisted so the split is durable.
  it("should call save on both the settings and theme stores", async () => {
    const store = createTauriSettingsStore();

    await store.save({
      ...DEFAULT_SETTINGS,
      theme: { mode: "light", colors: seededColors },
    });

    expect(settingsStore().save).toHaveBeenCalled();
    expect(themeStore().save).toHaveBeenCalled();
  });
});

describe("createTauriSettingsStore theme split (load)", () => {
  // AC-006 - side-effect-contract: on load, theme.json colors recombine into
  // settings.theme.colors.
  it("should recombine theme.colors from the theme.json store on load", async () => {
    const store = createTauriSettingsStore();
    settingsStore().data.set("settings", {
      ...DEFAULT_SETTINGS,
      theme: {
        mode: "dark",
        colors: {
          light: { tokens: {}, editor: {} },
          dark: { tokens: {}, editor: {} },
        },
      },
    });
    themeStore().data.set("colors", seededColors);

    const loaded = await store.load();

    expect(loaded.theme.mode).toBe("dark");
    expect(loaded.theme.colors).toEqual(seededColors);
  });

  // AC-003 / first-launch - behavior: no theme.json yet -> defaults, no throw.
  it("should fall back to empty color overrides if theme.json has no colors", async () => {
    const store = createTauriSettingsStore();
    settingsStore().data.set("settings", {
      ...DEFAULT_SETTINGS,
      theme: { mode: "light", colors: DEFAULT_SETTINGS.theme.colors },
    });
    // no "colors" key set on the theme store.

    const loaded = await store.load();

    expect(loaded.theme.mode).toBe("light");
    expect(loaded.theme.colors).toEqual(DEFAULT_SETTINGS.theme.colors);
  });

  // AC-008 / TC-008 - behavior: garbage in theme.json is tolerated, never throws.
  it("should not throw if theme.json holds garbage colors", async () => {
    const store = createTauriSettingsStore();
    settingsStore().data.set("settings", DEFAULT_SETTINGS);
    themeStore().data.set("colors", "garbage");

    await expect(store.load()).resolves.toBeDefined();
  });

  // AC-006 - side-effect-contract: a save-then-load round-trip restores the colors
  // from theme.json (the split is symmetric).
  it("should round-trip the colors through theme.json on save then load", async () => {
    const store = createTauriSettingsStore();

    await store.save({
      ...DEFAULT_SETTINGS,
      theme: { mode: "system", colors: seededColors },
    });
    const loaded = await store.load();

    expect(loaded.theme.colors).toEqual(seededColors);
  });
});
