import { toast } from "sonner";
import { connectDatabase } from "@/lib/tauri";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { ConnectionConfig } from "@/components/workspace/mock-data";

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : String(error);
}

export function useConnectionActions() {
  const {
    setConnection,
    setConnectionStatus,
    setDatabaseTables,
    removeConnection,
    connectionStatus,
  } = useWorkspace();

  const connect = async (id: string, config: ConnectionConfig) => {
    if (connectionStatus.get(id) === "connecting") {
      return;
    }
    setConnectionStatus(id, "connecting");
    try {
      const tables = await connectDatabase(config);
      setConnection(id, config);
      setDatabaseTables(id, tables);
      setConnectionStatus(id, "connected");
      toast.success(`Connected - ${tables.length} tables`);
    } catch (error) {
      setConnectionStatus(id, "error");
      toast.error(errorMessage(error));
    }
  };

  const disconnect = (id: string) => {
    removeConnection(id);
    setConnectionStatus(id, "idle");
  };

  return { connect, disconnect };
}
