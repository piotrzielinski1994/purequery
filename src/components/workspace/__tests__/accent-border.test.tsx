import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminDb,
  fixtureTree,
  scratchDb,
} from "@/components/workspace/__tests__/fixtures";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { countTable, fetchTable } from "@/lib/tauri";
import type { ConnectionConfig } from "@/lib/workspace/model";

vi.mock("@/lib/tauri", () => ({
  connectDatabase: vi.fn(() => Promise.resolve({ tables: [], views: [] })),
  fetchSchema: vi.fn(() => Promise.resolve([])),
  disconnectDatabase: vi.fn(() => Promise.resolve()),
  cancelConnect: vi.fn(() => Promise.resolve()),
  fetchTable: vi.fn(() => new Promise(() => {})),
  countTable: vi.fn(() => Promise.resolve(0)),
  applyRowMutations: vi.fn(() => Promise.resolve(0)),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

const adminConfig: ConnectionConfig = {
  engine: "postgres",
  host: "db.internal",
  port: 5433,
  database: "admin",
  user: "seed_admin",
  password: "s3cr3t-pw",
};

// The accent recolors EXISTING borders by overriding the --border theme token on the workspace
// shell root (no new borders, no width change). The value is the accent blended toward transparent
// (a color-mix tint), so assert the override carries the accent hex rather than an exact string.
function shellBorderToken(container: HTMLElement): string {
  const shell = container.querySelector<HTMLElement>(
    '[data-slot="resizable-panel-group"]',
  );
  return shell?.style.getPropertyValue("--border").trim() ?? "";
}

function renderLayout(opts: { activeTabId: string; openTabIds?: string[] }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceProvider
        tree={fixtureTree}
        initialActiveTabId={opts.activeTabId}
        initialOpenTabIds={opts.openTabIds ?? [opts.activeTabId]}
        initialExpandedIds={["folder-staging", "db-admin"]}
        initialConnections={[["db-admin", adminConfig]]}
        initialConnectionStatus={[["db-admin", "connected"]]}
      >
        <WorkspaceLayout />
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchTable).mockReturnValue(new Promise(() => {}));
  vi.mocked(countTable).mockResolvedValue(0);
});

describe("accent recolors the shell borders (TC-006)", () => {
  // AC-005, TC-006 - behavior (a colored database active tab recolors the border token)
  it("should override the --border token with the accent when the active tab is a colored database", () => {
    const { container } = renderLayout({ activeTabId: adminDb.id });

    // admin_db is seeded red (#dc2626).
    expect(shellBorderToken(container)).toContain("#dc2626");
  });

  // AC-005, TC-006, E-3 - behavior (an uncolored database active tab leaves the token untouched)
  it("should not override the --border token when the active tab is an uncolored database", () => {
    const { container } = renderLayout({ activeTabId: scratchDb.id });

    expect(shellBorderToken(container)).toBe("");
  });

  // AC-005, TC-006 - behavior (switching from a colored to an uncolored tab clears the override)
  it("should clear the --border override when the active tab switches to an uncolored database", async () => {
    const user = userEvent.setup();
    const { container } = renderLayout({
      activeTabId: adminDb.id,
      openTabIds: [adminDb.id, scratchDb.id],
    });

    expect(shellBorderToken(container)).toContain("#dc2626");

    await user.click(screen.getByRole("tab", { name: "scratch_db" }));

    expect(shellBorderToken(container)).toBe("");
  });
});

describe("accent inheritance for tables (TC-008)", () => {
  // tbl-accounts is a table of the red admin_db; opening it should inherit the parent's accent.
  const TABLE_TAB_ID = "tbl-accounts";

  // AC-007, TC-008 - behavior (a table active tab inherits its parent database's accent token)
  it("should override the --border token with the parent database's accent when a table is active", () => {
    const { container } = renderLayout({ activeTabId: TABLE_TAB_ID });

    expect(shellBorderToken(container)).toContain("#dc2626");
  });
});
