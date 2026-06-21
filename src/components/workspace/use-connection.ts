import { toast } from "sonner";
import { connectDatabase } from "@/lib/tauri";
import { toResult } from "@/lib/result";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { ConnectionConfig } from "@/lib/workspace/model";

export function useConnectionActions() {
  const {
    setConnection,
    setConnectionStatus,
    setDatabaseTables,
    removeConnection,
    updateDatabaseConfig,
    connectionStatus,
  } = useWorkspace();

  const connect = async (id: string, config: ConnectionConfig) => {
    if (connectionStatus.get(id) === "connecting") {
      return;
    }
    setConnectionStatus(id, "connecting");
    const result = await toResult(connectDatabase(config));
    if (!result.ok) {
      setConnectionStatus(id, "error");
      toast.error(result.error);
      return;
    }
    const tables = result.value;
    setConnection(id, config);
    updateDatabaseConfig(id, config);
    setDatabaseTables(id, tables);
    setConnectionStatus(id, "connected");
    toast.success(`Connected - ${tables.length} tables`);
  };

  const disconnect = (id: string) => {
    removeConnection(id);
    setConnectionStatus(id, "idle");
  };

  return { connect, disconnect };
}
