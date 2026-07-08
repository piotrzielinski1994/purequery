import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { CompletionContext } from "@codemirror/autocomplete";

import { JsEditor } from "@/components/workspace/js-editor";
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

async function completionLabels(
  container: HTMLElement,
  doc: string,
): Promise<string[]> {
  const state = liveView(container).state;
  const sources = state.languageDataAt<(ctx: CompletionContext) => unknown>(
    "autocomplete",
    doc.length,
  );
  const ctx = new CompletionContext(state, doc.length, true);
  const results = (await Promise.all(
    sources.map((source) => source(ctx)),
  )) as ({ options: { label: string }[] } | null)[];
  return results.flatMap((result) =>
    (result?.options ?? []).map((option) => option.label),
  );
}

describe("JsEditor completion - globals", () => {
  // behavior: a bare identifier completes the injected script globals db/console/print.
  it("should complete db, console and print as top-level globals", async () => {
    const doc = "d";
    const { container } = render(
      <JsEditor value={doc} onChange={() => {}} engine="postgres" schema={[]} />,
    );

    const labels = await completionLabels(container, doc);
    expect(labels).toContain("db");
    expect(labels).toContain("console");
    expect(labels).toContain("print");
  });

  // behavior: after `console.` the editor completes log and error.
  it("should complete log and error after console.", async () => {
    const doc = "console.";
    const { container } = render(
      <JsEditor value={doc} onChange={() => {}} engine="postgres" schema={[]} />,
    );

    const labels = await completionLabels(container, doc);
    expect(labels).toContain("log");
    expect(labels).toContain("error");
  });
});

describe("JsEditor completion - db methods (SQL)", () => {
  // behavior: after `db.` a SQL engine completes query/tables/schema, NOT the Mongo methods.
  it("should complete query, tables and schema after db. on a SQL engine", async () => {
    const doc = "db.";
    const { container } = render(
      <JsEditor value={doc} onChange={() => {}} engine="postgres" schema={[]} />,
    );

    const labels = await completionLabels(container, doc);
    expect(labels).toContain("query");
    expect(labels).toContain("tables");
    expect(labels).toContain("schema");
    expect(labels).not.toContain("find");
    expect(labels).not.toContain("aggregate");
  });

  // behavior: inside db.query("...") after a quote, a SQL engine completes the schema's table names.
  it("should complete table names inside a db.query string literal", async () => {
    const doc = 'await db.query("select * from ';
    const { container } = render(
      <JsEditor
        value={doc}
        onChange={() => {}}
        engine="postgres"
        schema={schema}
      />,
    );

    const labels = await completionLabels(container, doc);
    expect(labels).toContain("users");
    expect(labels).toContain("orders");
  });
});

describe("JsEditor completion - db methods (MongoDB)", () => {
  // behavior: after `db.` a Mongo engine completes find/aggregate/collections/schema, NOT query.
  it("should complete find, aggregate, collections and schema after db. on mongodb", async () => {
    const doc = "db.";
    const { container } = render(
      <JsEditor
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
    expect(labels).toContain("collections");
    expect(labels).toContain("schema");
    expect(labels).not.toContain("query");
  });

  // behavior: inside a db.find("...") string literal a Mongo engine completes collection names.
  it("should complete collection names inside a db.find string literal", async () => {
    const doc = 'await db.find("';
    const { container } = render(
      <JsEditor
        value={doc}
        onChange={() => {}}
        engine="mongodb"
        schema={[]}
        collections={["users", "orders", "events"]}
      />,
    );

    const labels = await completionLabels(container, doc);
    expect(labels).toContain("users");
    expect(labels).toContain("events");
  });
});
