import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { QueryWrapper } from "@/test/query-wrapper";
import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { DatabaseCard } from "@/components/workspace/database-card";
import { __resetInFlightConnects } from "@/components/workspace/use-connection";
import type { DatabaseNode, TreeNode } from "@/lib/workspace/model";

// F18 Variables tab (AC-006 / AC-007, TC-011 / TC-012). The database card gains a "Variables" section
// rendering an editable name/value grid seeded from the node's `variables`; editing it flows to the
// provider `setDatabaseVariables`. The `variables` field is spread via a cast because the runtime
// DatabaseNode type may not declare it until F18 lands, so the tests fail on the missing tab/behaviour.
vi.mock("@/lib/tauri", () => ({
  connectDatabase: vi.fn(() => Promise.resolve({ tables: [], views: [] })),
  fetchSchema: vi.fn(() => Promise.resolve([])),
  fetchTable: vi.fn(() =>
    Promise.resolve({ columns: [], rows: [], primaryKey: null }),
  ),
  countTable: vi.fn(() => Promise.resolve(0)),
  applyRowMutations: vi.fn(),
  executeSql: vi.fn(() => Promise.resolve([])),
  executeMongo: vi.fn(() => Promise.resolve([])),
  cancelQuery: vi.fn(),
  cancelConnect: vi.fn(),
  disconnectDatabase: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const DB_ID = "db-vars";

function node(variables: { name: string; value: string }[]): DatabaseNode {
  return {
    kind: "database",
    id: DB_ID,
    name: "vars_db",
    accentColor: null,
    readOnly: false,
    manualCommit: false,
    engine: "postgres",
    host: "localhost",
    port: 5432,
    database: "app",
    user: "app_user",
    password: "app-secret",
    tables: [],
    views: [],
    sql: "",
    savedScripts: [],
    savedJsScripts: [],
    variables,
    result: {
      status: "success",
      timeMs: 0,
      rowCount: 0,
      columns: [],
      rows: [],
      message: "",
    },
  } as unknown as DatabaseNode;
}

// Reads the active node's `variables` off the provider and renders them, so a test asserts observable
// tree state after an edit (not an internal spy). Mirrors the saved-scripts Probe pattern.
function VariablesProbe() {
  const { nodesById } = useWorkspace();
  const active = nodesById.get(DB_ID);
  const variables =
    active && active.kind === "database"
      ? ((active as DatabaseNode & {
          variables?: { name: string; value: string }[];
        }).variables ?? [])
      : [];
  return (
    <ul aria-label="variables-probe">
      {variables.map((variable, index) => (
        <li key={index}>{`${variable.name}=${variable.value}`}</li>
      ))}
    </ul>
  );
}

function renderCard(variables: { name: string; value: string }[]) {
  const tree: TreeNode[] = [node(variables)];
  return render(
    <QueryWrapper>
      <WorkspaceProvider tree={tree} initialActiveTabId={DB_ID}>
        <DatabaseCard />
        <VariablesProbe />
      </WorkspaceProvider>
    </QueryWrapper>,
  );
}

// The name/value grid cells are real <input>s; the hidden SqlTab's CodeMirror surface is also
// role="textbox" but is a <div>, so filter to INPUT elements to get just the variables grid cells.
function gridInputs(): HTMLInputElement[] {
  return screen
    .getAllByRole("textbox")
    .filter((el): el is HTMLInputElement => el.tagName === "INPUT");
}

function probeItems(): string[] {
  return Array.from(
    screen
      .getByRole("list", { name: "variables-probe" })
      .querySelectorAll("li"),
  ).map((li) => li.textContent ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetInFlightConnects();
});

describe("DatabaseCard Variables tab (AC-006, TC-011)", () => {
  // AC-006, TC-011 - behavior: the card exposes a Variables section tab.
  it("should expose a Variables tab", () => {
    renderCard([]);
    expect(
      screen.getByRole("tab", { name: "Variables" }),
    ).toBeInTheDocument();
  });

  // AC-006, TC-011 - behavior: selecting Variables renders the grid seeded with the node's variables.
  it("should render the name/value grid seeded with the node's variables when opened", async () => {
    const user = userEvent.setup();
    renderCard([{ name: "userId", value: "42" }]);

    await user.click(screen.getByRole("tab", { name: "Variables" }));

    expect(screen.getByDisplayValue("userId")).toBeInTheDocument();
    expect(screen.getByDisplayValue("42")).toBeInTheDocument();
  });

  // AC-006 - behavior: an empty variables set still renders (a trailing blank name/value row), no crash.
  it("should render a blank name/value row when the node has no variables", async () => {
    const user = userEvent.setup();
    renderCard([]);

    await user.click(screen.getByRole("tab", { name: "Variables" }));

    // Only the trailing blank row: one empty name input + one empty value input.
    const empties = gridInputs().filter((input) => input.value === "");
    expect(empties).toHaveLength(2);
  });
});

describe("DatabaseCard Variables tab editing (AC-007, TC-012)", () => {
  // AC-007, TC-012 - behavior: typing a name + value into the blank row persists a new variable on
  // the node (observed via the provider tree).
  it("should add the variable to the node when a name and value are typed into the blank row", async () => {
    const user = userEvent.setup();
    renderCard([{ name: "userId", value: "42" }]);

    await user.click(screen.getByRole("tab", { name: "Variables" }));

    // The blank row's two trailing empty inputs: [name, value].
    const [blankName] = gridInputs().filter((input) => input.value === "");
    await user.type(blankName, "team");
    // Typing the name materializes the row + appends a fresh blank; the materialized row's value
    // cell is now the first empty input.
    const [materializedValue] = gridInputs().filter(
      (input) => input.value === "",
    );
    await user.type(materializedValue, "eng");

    expect(probeItems()).toEqual(["userId=42", "team=eng"]);
  });

  // AC-007, TC-012 - behavior: a blank-name row (value typed, name left empty) is NOT persisted.
  it("should not persist a row whose name is blank", async () => {
    const user = userEvent.setup();
    renderCard([{ name: "userId", value: "42" }]);

    await user.click(screen.getByRole("tab", { name: "Variables" }));

    // The blank row: [name, value] - type only into the value, leaving the name blank.
    const empties = gridInputs().filter((input) => input.value === "");
    await user.type(empties[1], "orphan");

    // The provider node keeps only the named variable; the blank-name row is dropped.
    expect(probeItems()).toEqual(["userId=42"]);
  });

  // AC-007 - behavior: typing a VALUE first into the blank row (before a name) must NOT wipe the
  // in-progress input. Per-keystroke persist drops blank-name rows, so if the grid reseeded from the
  // (churned) node.variables it would clear the value mid-type. The value must survive.
  it("should keep an in-progress value typed into the blank row before a name", async () => {
    const user = userEvent.setup();
    renderCard([{ name: "userId", value: "42" }]);

    await user.click(screen.getByRole("tab", { name: "Variables" }));

    const [, blankValue] = gridInputs().filter((input) => input.value === "");
    await user.type(blankValue, "eng");

    // The blank row's value input still holds the typed text (not reset by a reseed).
    expect(
      gridInputs().some((input) => input.value === "eng"),
    ).toBe(true);
  });
});

describe("MongoDB card Variables tab (AC-006)", () => {
  // AC-006 - behavior: the Variables tab is present on a MongoDB card too (both section sets carry it).
  it("should expose a Variables tab on a MongoDB card", async () => {
    const user = userEvent.setup();
    const mongo = {
      kind: "database",
      id: DB_ID,
      name: "mongo_db",
      accentColor: null,
      readOnly: false,
      manualCommit: false,
      engine: "mongodb",
      host: "localhost",
      port: 27017,
      database: "m",
      user: "",
      password: "",
      tables: [],
      views: [],
      sql: "",
      savedScripts: [],
      savedJsScripts: [],
      variables: [{ name: "oid", value: '{"$oid":"abc"}' }],
      result: {
        status: "success",
        timeMs: 0,
        rowCount: 0,
        columns: [],
        rows: [],
        message: "",
      },
    } as unknown as DatabaseNode;
    render(
      <QueryWrapper>
        <WorkspaceProvider tree={[mongo]} initialActiveTabId={DB_ID}>
          <DatabaseCard />
        </WorkspaceProvider>
      </QueryWrapper>,
    );

    await user.click(screen.getByRole("tab", { name: "Variables" }));
    expect(screen.getByDisplayValue("oid")).toBeInTheDocument();
  });
});
