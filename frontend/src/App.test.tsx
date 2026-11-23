import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { createQueryClient } from "./shared/api/queryClient";
import { renderApp } from "./test/render";
import { API, liveSocket, server } from "./test/server";

const TRAY_LABEL = "Bandeja ativa: fechar a janela mantém a transmissão na TV";

describe("App shell", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows tray persistence inside the Tauri desktop shell", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    renderApp();
    expect(await screen.findByText(TRAY_LABEL)).toBeInTheDocument();
  });

  it("hides tray persistence in a plain browser even when /api/status succeeds", async () => {
    renderApp();
    expect(await screen.findByText("Servidor online · 2 vídeos · 1 FFmpeg")).toBeInTheDocument();
    expect(screen.queryByText(TRAY_LABEL)).not.toBeInTheDocument();
  });

  it("shows server health from /api/status", async () => {
    renderApp();
    expect(await screen.findByText("Servidor online · 2 vídeos · 1 FFmpeg")).toBeInTheDocument();
  });

  it("shows the server as offline when /api/status fails", async () => {
    server.use(http.get(`${API}/api/status`, () => HttpResponse.error()));
    renderApp();
    expect(await screen.findByText("Servidor offline")).toBeInTheDocument();
  });

  it("navigates between feature pages", async () => {
    const { user } = renderApp();
    const nav = await screen.findByRole("navigation", { name: "Principal" });
    expect(screen.getByRole("link", { name: "Biblioteca" })).toHaveAttribute("aria-current", "page");

    await user.click(screen.getByRole("link", { name: "Rede" }));
    expect(await screen.findByRole("heading", { name: "Rede local" })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "TVs" }));
    expect(await screen.findByRole("heading", { name: "TVs na rede local" })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Receiver" }));
    expect(await screen.findByRole("heading", { name: "Web Receiver da Smart TV" })).toBeInTheDocument();
    expect(nav).toBeInTheDocument();
  });

  it("boots with hash routing and reconnects the live channel after it drops", async () => {
    let connections = 0;
    server.use(
      liveSocket.addEventListener("connection", ({ client }) => {
        connections += 1;
        if (connections === 1) setTimeout(() => { client.close(); }, 50);
      })
    );
    window.location.hash = "#/receiver";
    render(<App queryClient={createQueryClient()} />);

    expect(await screen.findByRole("heading", { name: "Web Receiver da Smart TV" })).toBeInTheDocument();
    expect(await screen.findByText("Canal desconectado")).toBeInTheDocument();
    expect(await screen.findByText("Canal em tempo real ativo", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(connections).toBe(2);
  });
});
