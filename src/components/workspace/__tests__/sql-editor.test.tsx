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
    name: "users",
    columns: [
      { name: "user_id", dataType: "int4" },
      { name: "email", dataType: "text" },
    ],
  },
  {
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
