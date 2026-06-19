import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  mockConsoleLines,
  mockTree,
  type QueryNode,
  type TreeNode,
} from "@/components/workspace/mock-data";

export type QueryTab = "sql" | "params" | "options" | "connection" | "script";
export type ResultTab = "results" | "columns";

type WorkspaceContextValue = {
  tree: TreeNode[];
  consoleLines: string[];
  expandedFolderIds: Set<string>;
  selectedNodeId: string | null;
  openQueryIds: string[];
  activeQueryId: string | null;
  activeQueryTab: QueryTab;
  activeResultTab: ResultTab;
  queriesById: Map<string, QueryNode>;
  activeQuery: QueryNode | null;
  toggleFolder: (id: string) => void;
  selectNode: (id: string) => void;
  setActiveQuery: (id: string) => void;
  closeQuery: (id: string) => void;
  setQueryTab: (tab: QueryTab) => void;
  setResultTab: (tab: ResultTab) => void;
  newQuery: () => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function indexQueries(nodes: TreeNode[]): Map<string, QueryNode> {
  const flatten = (node: TreeNode): QueryNode[] =>
    node.kind === "query" ? [node] : node.children.flatMap(flatten);
  return new Map(nodes.flatMap(flatten).map((query) => [query.id, query]));
}

function toggleInSet(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) {
    next.delete(id);
    return next;
  }
  next.add(id);
  return next;
}

type WorkspaceProviderProps = {
  children: ReactNode;
  tree?: TreeNode[];
  consoleLines?: string[];
  initialExpandedIds?: string[];
  initialActiveQueryId?: string;
};

export function WorkspaceProvider({
  children,
  tree = mockTree,
  consoleLines = mockConsoleLines,
  initialExpandedIds = [],
  initialActiveQueryId,
}: WorkspaceProviderProps) {
  const [drafts, setDrafts] = useState<QueryNode[]>([]);
  const draftCounter = useRef(0);

  const queriesById = useMemo(() => {
    const byId = indexQueries(tree);
    drafts.forEach((draft) => byId.set(draft.id, draft));
    return byId;
  }, [tree, drafts]);

  const [expandedFolderIds, setExpandedFolderIds] = useState(
    () => new Set(initialExpandedIds),
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    initialActiveQueryId ?? null,
  );
  const [openQueryIds, setOpenQueryIds] = useState<string[]>(
    initialActiveQueryId ? [initialActiveQueryId] : [],
  );
  const [activeQueryId, setActiveQueryId] = useState<string | null>(
    initialActiveQueryId ?? null,
  );
  const [activeQueryTab, setActiveQueryTab] = useState<QueryTab>("sql");
  const [activeResultTab, setActiveResultTab] = useState<ResultTab>("results");

  const value = useMemo<WorkspaceContextValue>(() => {
    const selectNode = (id: string) => {
      setSelectedNodeId(id);
      const query = queriesById.get(id);
      if (!query) {
        setExpandedFolderIds((current) => toggleInSet(current, id));
        return;
      }
      setOpenQueryIds((current) =>
        current.includes(id) ? current : [...current, id],
      );
      setActiveQueryId(id);
    };

    const closeQuery = (id: string) => {
      setOpenQueryIds((current) => {
        const index = current.indexOf(id);
        if (index === -1) {
          return current;
        }
        const next = current.filter((openId) => openId !== id);
        setActiveQueryId((active) => {
          if (active !== id) {
            return active;
          }
          return next[Math.min(index, next.length - 1)] ?? null;
        });
        return next;
      });
      setDrafts((current) => current.filter((draft) => draft.id !== id));
    };

    const newQuery = () => {
      draftCounter.current += 1;
      const id = `draft-${draftCounter.current}`;
      const draft: QueryNode = {
        kind: "query",
        id,
        name: "Untitled",
        statementKind: "SELECT",
        target: "",
        sql: "",
        params: [],
        options: [],
        connection: { type: "none" },
        scripts: { pre: "", post: "" },
        result: {
          status: "success",
          timeMs: 0,
          rowCount: 0,
          columns: [],
          rows: [],
          message: "",
        },
      };
      setDrafts((current) => [...current, draft]);
      setOpenQueryIds((current) => [...current, id]);
      setActiveQueryId(id);
    };

    return {
      tree,
      consoleLines,
      expandedFolderIds,
      selectedNodeId,
      openQueryIds,
      activeQueryId,
      activeQueryTab,
      activeResultTab,
      queriesById,
      activeQuery:
        activeQueryId !== null ? (queriesById.get(activeQueryId) ?? null) : null,
      toggleFolder: (id) =>
        setExpandedFolderIds((current) => toggleInSet(current, id)),
      selectNode,
      setActiveQuery: setActiveQueryId,
      closeQuery,
      setQueryTab: setActiveQueryTab,
      setResultTab: setActiveResultTab,
      newQuery,
    };
  }, [
    tree,
    consoleLines,
    expandedFolderIds,
    selectedNodeId,
    openQueryIds,
    activeQueryId,
    activeQueryTab,
    activeResultTab,
    queriesById,
  ]);

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return value;
}
