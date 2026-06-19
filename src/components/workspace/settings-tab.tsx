import { useState, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/components/workspace/workspace-context";

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
      </label>
      {children}
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
        className="pr-9 font-mono"
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

export function SettingsTab() {
  const { activeNode } = useWorkspace();

  if (!activeNode || activeNode.kind !== "database") {
    return null;
  }

  const { host, port, database, user, password } = activeNode;

  return (
    <div className="flex max-w-md flex-col gap-3 p-3">
      <Field label="Host" htmlFor="conn-host">
        <Input id="conn-host" readOnly value={host} />
      </Field>
      <div className="flex gap-3">
        <div className="w-28">
          <Field label="Port" htmlFor="conn-port">
            <Input id="conn-port" readOnly value={String(port)} />
          </Field>
        </div>
        <div className="flex-1">
          <Field label="Database" htmlFor="conn-database">
            <Input id="conn-database" readOnly value={database} />
          </Field>
        </div>
      </div>
      <Field label="User" htmlFor="conn-user">
        <Input id="conn-user" readOnly value={user} />
      </Field>
      <Field label="Password" htmlFor="conn-password">
        <PasswordField value={password} />
      </Field>
    </div>
  );
}
