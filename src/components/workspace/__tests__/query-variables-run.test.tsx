import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EditorView } from "@codemirror/view";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { SqlTab } from "@/components/workspace/sql-tab";
import { Console } from "@/components/workspace/console";
import { ContentHeader } from "@/components/workspace/content-header";
import { executeSql, executeMongo } from "@/lib/tauri";
import { toast } from "sonner";
import type { ConnectionConfig, TreeNode } from "@/lib/workspace/model";

// F18 substitution at the SQL/Query Run boundary (AC-008 / AC-009 / AC-010, TC-013..016). A defined
// `{{name}}` must reach executeSql/executeMongo already substituted; an undefined one blocks the send
// (warning toast + History error); and substitution must compose BEFORE the manual-commit begin/record
// so the tx statement list holds the substituted text. `variables` is spread via a cast on the node
// literal (the runtime type may not declare it until F18 lands) - the tests fail on the missing send
// behaviour, not a type error.
vi.mock("@/lib/tauri", () => ({
  executeSql: vi.fn(),
  executeMongo: vi.fn(),
  beginTransaction: vi.fn(() => Promise.resolve()),
  commitTransaction: vi.fn(() => Promise.resolve()),
  rollbackTransaction: vi.fn(() => Promise.resolve()),
  transactionState: vi.fn(() => Promise.resolve(true)),
  disconnectDatabase: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));

const mockExecute = vi.mocked(executeSql);
const mockExecuteMongo = vi.mocked(executeMongo);
const mockWarning = vi.mocked(toast.warning);

const pgConfig: ConnectionConfig = {
  engine: "postgres",
  host: "localhost",
  port: 5432,
  database: "ppp",
  user: "postgres",
  password: "postgres",
};

const mongoConfig: ConnectionConfig = {
  engine: "mongodb",
  host: "localhost",
  port: 27017,
  database: "m",
  user: "",
  password: "",
};

type Variable = { name: string; value: string };

function pgTree(
  variables: Variable[],
  manualCommit: boolean,
): TreeNode[] {
  return [
    {
      kind: "database",
      accentColor: null,
      readOnly: false,
      manualCommit,
      id: "db-ppp",
      name: "ppp",
      engine: "postgres",
      host: "localhost",
      port: 5432,
      database: "ppp",
      user: "postgres",
      password: "postgres",
      tables: [],
      views: [],
      sql: "SELECT 1",
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
    } as unknown as TreeNode,
  ];
}

function mongoTree(variables: Variable[]): TreeNode[] {
  return [
    {
      kind: "database",
      accentColor: null,
      readOnly: false,
      manualCommit: false,
      id: "db-m",
      name: "m",
      engine: "mongodb",
      host: "localhost",
      port: 27017,
      database: "m",
      user: "",
      password: "",
      tables: [],
      views: [],
      sql: "db.users.find({})",
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
    } as unknown as TreeNode,
  ];
}

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderPg(variables: Variable[], manualCommit = false) {
  return render(
    <QueryClientProvider client={newClient()}>
      <WorkspaceProvider
        tree={pgTree(variables, manualCommit)}
        initialActiveTabId="db-ppp"
        initialConnections={[["db-ppp", pgConfig]]}
        initialConnectionStatus={[["db-ppp", "connected"]]}
      >
        <ContentHeader />
        <SqlTab />
        <Console />
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
}

function renderMongo(variables: Variable[]) {
  return render(
    <QueryClientProvider client={newClient()}>
      <WorkspaceProvider
        tree={mongoTree(variables)}
        initialActiveTabId="db-m"
        initialConnections={[["db-m", mongoConfig]]}
        initialConnectionStatus={[["db-m", "connected"]]}
      >
        <SqlTab />
        <Console />
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
}

function liveView(container: HTMLElement): EditorView {
  const editorEl = container.querySelector<HTMLElement>(".cm-editor");
  if (!editorEl) {
    throw new Error(".cm-editor not found");
  }
  const view = EditorView.findFromDOM(editorEl);
  if (!view) {
    throw new Error("live EditorView not found");
  }
  return view;
}

function replaceDoc(view: EditorView, text: string) {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
  });
}

// SqlText splits a statement across per-token spans, so getByText on the whole SQL fails; collapse a
// dialog's text to single spaces and match that.
function dialogText(dialog: HTMLElement): string {
  return (dialog.textContent ?? "").replace(/\s+/g, " ");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExecute.mockResolvedValue([
    {
      statement: "",
      columns: [],
      rows: [],
      rowsAffected: 1,
      returnsRows: false,
      message: "OK",
    },
  ]);
  mockExecuteMongo.mockResolvedValue([
    {
      statement: "",
      columns: [],
      rows: [],
      rowsAffected: 0,
      returnsRows: true,
      message: "OK",
    },
  ]);
});

