import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "../../../test/render";
import { backend, liveSocket, server } from "../../../test/server";

describe("ReceiverPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("links to the sidecar's LAN /receiver from inside Tauri, not tauri://localhost", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    renderApp("/receiver");

    const link = await screen.findByRole("link", { name: "http://192.168.1.20:4321/receiver" });
    expect(link).toHaveAttribute("href", "http://192.168.1.20:4321/receiver");
    expect(screen.getByText(/Web Receiver em HTML\/JS puro, sem dependências/)).toBeInTheDocument();
  });

  it("shows the LAN receiver URL and the status the TV broadcasts over /ws", async () => {
    server.use(
      liveSocket.addEventListener("connection", ({ client }) => {
        client.send(JSON.stringify({ type: "status", state: "playing", mediaId: "m-direct", title: "Filme Direto", positionSec: 65, durationSec: 5400 }));
      })
    );
    renderApp("/receiver");

    expect(await screen.findByRole("link", { name: "http://192.168.1.20:4321/receiver" })).toHaveAttribute("target", "_blank");
    expect(await screen.findByText("Canal em tempo real ativo")).toBeInTheDocument();
    expect(await screen.findByText("Reproduzindo")).toBeInTheDocument();
    expect(screen.getByText("01:05 / 1:30:00")).toBeInTheDocument();
    await waitFor(() => { expect(backend.socketFrames).toContainEqual({ type: "register", role: "controller" }); });
  });
});
