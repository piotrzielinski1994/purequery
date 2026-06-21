import { toast } from "sonner";
import { connectDatabase, fetchSchema } from "@/lib/tauri";
import { toResult } from "@/lib/result";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { ConnectionConfig } from "@/lib/workspace/model";

export function useConnectionActions() {
  const {
    setConnection,
    setConnectionStatus,
    setDatabaseTables,
    setDatabaseSchema,
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

    // Schema feeds the SQL editor's autocomplete; a failure leaves the connection up with no
    // completion data rather than blocking the connect.
    const schema = await toResult(fetchSchema(config));
    setDatabaseSchema(id, schema.ok ? schema.value : []);
  };

  const disconnect = (id: string) => {
    removeConnection(id);
    setConnectionStatus(id, "idle");
  };

  return { connect, disconnect };
}
