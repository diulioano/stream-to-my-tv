import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { AppRoutes } from "../App";
import { LiveSocketProvider } from "../shared/realtime/LiveSocketProvider";

export function renderApp(route = "/"): RenderResult & { user: ReturnType<typeof userEvent.setup>; client: QueryClient } {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } }
  });
  const user = userEvent.setup();
  const result = render(
    <QueryClientProvider client={client}>
      <LiveSocketProvider>
        <MemoryRouter initialEntries={[route]}>
          <AppRoutes />
        </MemoryRouter>
      </LiveSocketProvider>
    </QueryClientProvider>
  );
  return { ...result, user, client };
}
