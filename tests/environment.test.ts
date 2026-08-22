import { isTauri } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: vi.fn(),
}));

const mockedIsTauri = vi.mocked(isTauri);

describe("isDevBrowser (AC-101 / F4)", () => {
  beforeEach(() => {
    mockedIsTauri.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should return true if MODE is development and there is no Tauri host", async () => {
    vi.stubEnv("MODE", "development");
    mockedIsTauri.mockReturnValue(false);

    const { isDevBrowser } = await import("@/lib/runtime/environment");
    expect(isDevBrowser()).toBe(true);
  });

  it("should return false if MODE is development but a Tauri host is present", async () => {
    vi.stubEnv("MODE", "development");
    mockedIsTauri.mockReturnValue(true);

    const { isDevBrowser } = await import("@/lib/runtime/environment");
    expect(isDevBrowser()).toBe(false);
  });

  it("should return false if MODE is test regardless of the Tauri host", async () => {
    vi.stubEnv("MODE", "test");
    mockedIsTauri.mockReturnValue(false);

    const { isDevBrowser } = await import("@/lib/runtime/environment");
    expect(isDevBrowser()).toBe(false);
  });

  it("should return false if MODE is production", async () => {
    vi.stubEnv("MODE", "production");
    mockedIsTauri.mockReturnValue(false);

    const { isDevBrowser } = await import("@/lib/runtime/environment");
    expect(isDevBrowser()).toBe(false);
  });
});
