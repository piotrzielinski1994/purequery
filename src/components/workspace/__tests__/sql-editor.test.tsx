import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { language } from "@codemirror/language";
import { CompletionContext } from "@codemirror/autocomplete";

// Imported even though they do not exist yet: the test must fail on the missing
// feature (module/component/types), not on a typo. Once sql-editor.tsx + the
// model types ship, these assertions pin the editor's wiring.
import { SqlEditor } from "@/components/workspace/sql-editor";
import type { TableSchema } from "@/lib/workspace/model";

const schema: TableSchema[] = [
  {
    schema: null,
    name: "users",
    columns: [
      { name: "user_id", dataType: "int4" },
      { name: "email", dataType: "text" },
    ],
  },
  {
    schema: null,
    name: "orders",
    columns: [{ name: "order_id", dataType: "int4" }],
  },
];

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

describe("SqlEditor", () => {
  // TC-001 / AC-001 — behavior: it mounts an editable CodeMirror surface named "SQL editor".
  it("should mount an editable code editor surface named SQL editor seeded from value", () => {
    const { container } = render(
      <SqlEditor
        value="SELECT 1"
        onChange={() => {}}
        engine="postgres"
        schema={[]}
      />,
    );

    const surface = container.querySelector(".cm-content");
    expect(surface).not.toBeNull();
    expect(surface).toHaveAttribute("contenteditable", "true");
    expect(surface).toHaveAttribute("role", "textbox");
    expect(surface).toHaveAttribute("aria-label", "SQL editor");
    expect(liveView(container).state.doc.toString()).toBe("SELECT 1");
  });

  // TC-002 / AC-001 — side-effect-contract: edits dispatched on the live view flow out via onChange.
  it("should report edits through onChange when the document changes", () => {
    let reported: string | null = null;
    const { container } = render(
      <SqlEditor
        value=""
        onChange={(next) => (reported = next)}
        engine="postgres"
        schema={[]}
      />,
    );

    const view = liveView(container);
    view.dispatch({ changes: { from: 0, insert: "SELECT 42" } });

    expect(reported).toBe("SELECT 42");
  });

  // TC-003 / AC-002 — side-effect-contract: the SQL language is wired into the editor state.
  it("should apply the SQL language to the editor", () => {
    const { container } = render(
      <SqlEditor
        value="SELECT 1"
        onChange={() => {}}
        engine="postgres"
        schema={[]}
      />,
    );

    const lang = liveView(container).state.facet(language);
    expect(lang?.name).toBe("sql");
  });

  // TC-003 / AC-002 — side-effect-contract: the Darcula highlight extension colors tokens.
  // syntaxHighlighting registers a class-based highlighter; the rendered keyword
  // carries a token class so a HighlightStyle is wired (monochrome chrome has none).
  it("should wire a syntax-highlight style into the editor", () => {
    const { container } = render(
      <SqlEditor
        value="SELECT 1"
        onChange={() => {}}
        engine="postgres"
        schema={[]}
      />,
    );

    const highlighted = container.querySelector(".cm-content [class*='tok-']");
    expect(highlighted).not.toBeNull();
  });

  // TC-009 / AC-005 — behavior: with a schema, the completion source returns a table name.
  it("should complete table names from the schema after FROM", async () => {
    const { container } = render(
      <SqlEditor
        value="SELECT * FROM "
        onChange={() => {}}
        engine="postgres"
        schema={schema}
      />,
    );

    const state = liveView(container).state;
    const source = state.languageDataAt<
      (ctx: CompletionContext) => unknown
    >("autocomplete", state.doc.length)[0];
    expect(source).toBeTypeOf("function");

    const ctx = new CompletionContext(state, state.doc.length, true);
    const result = (await source(ctx)) as {
      options: { label: string }[];
    } | null;
    const labels = result?.options.map((option) => option.label) ?? [];
    expect(labels).toContain("users");
  });

  // TC-009 / AC-005 — behavior: with a schema, the completion source returns a column name.
  it("should complete column names from the schema after a table qualifier", async () => {
    const doc = "SELECT users.";
    const { container } = render(
      <SqlEditor
        value={doc}
        onChange={() => {}}
        engine="postgres"
        schema={schema}
      />,
    );

    const state = liveView(container).state;
    const source = state.languageDataAt<
      (ctx: CompletionContext) => unknown
    >("autocomplete", doc.length)[0];

    const ctx = new CompletionContext(state, doc.length, true);
    const result = (await source(ctx)) as {
      options: { label: string }[];
    } | null;
    const labels = result?.options.map((option) => option.label) ?? [];
    expect(labels).toContain("user_id");
  });

  // behavior: an in-scope FROM table's columns complete for a BARE identifier (no `table.` prefix),
  // so `select * from orders where o` suggests `order_id`.
  it("should complete a FROM table's columns for a bare identifier", async () => {
    const doc = "select * from orders where o";
    const { container } = render(
      <SqlEditor
        value={doc}
        onChange={() => {}}
        engine="postgres"
        schema={schema}
      />,
    );

    const state = liveView(container).state;
    const sources = state.languageDataAt<
      (ctx: CompletionContext) => unknown
    >("autocomplete", doc.length);
    const ctx = new CompletionContext(state, doc.length, true);
    const results = (await Promise.all(
      sources.map((source) => source(ctx)),
    )) as ({ options: { label: string }[] } | null)[];
    const labels = results.flatMap((result) =>
      (result?.options ?? []).map((option) => option.label),
    );
    expect(labels).toContain("order_id");
    // not the other table's columns - `orders` is what's in scope, not `users`
    expect(labels).not.toContain("user_id");
  });

  // behavior: a schema-qualified FROM (`from public.orders`) resolves the right table's columns for
  // a bare identifier, and a same-named table in another schema does NOT bleed in.
  it("should resolve columns for a schema-qualified FROM table", async () => {
    const multiSchema: TableSchema[] = [
      {
        schema: "public",
        name: "orders",
        columns: [{ name: "public_order_id", dataType: "int4" }],
      },
      {
        schema: "analytics",
        name: "orders",
        columns: [{ name: "analytics_order_id", dataType: "int4" }],
      },
    ];
    const doc = "select * from public.orders where o";
    const { container } = render(
      <SqlEditor
        value={doc}
        onChange={() => {}}
        engine="postgres"
        schema={multiSchema}
      />,
    );

    const state = liveView(container).state;
    const sources = state.languageDataAt<
      (ctx: CompletionContext) => unknown
    >("autocomplete", doc.length);
    const ctx = new CompletionContext(state, doc.length, true);
    const results = (await Promise.all(
      sources.map((source) => source(ctx)),
    )) as ({ options: { label: string }[] } | null)[];
    const labels = results.flatMap((result) =>
      (result?.options ?? []).map((option) => option.label),
    );
    expect(labels).toContain("public_order_id");
    expect(labels).not.toContain("analytics_order_id");
  });

  // behavior: a pinned defaultSchema (not "public") completes ITS tables unqualified after FROM, so
  // a user need not type `schema.table` once a default schema is set (mirrors the sidebar pin).
  it("should complete a non-public default schema's tables unqualified after FROM", async () => {
    const enrichment: TableSchema[] = [
      {
        schema: "stock_image_enrichment",
        name: "dealer_config",
        columns: [{ name: "customer_id", dataType: "text" }],
      },
      {
        schema: "quartz",
        name: "qrtz_locks",
        columns: [{ name: "lock_name", dataType: "text" }],
      },
    ];
    const doc = "select * from ";
    const { container } = render(
      <SqlEditor
        value={doc}
        onChange={() => {}}
        engine="postgres"
        schema={enrichment}
        defaultSchema="stock_image_enrichment"
      />,
    );

    const state = liveView(container).state;
    const sources = state.languageDataAt<
      (ctx: CompletionContext) => unknown
    >("autocomplete", doc.length);
    const ctx = new CompletionContext(state, doc.length, true);
    const results = (await Promise.all(
      sources.map((source) => source(ctx)),
    )) as ({ options: { label: string }[] } | null)[];
    const labels = results.flatMap((result) =>
      (result?.options ?? []).map((option) => option.label),
    );

    // The pinned schema's table completes unqualified; the other schema stays behind its qualifier.
    expect(labels).toContain("dealer_config");
    expect(labels).not.toContain("qrtz_locks");
  });

  // TC-014 / AC-016 — behavior: a SQL Server database with NO pinned defaultSchema falls back to
  // `dbo` (its built-in default), so `dbo` tables complete unqualified after FROM while another
  // schema's tables stay behind their qualifier. (Postgres falls back to `public`; sqlserver to `dbo`.)
  it("should complete dbo tables unqualified for a sqlserver database with no pinned schema", async () => {
    const mssqlSchema: TableSchema[] = [
      {
        schema: "dbo",
        name: "users",
        columns: [{ name: "id", dataType: "int" }],
      },
      {
        schema: "sales",
        name: "line_items",
        columns: [{ name: "sku", dataType: "nvarchar" }],
      },
    ];
    const doc = "select * from ";
    const { container } = render(
      <SqlEditor
        value={doc}
        onChange={() => {}}
        engine="sqlserver"
        schema={mssqlSchema}
      />,
    );

    const state = liveView(container).state;
    const sources = state.languageDataAt<
      (ctx: CompletionContext) => unknown
    >("autocomplete", doc.length);
    const ctx = new CompletionContext(state, doc.length, true);
    const results = (await Promise.all(
      sources.map((source) => source(ctx)),
    )) as ({ options: { label: string }[] } | null)[];
    const labels = results.flatMap((result) =>
      (result?.options ?? []).map((option) => option.label),
    );

    // `dbo` is the sqlserver built-in default -> its table completes unqualified; `sales` stays qualified.
    expect(labels).toContain("users");
    expect(labels).not.toContain("line_items");
  });

  // TC-009 / AC-005 — behavior: with no schema, completion still offers SQL keywords.
  it("should complete SQL keywords when no schema is available", async () => {
    const doc = "SEL";
    const { container } = render(
      <SqlEditor value={doc} onChange={() => {}} engine="postgres" schema={[]} />,
    );

    const state = liveView(container).state;
    const sources = state.languageDataAt<
      (ctx: CompletionContext) => unknown
    >("autocomplete", doc.length);

    const ctx = new CompletionContext(state, doc.length, true);
    const results = (await Promise.all(
      sources.map((source) => source(ctx)),
    )) as ({ options: { label: string }[] } | null)[];
    const labels = results.flatMap((result) =>
      (result?.options ?? []).map((option) => option.label.toLowerCase()),
    );
    expect(labels).toContain("select");
  });

  // behavior: keyword completion offers a curated set only - none of the dialect's obscure
  // reserved words (scale/scope/schemas/savepoint) leak in.
  it("should not offer obscure dialect reserved words as keyword completions", async () => {
    const doc = "s";
    const { container } = render(
      <SqlEditor value={doc} onChange={() => {}} engine="postgres" schema={[]} />,
    );

    const state = liveView(container).state;
    const sources = state.languageDataAt<
      (ctx: CompletionContext) => unknown
    >("autocomplete", doc.length);

    const ctx = new CompletionContext(state, doc.length, true);
    const results = (await Promise.all(
      sources.map((source) => source(ctx)),
    )) as ({ options: { label: string }[] } | null)[];
    const labels = results.flatMap((result) =>
      (result?.options ?? []).map((option) => option.label.toLowerCase()),
    );

    expect(labels).toContain("select");
    for (const noise of ["scale", "scope", "schemas", "savepoint"]) {
      expect(labels).not.toContain(noise);
    }
  });

  // behavior: with defaultTable (filter row), completion offers that table's columns + keywords
  // but NOT other table names - irrelevant in a single-table WHERE.
  it("should offer the default table's columns and not other table names", async () => {
    const doc = "o";
    const { container } = render(
      <SqlEditor
        value={doc}
        onChange={() => {}}
        engine="postgres"
        schema={schema}
        defaultTable="users"
      />,
    );

    const state = liveView(container).state;
    const sources = state.languageDataAt<
      (ctx: CompletionContext) => unknown
    >("autocomplete", doc.length);

    const ctx = new CompletionContext(state, doc.length, true);
    const results = (await Promise.all(
      sources.map((source) => source(ctx)),
    )) as ({ options: { label: string }[] } | null)[];
    const labels = results.flatMap((result) =>
      (result?.options ?? []).map((option) => option.label),
    );

    // users' columns are offered (user_id matches "o"? no - assert via the column set), other
    // table name "orders" is NOT offered.
    expect(labels).toContain("email");
    expect(labels).toContain("user_id");
    expect(labels).not.toContain("orders");
  });

  // behavior: after a `table.` qualifier only the table's columns are offered, no keywords.
  it("should offer only columns (no keywords) after a table qualifier", async () => {
    const doc = "SELECT users.s";
    const { container } = render(
      <SqlEditor
        value={doc}
        onChange={() => {}}
        engine="postgres"
        schema={schema}
      />,
    );

    const state = liveView(container).state;
    const sources = state.languageDataAt<
      (ctx: CompletionContext) => unknown
    >("autocomplete", doc.length);

    const ctx = new CompletionContext(state, doc.length, true);
    const results = (await Promise.all(
      sources.map((source) => source(ctx)),
    )) as ({ options: { label: string }[] } | null)[];
    const labels = results.flatMap((result) =>
      (result?.options ?? []).map((option) => option.label.toLowerCase()),
    );

    expect(labels).not.toContain("select");
  });
});

