import { CompletionContext } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

// F18 CodeMirror `{{name}}` decoration (AC-011 / TC-017 + variable-aware color). A `{{name}}` DEFINED
// in the editor's variable set is decorated `.cm-purequery-variable` (green); an UNDEFINED one
// `.cm-purequery-variable-undefined` (red). The single-line filter editor NEVER decorates. The decoration
// DOM populates in jsdom even though CM emits harmless getClientRects/measure errors (known baseline),
// so `container.querySelector` is the reliable assertion.
import { SqlEditor } from "@/components/workspace/sql-editor";

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

// Runs every registered autocomplete source at the doc end and collects the labels + details, so a
// test asserts what the `{{` variable-completion source offers regardless of source ordering.
async function completionsAt(container: HTMLElement) {
  const state = liveView(container).state;
  const sources = state.languageDataAt<(ctx: CompletionContext) => unknown>(
    "autocomplete",
    state.doc.length,
  );
  const ctx = new CompletionContext(state, state.doc.length, true);
  const results = (await Promise.all(
    sources.map((source) => source(ctx)),
  )) as ({ options: { label: string; detail?: string }[] } | null)[];
  return results.flatMap((result) => result?.options ?? []);
}

describe("SqlEditor {{name}} decoration (AC-011, TC-017)", () => {
  // AC-011 - behavior: a DEFINED {{userId}} decorates as .cm-purequery-variable (green).
  it("should decorate a defined {{name}} token green in the full editor", () => {
    const { container } = render(
      <SqlEditor
        value="SELECT * FROM users WHERE id = {{userId}}"
        onChange={() => {}}
        engine="postgres"
        schema={[]}
        variables={[{ name: "userId", value: "42" }]}
      />,
    );

    expect(container.querySelector(".cm-purequery-variable")).not.toBeNull();
    expect(
      container.querySelector(".cm-purequery-variable-undefined"),
    ).toBeNull();
  });

  // AC-011 - behavior: an UNDEFINED {{missing}} decorates as .cm-purequery-variable-undefined (red).
  it("should decorate an undefined {{name}} token red in the full editor", () => {
    const { container } = render(
      <SqlEditor
        value="SELECT {{missing}}"
        onChange={() => {}}
        engine="postgres"
        schema={[]}
        variables={[{ name: "userId", value: "42" }]}
      />,
    );

    expect(
      container.querySelector(".cm-purequery-variable-undefined"),
    ).not.toBeNull();
    expect(container.querySelector(".cm-purequery-variable")).toBeNull();
  });

  // AC-011 - behavior: with NO variables set, every {{name}} is undefined (red), never green.
  it("should treat every {{name}} as undefined when no variables are defined", () => {
    const { container } = render(
      <SqlEditor
        value="SELECT * FROM users WHERE id = {{userId}}"
        onChange={() => {}}
        engine="postgres"
        schema={[]}
      />,
    );

    expect(
      container.querySelector(".cm-purequery-variable-undefined"),
    ).not.toBeNull();
    expect(container.querySelector(".cm-purequery-variable")).toBeNull();
  });

  // AC-011, TC-017 - behavior: the single-line filter editor does NOT decorate {{name}} tokens.
  it("should not decorate a {{name}} token in the single-line filter editor", () => {
    const { container } = render(
      <SqlEditor
        value="id = {{userId}}"
        onChange={() => {}}
        engine="postgres"
        schema={[]}
        singleLine
        variables={[{ name: "userId", value: "42" }]}
      />,
    );

    expect(container.querySelector(".cm-purequery-variable")).toBeNull();
    expect(
      container.querySelector(".cm-purequery-variable-undefined"),
    ).toBeNull();
  });

  // AC-011 - behavior: an editor with no {{name}} token renders no decoration (marks the token shape,
  // not just any text).
  it("should not decorate when there is no {{name}} token", () => {
    const { container } = render(
      <SqlEditor
        value="SELECT * FROM users"
        onChange={() => {}}
        engine="postgres"
        schema={[]}
        variables={[{ name: "userId", value: "42" }]}
      />,
    );

    expect(container.querySelector(".cm-purequery-variable")).toBeNull();
    expect(
      container.querySelector(".cm-purequery-variable-undefined"),
    ).toBeNull();
  });
});

describe("SqlEditor {{name}} completion (defined-variable autocomplete)", () => {
  // behavior: typing `{{` offers the defined variable names, with the value as detail.
  it("should offer defined variable names after {{", async () => {
    const { container } = render(
      <SqlEditor
        value="SELECT * FROM users WHERE id = {{"
        onChange={() => {}}
        engine="postgres"
        schema={[]}
        variables={[
          { name: "userId", value: "42" },
          { name: "status", value: "'active'" },
        ]}
      />,
    );

    const options = await completionsAt(container);
    const labels = options.map((option) => option.label);
    expect(labels).toContain("userId");
    expect(labels).toContain("status");
    // the value is surfaced as the completion detail (the source tag equivalent)
    expect(options.find((option) => option.label === "userId")?.detail).toBe(
      "42",
    );
  });

  // behavior: a partial name after {{ still lists the variables (CM fuzzy-filters by the typed prefix).
  it("should offer variables after {{ with a partial name typed", async () => {
    const { container } = render(
      <SqlEditor
        value="SELECT {{user"
        onChange={() => {}}
        engine="postgres"
        schema={[]}
        variables={[{ name: "userId", value: "42" }]}
      />,
    );

    const labels = (await completionsAt(container)).map((o) => o.label);
    expect(labels).toContain("userId");
  });

  // behavior: outside a `{{` the variable source stays silent (no variable labels leak into plain SQL
  // completion).
  it("should not offer variables outside a {{ opener", async () => {
    const { container } = render(
      <SqlEditor
        value="SELECT "
        onChange={() => {}}
        engine="postgres"
        schema={[]}
        variables={[{ name: "userId", value: "42" }]}
      />,
    );

    const labels = (await completionsAt(container)).map((o) => o.label);
    expect(labels).not.toContain("userId");
  });

  // behavior: MongoDB Query editor offers variables after {{ too (engine-agnostic substitution).
  it("should offer variables after {{ in the MongoDB editor", async () => {
    const { container } = render(
      <SqlEditor
        value='db.users.find({ "_id": {{'
        onChange={() => {}}
        engine="mongodb"
        schema={[]}
        variables={[{ name: "oid", value: '{"$oid":"abc"}' }]}
      />,
    );

    const labels = (await completionsAt(container)).map((o) => o.label);
    expect(labels).toContain("oid");
  });
});
