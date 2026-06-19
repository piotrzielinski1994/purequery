import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { Connection } from "@/components/workspace/mock-data";

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

export function ConnectionTab() {
  const { activeNode } = useWorkspace();

  if (!activeNode || activeNode.kind !== "database") {
    return null;
  }

  const { connection } = activeNode;

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
