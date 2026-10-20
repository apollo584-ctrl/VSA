"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { AuthGate } from "@/components/auth/AuthGate";
import { WorkspaceProvider } from "@/hooks/workspace";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 60_000 } } }));
  return (
    <QueryClientProvider client={client}>
      <WorkspaceProvider><AuthGate>{children}</AuthGate></WorkspaceProvider>
    </QueryClientProvider>
  );
}
