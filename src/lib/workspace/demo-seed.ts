import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings/settings";
import type { FileMap } from "@/lib/workspace/disk-format";
import { serialize } from "@/lib/workspace/disk-format";
import type {
  DatabaseNode,
  FolderNode,
  TableNode,
} from "@/lib/workspace/model";

// In-memory fs key + dev-build settings `workspacePath`. The `npm run dev`
// browser build seeds this path so the workspace renders instead of the empty
// state (see `isDevBrowser`).
export const DEMO_WORKSPACE_PATH = "demo";

const table = (id: string, name: string): TableNode => ({
  kind: "table",
  id,
  name,
  schema: null,
  columns: [],
  rows: [],
});

const chinook: DatabaseNode = {
  kind: "database",
  id: "db-chinook",
  name: "Chinook",
  accentColor: null,
  readOnly: false,
  manualCommit: false,
  defaultSchema: null,
  engine: "sqlite",
  file: "demo/chinook.sqlite",
  tables: [table("t-artists", "Artists"), table("t-albums", "Albums")],
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
};

// Hand-authored source; `serialize` + the loader's `deserialize` round-trip
// make `demoFiles()` a fixed point of the disk format, so the seed can't drift
// from a shape the loader would reject.
const seedSource: (FolderNode | DatabaseNode)[] = [
  { kind: "folder", id: "f-demos", name: "demos", children: [] },
  chinook,
];

const seedFiles: FileMap = serialize(seedSource, "Demo");

export function demoFiles(): FileMap {
  return seedFiles;
}

export function demoSettings(): Settings {
  return {
    ...DEFAULT_SETTINGS,
    workspacePath: DEMO_WORKSPACE_PATH,
  };
}
