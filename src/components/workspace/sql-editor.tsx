import { useMemo } from "react";
import CodeMirror, { type BasicSetupOptions } from "@uiw/react-codemirror";
import { EditorView, keymap, placeholder as cmPlaceholder } from "@codemirror/view";
import {
  EditorState,
  Prec,
  type Extension,
  type Transaction,
} from "@codemirror/state";
import {
  PostgreSQL,
  MySQL,
  SQLite,
  schemaCompletionSource,
} from "@codemirror/lang-sql";
import {
  LanguageSupport,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  completeFromList,
  type CompletionContext,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { classHighlighter } from "@lezer/highlight";
import {
  darculaChrome,
  darculaHighlight,
} from "@/components/workspace/sql-editor-theme";
import type { DbEngine, TableSchema } from "@/lib/workspace/model";

const dialects = {
  postgres: PostgreSQL,
  mysql: MySQL,
  sqlite: SQLite,
} as const;

// Curated set of common SQL keywords. lang-sql's built-in keyword source dumps the dialect's
// FULL reserved+non-reserved word list (`scale`, `scope`, `schemas`, `savepoint`, ...), which is
// noise; this is the relevant subset. Fuzzy matching is case-insensitive, so typing `sel` still
// finds SELECT.
const SQL_KEYWORDS = [
  "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "NULL", "IS", "IN", "LIKE",
  "BETWEEN", "EXISTS", "AS", "DISTINCT", "ORDER BY", "GROUP BY", "HAVING",
  "LIMIT", "OFFSET", "ASC", "DESC", "JOIN", "INNER JOIN", "LEFT JOIN",
  "RIGHT JOIN", "FULL JOIN", "ON", "USING", "UNION", "UNION ALL", "INTERSECT",
  "EXCEPT", "INSERT INTO", "VALUES", "UPDATE", "SET", "DELETE FROM", "RETURNING",
  "CREATE TABLE", "ALTER TABLE", "DROP TABLE", "TRUNCATE", "CASE", "WHEN",
  "THEN", "ELSE", "END", "COUNT", "SUM", "AVG", "MIN", "MAX", "COALESCE",
  "CAST", "TRUE", "FALSE", "WITH", "INTO",
];

// Keyword completions, suppressed in a qualified-column context (after `table.`) so column names
// from the schema are the only suggestions there.
const completeKeywords = completeFromList(
  SQL_KEYWORDS.map((label) => ({ label, type: "keyword" })),
);
function keywordSource(context: CompletionContext) {
  if (context.matchBefore(/\.\w*$/)) {
    return null;
  }
  return completeKeywords(context);
}

// Builds SQL language support whose ONLY completions are schema tables/columns + curated keywords -
// nothing from the dialect's full keyword dump. When `defaultTable` is set (the filter row, which
// is a WHERE on ONE table), completion is scoped to that table's columns + keywords - no other
// table names, which would be irrelevant noise in a single-table filter.
function buildSqlLanguage(
  engine: DbEngine,
  schemaMap: Record<string, string[]>,
  defaultTable: string | undefined,
) {
  const dialect = dialects[engine];
  const completionSource: CompletionSource = defaultTable
    ? completeFromList(
        (schemaMap[defaultTable] ?? []).map((label) => ({
          label,
          type: "property",
        })),
      )
    : schemaCompletionSource({ dialect, schema: schemaMap });
  return new LanguageSupport(dialect.language, [
    dialect.language.data.of({ autocomplete: completionSource }),
    dialect.language.data.of({ autocomplete: keywordSource }),
  ]);
}

// Run the editor's current selection if it holds non-whitespace text, otherwise the whole buffer.
// Shared by the in-editor Mod-Enter keymap and the out-of-editor Run button.
export function selectedOrAllSql(view: EditorView | null | undefined): string {
  if (!view) {
    return "";
  }
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  if (selected.trim().length > 0) {
    return selected;
  }
  return view.state.doc.toString();
}

type SqlEditorProps = {
  value: string;
  onChange: (value: string) => void;
  engine: DbEngine;
  schema: TableSchema[];
  onSubmit?: () => void;
  onCreateEditor?: (view: EditorView) => void;
  // A single-line editor (filter row): Enter submits, newlines are blocked, gutter/multiline off.
  singleLine?: boolean;
  ariaLabel?: string;
  placeholder?: string;
  // Scopes completion to ONE table's columns (the filter row's WHERE). Without it, completion
  // offers all tables + their columns (the SQL tab).
  defaultTable?: string;
};

const SINGLE_LINE_SETUP: BasicSetupOptions = {
  lineNumbers: false,
  foldGutter: false,
  highlightActiveLine: false,
  highlightActiveLineGutter: false,
};

export function SqlEditor({
  value,
  onChange,
  engine,
  schema,
  onSubmit,
  onCreateEditor,
  singleLine = false,
  ariaLabel = "SQL editor",
  placeholder,
  defaultTable,
}: SqlEditorProps) {
  const extensions = useMemo<Extension[]>(() => {
    const schemaMap = Object.fromEntries(
      schema.map((table) => [table.name, table.columns.map((c) => c.name)]),
    );
    const submitKey = singleLine ? "Enter" : "Mod-Enter";
    return [
      buildSqlLanguage(engine, schemaMap, defaultTable),
      syntaxHighlighting(darculaHighlight),
      syntaxHighlighting(classHighlighter),
      darculaChrome,
      EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
      ...(placeholder ? [cmPlaceholder(placeholder)] : []),
      ...(singleLine ? [EditorState.transactionFilter.of(blockNewlines)] : []),
      Prec.highest(
        keymap.of([
          {
            key: submitKey,
            run: () => {
              onSubmit?.();
              return true;
            },
          },
        ]),
      ),
    ];
  }, [engine, schema, onSubmit, singleLine, ariaLabel, placeholder, defaultTable]);

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      theme="none"
      basicSetup={singleLine ? SINGLE_LINE_SETUP : undefined}
      extensions={extensions}
      height={singleLine ? "auto" : "100%"}
      className={singleLine ? "w-full text-xs" : "h-full text-xs"}
      onCreateEditor={(view) => onCreateEditor?.(view)}
    />
  );
}

// Drops any transaction that would introduce a line break, keeping the filter editor one line.
function blockNewlines(tr: Transaction) {
  if (!tr.changes.empty && tr.newDoc.lines > 1) {
    return [];
  }
  return tr;
}