describe("Query variables substitution on Run (AC-008, TC-013)", () => {
  // AC-008, TC-013 - side-effect-contract: a defined {{userId}} reaches executeSql substituted.
  it("should send the substituted SQL to executeSql when the ref is defined", async () => {
    const user = userEvent.setup();
    const { container } = renderPg([{ name: "userId", value: "42" }]);

    replaceDoc(
      liveView(container),
      "SELECT * FROM users WHERE id = {{userId}}",
    );
    await user.click(screen.getByRole("button", { name: /^run$/i }));

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalledWith(
        "db-ppp",
        "SELECT * FROM users WHERE id = 42",
        expect.any(String),
      );
    });
    expect(mockWarning).not.toHaveBeenCalled();
  });
});

describe("Query variables undefined-ref block (AC-009, TC-014)", () => {
  // AC-009, TC-014 - side-effect-contract: an undefined {{missing}} does NOT reach executeSql.
  it("should not call executeSql when a ref is undefined", async () => {
    const user = userEvent.setup();
    const { container } = renderPg([]);

    replaceDoc(liveView(container), "SELECT {{missing}}");
    await user.click(screen.getByRole("button", { name: /^run$/i }));

    // Give any (erroneous) async submit a tick to fire before asserting the negative.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockExecute).not.toHaveBeenCalled();
  });

  // AC-009, TC-014 - behavior: the block raises a warning toast naming the missing variable.
  it("should fire a warning toast naming the undefined variable", async () => {
    const user = userEvent.setup();
    const { container } = renderPg([]);

    replaceDoc(liveView(container), "SELECT {{missing}}");
    await user.click(screen.getByRole("button", { name: /^run$/i }));

    await waitFor(() => {
      expect(mockWarning).toHaveBeenCalled();
    });
    expect(mockWarning).toHaveBeenCalledWith(
      expect.stringMatching(/missing/i),
      expect.anything(),
    );
  });

  // AC-009, TC-014 - behavior: the block records a History error entry.
  it("should add a History error entry when a ref is undefined", async () => {
    const user = userEvent.setup();
    const { container } = renderPg([]);

    replaceDoc(liveView(container), "SELECT {{missing}}");
    await user.click(screen.getByRole("button", { name: /^run$/i }));

    const historyList = await screen.findByRole("list", {
      name: /query history/i,
    });
    expect(historyList).toHaveTextContent("ERR");
  });
});

describe("Query variables + manual-commit compose (AC-010, TC-015)", () => {
  // AC-010, TC-015 - behavior: a manual-commit write records the SUBSTITUTED statement in the Commit
  // modal, not the {{userId}} template (substitution runs before the tx record).
  it("should record the substituted statement in the Commit modal", async () => {
    const user = userEvent.setup();
    const { container } = renderPg([{ name: "userId", value: "7" }], true);

    replaceDoc(liveView(container), "DELETE FROM t WHERE id = {{userId}}");
    await user.click(screen.getByRole("button", { name: /^run$/i }));

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalled();
    });

    await user.click(await screen.findByRole("button", { name: /^commit$/i }));
    const dialog = await screen.findByRole("dialog");
    const text = dialogText(dialog);
    expect(text).toMatch(/DELETE FROM t WHERE id = 7/i);
    expect(text).not.toMatch(/\{\{userId\}\}/);
  });
});

describe("Query variables substitution on Mongo Run (AC-008, TC-016)", () => {
  // AC-008 (Mongo), TC-016 - side-effect-contract: a {{oid}} in a Mongo command substitutes verbatim
  // and the substituted text reaches executeMongo.
  it("should send the substituted command to executeMongo when the ref is defined", async () => {
    const user = userEvent.setup();
    const { container } = renderMongo([
      { name: "oid", value: '{"$oid":"abc"}' },
    ]);

    replaceDoc(liveView(container), 'db.users.find({ "_id": {{oid}} })');
    await user.click(screen.getByRole("button", { name: /^run$/i }));

    await waitFor(() => {
      expect(mockExecuteMongo).toHaveBeenCalledWith(
        "db-m",
        'db.users.find({ "_id": {"$oid":"abc"} })',
        expect.any(String),
      );
    });
    expect(mockWarning).not.toHaveBeenCalled();
  });
});