describe("SqlEditor MongoDB completion", () => {
  async function completionLabels(
    container: HTMLElement,
    doc: string,
  ): Promise<string[]> {
    const state = liveView(container).state;
    const sources = state.languageDataAt<
      (ctx: CompletionContext) => unknown
    >("autocomplete", doc.length);
    const ctx = new CompletionContext(state, doc.length, true);
    const results = (await Promise.all(
      sources.map((source) => source(ctx)),
    )) as ({ options: { label: string }[] } | null)[];
    return results.flatMap((result) =>
      (result?.options ?? []).map((option) => option.label),
    );
  }

  // behavior: after `db.` the editor completes the connected database's collection names.
  it("should complete collection names after db.", async () => {
    const doc = "db.u";
    const { container } = render(
      <SqlEditor
        value={doc}
        onChange={() => {}}
        engine="mongodb"
        schema={[]}
        collections={["users", "orders", "events"]}
      />,
    );

    const labels = await completionLabels(container, doc);
    expect(labels).toContain("users");
    expect(labels).toContain("orders");
  });

  // behavior: after `db.<collection>.` the editor completes the read operations find/aggregate.
  it("should complete find and aggregate after a collection qualifier", async () => {
    const doc = "db.users.";
    const { container } = render(
      <SqlEditor
        value={doc}
        onChange={() => {}}
        engine="mongodb"
        schema={[]}
        collections={["users", "orders"]}
      />,
    );

    const labels = await completionLabels(container, doc);
    expect(labels).toContain("find");
    expect(labels).toContain("aggregate");
  });

  // behavior: the Mongo FILTER ROW is a bare find document (no db.<coll>.find prefix) scoped to one
  // collection via defaultTable; after a key-opening `"` it completes that collection's fields.
  it("should complete the default collection's fields in a bare filter document", async () => {
    const mongoSchema: TableSchema[] = [
      {
        schema: null,
        name: "users",
        columns: [
          { name: "vip", dataType: "" },
          { name: "email", dataType: "" },
        ],
      },
      {
        schema: null,
        name: "orders",
        columns: [{ name: "total", dataType: "" }],
      },
    ];
    const doc = '{ "';
    const { container } = render(
      <SqlEditor
        value={doc}
        onChange={() => {}}
        engine="mongodb"
        schema={mongoSchema}
        collections={["users", "orders"]}
        defaultTable="users"
      />,
    );

    const labels = await completionLabels(container, doc);
    expect(labels).toContain("vip");
    expect(labels).toContain("email");
    // scoped to the filter's collection - the other collection's fields do not bleed in
    expect(labels).not.toContain("total");
  });

  // behavior: inside the find body, the editor completes the sampled field names of the command's
  // collection (from the schema), not another collection's fields.
  it("should complete field names of the command collection inside the find body", async () => {
    const mongoSchema: TableSchema[] = [
      {
        schema: null,
        name: "users",
        columns: [
          { name: "name", dataType: "" },
          { name: "age", dataType: "" },
        ],
      },
      {
        schema: null,
        name: "orders",
        columns: [{ name: "total", dataType: "" }],
      },
    ];
    const doc = 'db.users.find({ "';
    const { container } = render(
      <SqlEditor
        value={doc}
        onChange={() => {}}
        engine="mongodb"
        schema={mongoSchema}
        collections={["users", "orders"]}
      />,
    );

    const labels = await completionLabels(container, doc);
    expect(labels).toContain("name");
    expect(labels).toContain("age");
    expect(labels).not.toContain("total");
  });
});
