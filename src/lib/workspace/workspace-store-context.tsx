import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { TreeNode } from "@/lib/workspace/model";
import {
  dehydrate,
  hydrate,
  type WorkspaceStore,
} from "@/lib/workspace/workspace";

type WorkspaceStoreContextValue = {
  tree: TreeNode[];
  persistTree: (tree: TreeNode[]) => void;
};

const WorkspaceStoreContext = createContext<WorkspaceStoreContextValue | null>(
  null,
);

type WorkspaceStoreProviderProps = {
  store: WorkspaceStore;
  children: ReactNode;
};

export function WorkspaceStoreProvider({
  store,
  children,
}: WorkspaceStoreProviderProps) {
  const [tree, setTree] = useState<TreeNode[] | null>(null);

  useEffect(() => {
    let isMounted = true;
    store.load().then((workspace) => {
      if (isMounted) {
        setTree(hydrate(workspace.tree));
      }
    });
    return () => {
      isMounted = false;
    };
  }, [store]);

  const persistTree = useCallback(
    (next: TreeNode[]) => {
      setTree(next);
      store.save(dehydrate(next));
    },
    [store],
  );

  const value = useMemo<WorkspaceStoreContextValue | null>(
    () => (tree === null ? null : { tree, persistTree }),
    [tree, persistTree],
  );

  if (value === null) {
    return null;
  }

  return (
    <WorkspaceStoreContext.Provider value={value}>
      {children}
    </WorkspaceStoreContext.Provider>
  );
}

export function useWorkspaceStore(): WorkspaceStoreContextValue {
  const value = useContext(WorkspaceStoreContext);
  if (!value) {
    throw new Error(
      "useWorkspaceStore must be used within a WorkspaceStoreProvider",
    );
  }
  return value;
}
