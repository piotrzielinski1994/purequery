import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { SidebarTree } from "@/components/workspace/sidebar-tree";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";
import { backupDatabase, estimateBackupRows } from "@/lib/tauri";
import { save } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { MAX_BACKUP_ROWS } from "@/lib/workspace/backup";

vi.mock("@/lib/tauri", () => ({
  connectDatabase: vi.fn(),
  fetchSchema: vi.fn(() => Promise.resolve([])),
  cancelConnect: vi.fn(),
  disconnectDatabase: vi.fn(),
  estimateBackupRows: vi.fn(() => Promise.resolve(0)),
  backupDatabase: vi.fn(() => Promise.resolve({ path: "/tmp/x.sql", bytes: 10, ms: 5 })),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
}));

vi.mock("sonner", () => ({
  Toaster: () => null,
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

function renderTree() {
  return render(
    <WorkspaceProvider tree={fixtureTree} initialExpandedIds={["folder-staging"]}>
      <SidebarTree />
    </WorkspaceProvider>,
  );
}

function menuItem(name: RegExp | string) {
  return screen.queryByRole("menuitem", { name }) ?? screen.getByText(name);
}

describe("database row Backup action (F16)", () => {
  beforeEach(() => vi.clearAllMocks());

  // behavior (TC-007, AC-001): the database row menu offers a Backup item.
  it("should offer a Backup item on a database row", () => {
    renderTree();

    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "admin_db" }));

    expect(menuItem(/^backup/i)).toBeInTheDocument();
  });

  // behavior (TC-008, AC-004): cancelling the save dialog runs no backup and shows no toast.
  it("should not back up or toast when the save dialog is cancelled", async () => {
    vi.mocked(save).mockResolvedValueOnce(null);
    const user = userEvent.setup();
    renderTree();

    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "admin_db" }));
    await user.click(menuItem(/^backup/i));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(backupDatabase).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  // behavior (TC-009, AC-002/003): a chosen path backs up with the node's config + path, then a
  // success toast.
  it("should back up to the chosen path and show a success toast", async () => {
    vi.mocked(save).mockResolvedValueOnce("/tmp/admin.dump");
    const user = userEvent.setup();
    renderTree();

    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "admin_db" }));
    await user.click(menuItem(/^backup/i));

    await waitFor(() => expect(backupDatabase).toHaveBeenCalledTimes(1));
    const [config, path] = vi.mocked(backupDatabase).mock.calls[0];
    expect(path).toBe("/tmp/admin.dump");
    expect(config).toMatchObject({ engine: "postgres", database: "admin" });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  // behavior (TC-010, AC-003/009): a failing backup surfaces the error via an error toast.
  it("should show an error toast when the backup fails", async () => {
    vi.mocked(save).mockResolvedValueOnce("/tmp/admin.dump");
    vi.mocked(backupDatabase).mockRejectedValueOnce("connection refused");
    const user = userEvent.setup();
    renderTree();

    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "admin_db" }));
    await user.click(menuItem(/^backup/i));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });

  // behavior (giant-DB guardrail): an estimate over the limit blocks the backup - no save dialog,
  // no dump, an error toast naming the size.
  it("should block the backup and not open the dialog when the DB is too large", async () => {
    vi.mocked(estimateBackupRows).mockResolvedValueOnce(MAX_BACKUP_ROWS + 1);
    const user = userEvent.setup();
    renderTree();

    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "admin_db" }));
    await user.click(menuItem(/^backup/i));

    await waitFor(() => expect(estimateBackupRows).toHaveBeenCalledTimes(1));
    expect(save).not.toHaveBeenCalled();
    expect(backupDatabase).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  // behavior (guardrail): an estimate at/under the limit proceeds to the save dialog + dump.
  it("should proceed to the dialog when the estimate is within the limit", async () => {
    vi.mocked(estimateBackupRows).mockResolvedValueOnce(MAX_BACKUP_ROWS);
    vi.mocked(save).mockResolvedValueOnce("/tmp/admin.sql");
    const user = userEvent.setup();
    renderTree();

    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "admin_db" }));
    await user.click(menuItem(/^backup/i));

    await waitFor(() => expect(backupDatabase).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledTimes(1);
  });
});
