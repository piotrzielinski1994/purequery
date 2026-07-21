import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { installBrowserDefaultGuards } from "@/lib/browser-defaults";

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false },
        },
      }),
  );

  // Suppress the native browser context menu app-wide (desktop app, not a web page).
  useEffect(() => installBrowserDefaultGuards(window), []);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
