import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { makeSession } from "../../../test/fixtures";
import { renderApp } from "../../../test/render";
import { API, backend, requestsTo, server } from "../../../test/server";

async function scanAll() {
  const view = renderApp("/tvs");
  await view.user.click(await screen.findByRole("button", { name: "Procurar TVs" }));
  await screen.findByRole("region", { name: "Roku Cozinha" });
  return view;
}

function card(name: string) {
  return within(screen.getByRole("region", { name }));
}

describe("DiscoveryPage", () => {
  it("lists Google Cast, DLNA DMR and Roku ECP devices after a LAN scan", async () => {
    await scanAll();
    expect(card("Sala Chromecast").getByText("Google Cast")).toBeInTheDocument();
    expect(card("Quarto DLNA").getByText("DLNA DMR")).toBeInTheDocument();
    expect(card("Roku Cozinha").getByText("Roku ECP")).toBeInTheDocument();
    expect(card("Roku Cozinha").getByText(/modo limitado/)).toBeInTheDocument();
    expect(requestsTo("/api/tvs/scan")).toHaveLength(1);
  });

  it("casts the active media with its tracks and start position", async () => {
    const { user } = renderApp("/tvs");
    await user.click(await screen.findByRole("button", { name: "Transmitir via Cast" }));

    expect(await screen.findByText("Stream carregado no Google Cast.")).toBeInTheDocument();
    expect(requestsTo("/api/tv/cast/load").map((r) => r.body)).toEqual([
      { tvId: "tv-cast", mediaId: "m-direct", audioStreamIndex: 1, subtitleId: null, startSec: 120 }
    ]);
  });

  it("pushes to a DLNA renderer and hides the raw SOAP reply", async () => {
    const { user } = await scanAll();
    await user.click(card("Quarto DLNA").getByRole("button", { name: "Enviar via DLNA" }));

    expect(await screen.findByText("Comando enviado para a TV.")).toBeInTheDocument();
    expect(requestsTo("/api/tv/dlna/push").map((r) => r.body)).toEqual([
      { tvId: "tv-dlna", mediaId: "m-direct", audioStreamIndex: 1, subtitleId: null }
    ]);
  });

  it("launches the Roku app and drives it with ECP keys", async () => {
    const { user } = await scanAll();
    const roku = card("Roku Cozinha");
    await user.click(roku.getByRole("button", { name: "Abrir na Roku" }));
    await user.click(roku.getByRole("button", { name: "Selecionar TV" }));

    const remote = within(await screen.findByRole("region", { name: "Controle remoto · Roku Cozinha" }));
    await user.click(remote.getByRole("button", { name: "Home" }));

    await waitFor(() => { expect(requestsTo("/api/tv/roku/keypress").map((r) => r.body)).toEqual([{ tvId: "tv-roku", key: "Home" }]); });
    expect(requestsTo("/api/tv/roku/launch").map((r) => r.body)).toEqual([{ tvId: "tv-roku" }]);
    expect(requestsTo("/api/session").map((r) => r.body)).toEqual([{ selectedTvId: "tv-roku" }]);
  });

  it("sends Cast transport and volume commands to the selected TV", async () => {
    const { user } = renderApp("/tvs");
    const remote = within(await screen.findByRole("region", { name: "Controle remoto · Sala Chromecast" }));

    await user.click(remote.getByRole("button", { name: "Pausar" }));
    await user.click(remote.getByRole("button", { name: "Aumentar volume" }));
    await user.click(remote.getByRole("button", { name: "Diminuir volume" }));

    await waitFor(() => {
      expect(requestsTo("/api/tv/cast/control").map((r) => r.body)).toEqual([
        { tvId: "tv-cast", action: "PAUSE" },
        { tvId: "tv-cast", action: "VOLUME", value: 0.6 },
        { tvId: "tv-cast", action: "VOLUME", value: 0.5 }
      ]);
    });
    expect(await screen.findByText("Comando VOLUME aplicado na TV.")).toBeInTheDocument();
  });

  it("explains that DLNA renderers have no remote here", async () => {
    const { user } = await scanAll();
    await user.click(card("Quarto DLNA").getByRole("button", { name: "Selecionar TV" }));
    expect(await screen.findByText("Renderizadores DLNA usam o controle remoto da própria TV.")).toBeInTheDocument();
  });

  it("shows the server error when the TV rejects the stream", async () => {
    server.use(
      http.post(`${API}/api/tv/cast/load`, () =>
        HttpResponse.json({ ok: false, status: 504, detail: "Timeout", error: "Timeout na sessão CastV2 (:8009)." }, { status: 504 })
      )
    );
    const { user } = renderApp("/tvs");
    await user.click(await screen.findByRole("button", { name: "Transmitir via Cast" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Timeout na sessão CastV2 (:8009).");
  });

  it("blocks sending media until one is selected and downloaded", async () => {
    backend.session = makeSession({ mediaId: "m-remux" });
    renderApp("/tvs");
    const send = await screen.findByRole("button", { name: "Transmitir via Cast" });
    expect(send).toBeDisabled();
    expect(send).toHaveAccessibleDescription("O vídeo ainda está em download.");
  });

  it("reports when no TV answers the scan", async () => {
    backend.tvs = [];
    backend.scannedTvs = [];
    renderApp("/tvs");
    expect(await screen.findByText(/Nenhuma TV encontrada/)).toBeInTheDocument();
  });
});
