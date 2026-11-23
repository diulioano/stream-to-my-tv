import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { HashRouter, NavLink, Route, Routes } from "react-router";
import { DiscoveryPage } from "./features/discovery/components/DiscoveryPage";
import { LibraryPage } from "./features/library/components/LibraryPage";
import { NetworkPage } from "./features/network/components/NetworkPage";
import { ServerStatusBadge } from "./features/network/components/ServerStatusBadge";
import { TrayStatusBadge } from "./features/network/components/TrayStatusBadge";
import { PlayerPage } from "./features/player/components/PlayerPage";
import { ReceiverPage } from "./features/receiver/components/ReceiverPage";
import { cn } from "./shared/lib/cn";
import { LiveSocketProvider } from "./shared/realtime/LiveSocketProvider";

const NAV_ITEMS = [
  { to: "/", label: "Biblioteca", end: true },
  { to: "/player", label: "Player", end: false },
  { to: "/tvs", label: "TVs", end: false },
  { to: "/rede", label: "Rede", end: false },
  { to: "/receiver", label: "Receiver", end: false }
] as const;

export function AppRoutes() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-4">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Stream to my TV</h1>
        <div className="flex flex-wrap items-center gap-2">
          <TrayStatusBadge />
          <ServerStatusBadge />
        </div>
      </header>
      <nav aria-label="Principal" className="mb-4">
        <ul className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface p-1">
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    "block rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary",
                    isActive ? "bg-primary text-primary-foreground" : "text-muted hover:text-foreground"
                  )
                }
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<LibraryPage />} />
          <Route path="/player" element={<PlayerPage />} />
          <Route path="/tvs" element={<DiscoveryPage />} />
          <Route path="/rede" element={<NetworkPage />} />
          <Route path="/receiver" element={<ReceiverPage />} />
        </Routes>
      </main>
    </div>
  );
}

/** Hash routing keeps deep links working under `tauri://localhost` and the Node static server alike. */
export function App({ queryClient }: { readonly queryClient: QueryClient }) {
  return (
    <QueryClientProvider client={queryClient}>
      <LiveSocketProvider>
        <HashRouter>
          <AppRoutes />
        </HashRouter>
      </LiveSocketProvider>
    </QueryClientProvider>
  );
}
