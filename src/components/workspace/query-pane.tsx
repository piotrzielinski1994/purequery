import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  PANE_TABS_LIST,
  PANE_TABS_TRIGGER,
} from "@/components/workspace/pane-tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { KeyValueTable } from "@/components/workspace/key-value-table";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type {
  Connection,
  QueryNode,
} from "@/components/workspace/mock-data";

const CONNECTION_TYPE_LABELS: Record<Connection["type"], string> = {
  none: "None",
  password: "Username & Password",
  token: "Token",
};

function ConnectionFields({ connection }: { connection: Connection }) {
  if (connection.type === "none") {
    return <p className="text-sm text-muted-foreground">No connection auth</p>;
  }

  if (connection.type === "token") {
    return (
      <div className="flex flex-col gap-1">
        <label htmlFor="conn-token" className="text-xs text-muted-foreground">
          Token
        </label>
        <Input
          id="conn-token"
          readOnly
          value={connection.token}
          className="font-mono"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="conn-username" className="text-xs text-muted-foreground">
          Username
        </label>
        <Input id="conn-username" readOnly value={connection.username} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="conn-password" className="text-xs text-muted-foreground">
          Password
        </label>
        <PasswordField value={connection.password} />
      </div>
    </div>
  );
}

function PasswordField({ value }: { value: string }) {
  const [isVisible, setIsVisible] = useState(false);
  const Icon = isVisible ? EyeOff : Eye;

  return (
    <div className="relative">
      <Input
        id="conn-password"
        type={isVisible ? "text" : "password"}
        readOnly
        value={value}
        className="pr-9"
      />
      <button
        type="button"
        aria-label={isVisible ? "Hide password" : "Show password"}
        aria-pressed={isVisible}
        onClick={() => setIsVisible((visible) => !visible)}
        className="absolute inset-y-0 right-0 flex items-center px-2 text-muted-foreground hover:text-foreground"
      >
        <Icon className="size-4" />
      </button>
    </div>
  );
}

function ConnectionPanel({ connection }: { connection: Connection }) {
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Type</label>
        <Select value={connection.type}>
          <SelectTrigger aria-label="Connection type" className="w-56 text-xs">
            {CONNECTION_TYPE_LABELS[connection.type]}
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="none">None</SelectItem>
            <SelectItem value="password">Username & Password</SelectItem>
            <SelectItem value="token">Token</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <ConnectionFields connection={connection} />
    </div>
  );
}

function QueryTabs({ query }: { query: QueryNode }) {
  const { activeQueryTab, setQueryTab } = useWorkspace();

  return (
    <Tabs
      value={activeQueryTab}
      onValueChange={(value) => setQueryTab(value as typeof activeQueryTab)}
      className="flex h-full flex-col gap-0"
    >
      <div className="flex h-10.25 items-stretch border-b bg-muted/30">
        <TabsList aria-label="Query sections" className={PANE_TABS_LIST}>
          <TabsTrigger value="sql" className={PANE_TABS_TRIGGER}>
            SQL
          </TabsTrigger>
          <TabsTrigger value="params" className={PANE_TABS_TRIGGER}>
            Params
          </TabsTrigger>
          <TabsTrigger value="options" className={PANE_TABS_TRIGGER}>
            Options
          </TabsTrigger>
          <TabsTrigger value="connection" className={PANE_TABS_TRIGGER}>
            Connection
          </TabsTrigger>
          <TabsTrigger value="script" className={PANE_TABS_TRIGGER}>
            Script
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="sql">
        <pre className="p-3 font-mono text-xs">{query.sql || "-- no SQL"}</pre>
      </TabsContent>
      <TabsContent value="params">
        <KeyValueTable rows={query.params} emptyLabel="No bind params" />
      </TabsContent>
      <TabsContent value="options">
        <KeyValueTable rows={query.options} emptyLabel="No options" />
      </TabsContent>
      <TabsContent value="connection">
        <ConnectionPanel connection={query.connection} />
      </TabsContent>
      <TabsContent value="script">
        <pre className="p-3 font-mono text-xs text-muted-foreground">
          {query.scripts.pre || "-- no pre-query script"}
        </pre>
      </TabsContent>
    </Tabs>
  );
}

export function QueryPane() {
  const { activeQuery } = useWorkspace();

  if (!activeQuery) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No query selected
      </div>
    );
  }

  return <QueryTabs query={activeQuery} />;
}
