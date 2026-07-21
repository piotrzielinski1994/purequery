import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseCard } from "@/components/workspace/database-card";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { connectDatabase } from "@/lib/tauri";
import type { DatabaseNode, DbEngine, TreeNode } from "@/lib/workspace/model";
import { QueryWrapper } from "@/test/query-wrapper";

vi.mock("@/lib/tauri", () => ({
  connectDatabase: vi.fn(() => Promise.resolve({ tables: [], views: [] })),
  fetchSchema: vi.fn(() => Promise.resolve([])),
  fetchTable: vi.fn(() =>
    Promise.resolve({ columns: [], rows: [], primaryKey: null }),
  ),
  countTable: vi.fn(() => Promise.resolve(0)),
  fetchDatabaseObjects: vi.fn(() => Promise.resolve([])),
  applyRowMutations: vi.fn(),
  executeSql: vi.fn(() => Promise.resolve([])),
  executeMongo: vi.fn(() => Promise.resolve([])),
  cancelQuery: vi.fn(),
  disconnectDatabase: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(connectDatabase).mockResolvedValue({ tables: [], views: [] });
});

// A minimal database node for the given engine (network engines share the same shape; sqlite would
// need `file` instead, but engine-tab presence does not read connection fields so the network shape
// with an added file keeps every node literal identical).
function node(engine: DbEngine): DatabaseNode {
  return {
    kind: "database",
    id: `db-${engine}`,
    name: `${engine}_db`,
    accentColor: null,
    readOnly: false,
    manualCommit: false,
    defaultSchema: null,
    engine,
    host: "localhost",
    port: 5432,
    database: "app",
    user: "app_user",
    password: "pw",
    tables: [],
    views: [],
    sql: "",
    savedScripts: [],
    savedJsScripts: [],
    variables: [],
    result: {
      status: "success",
      timeMs: 0,
      rowCount: 0,
      columns: [],
      rows: [],
      message: "",
    },
  } as DatabaseNode;
}

function renderCard(engine: DbEngine) {
  const tree: TreeNode[] = [node(engine)];
  return render(
    <QueryWrapper>
      <WorkspaceProvider tree={tree} initialActiveTabId={`db-${engine}`}>
        <DatabaseCard />
      </WorkspaceProvider>
    </QueryWrapper>,
  );
}

describe("DatabaseCard object tabs per engine", () => {
  // AC-001, TC-001 - behavior (Postgres shows all four object tabs)
  it("should show Procedures, Functions, Triggers and Sequences tabs for postgres", () => {
    renderCard("postgres");
    for (const label of ["Procedures", "Functions", "Triggers", "Sequences"]) {
      expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
    }
  });

  // AC-002, TC-002 - behavior (MySQL shows procedures/functions/triggers, NOT sequences)
  it("should show Procedures, Functions and Triggers but not Sequences for mysql", () => {
    renderCard("mysql");
    for (const label of ["Procedures", "Functions", "Triggers"]) {
      expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole("tab", { name: "Sequences" })).toBeNull();
  });

  // AC-003, TC-003 - behavior (SQLite shows Triggers only)
  it("should show only the Triggers tab for sqlite", () => {
    renderCard("sqlite");
    expect(screen.getByRole("tab", { name: "Triggers" })).toBeInTheDocument();
    for (const label of ["Procedures", "Functions", "Sequences"]) {
      expect(screen.queryByRole("tab", { name: label })).toBeNull();
    }
  });

  // AC-004, TC-004 - behavior (MongoDB shows none of the object tabs)
  it("should show no object tabs for mongodb", () => {
    renderCard("mongodb");
    for (const label of ["Procedures", "Functions", "Triggers", "Sequences"]) {
      expect(screen.queryByRole("tab", { name: label })).toBeNull();
    }
  });
});
