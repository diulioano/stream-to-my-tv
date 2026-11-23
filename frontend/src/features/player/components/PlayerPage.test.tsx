import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { makeSession } from "../../../test/fixtures";
import { renderApp } from "../../../test/render";
import { backend, liveSocket, requestsTo, server } from "../../../test/server";

async function renderConnectedPlayer() {
  const view = renderApp("/player");
  expect(await screen.findByText("Tempo real conectado")).toBeInTheDocument();
  return view;
}

function sessionBodies() {
  return requestsTo("/api/session").map((r) => r.body);
}

describe("PlayerPage", () => {
  it("asks for a selection when the session has no media", async () => {
    backend.session = makeSession({ mediaId: null });
    renderApp("/player");
    expect(await screen.findByText("Nenhum vídeo selecionado")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "biblioteca" })).toHaveAttribute("href", "/");
  });

  it("switches audio track, updates the session and tells the receiver", async () => {
    const { user } = await renderConnectedPlayer();
    expect(screen.getByRole("heading", { name: "Filme Direto" })).toBeInTheDocument();
    expect(screen.getByText("Direct Play")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Faixa de áudio"), "2");

    expect(await screen.findByText("Remux AAC")).toBeInTheDocument();
    expect(sessionBodies()).toEqual([{ audioStreamIndex: 2 }]);
    expect(backend.socketFrames).toContainEqual({
      type: "command",
      command: "setAudio",
      mediaId: "m-direct",
      audioStreamIndex: 2,
      positionSec: 120
    });
  });

  it("selects and clears subtitles", async () => {
    const { user } = await renderConnectedPlayer();
    const select = screen.getByLabelText("Legenda");

    await user.selectOptions(select, "sub-pt");
    await waitFor(() => { expect(select).toHaveValue("sub-pt"); });
    await user.selectOptions(select, "");

    await waitFor(() => { expect(sessionBodies()).toEqual([{ subtitleId: "sub-pt" }, { subtitleId: null }]); });
    expect(backend.socketFrames).toContainEqual({ type: "command", command: "setSubtitle", mediaId: "m-direct", subtitleId: null });
  });

  it("plays, pauses and seeks", async () => {
    const { user } = await renderConnectedPlayer();

    await user.click(screen.getByRole("button", { name: "Reproduzir" }));
    expect(await screen.findByRole("button", { name: "Pausar" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "+30s" }));
    await user.click(screen.getByRole("button", { name: "−10s" }));

    const slider = screen.getByRole("slider", { name: "Posição" });
    fireEvent.change(slider, { target: { value: "600" } });
    fireEvent.pointerUp(slider);

    await waitFor(() => {
      expect(sessionBodies()).toEqual([{ playing: true }, { positionSec: 150 }, { positionSec: 140 }, { positionSec: 600 }]);
    });
    expect(backend.socketFrames).toEqual(
      expect.arrayContaining([
        { type: "command", command: "play" },
        { type: "command", command: "seek", positionSec: 150 },
        { type: "command", command: "seek", positionSec: 600 }
      ])
    );
  });

  it("loads the active media on the Web Receiver", async () => {
    const { user } = await renderConnectedPlayer();
    await user.click(screen.getByRole("button", { name: "Enviar ao Web Receiver" }));

    await waitFor(() => {
      expect(backend.socketFrames).toContainEqual({
        type: "command",
        command: "load",
        mediaId: "m-direct",
        title: "Filme Direto",
        audioStreamIndex: 1,
        subtitleId: null,
        startSec: 120,
        durationSec: 5400,
        canDirectPlay: true
      });
    });
  });

  it("follows the position the receiver reports for the active media", async () => {
    server.use(
      liveSocket.addEventListener("connection", ({ client }) => {
        client.send(JSON.stringify({ type: "status", state: "playing", mediaId: "m-direct", positionSec: 3600, durationSec: 5400 }));
      })
    );
    renderApp("/player");
    expect(await screen.findByRole("slider", { name: "Posição" })).toHaveAttribute("aria-valuetext", "1:00:00 de 1:30:00");
    expect(await screen.findByRole("button", { name: "Pausar" })).toBeInTheDocument();
  });

  it("refetches the session when another controller relays a command", async () => {
    server.use(
      liveSocket.addEventListener("connection", ({ client }) => {
        backend.session = makeSession({ subtitleId: "sub-pt" });
        client.send(JSON.stringify({ type: "command", command: "setSubtitle", mediaId: "m-direct", subtitleId: "sub-pt" }));
      })
    );
    renderApp("/player");
    await waitFor(() => { expect(screen.getByLabelText("Legenda")).toHaveValue("sub-pt"); });
  });

  it("warns when the active file is still downloading", async () => {
    backend.session = makeSession({ mediaId: "m-remux" });
    renderApp("/player");
    expect(await screen.findByRole("alert")).toHaveTextContent("Cabeçalho moov/ftyp ainda não gravado.");
  });

  it("rejects subtitle files that are not .srt or .vtt", async () => {
    renderApp("/player");
    const user = userEvent.setup({ applyAccept: false });
    const input = await screen.findByLabelText("Arquivo de legenda (.srt ou .vtt)");

    await user.click(screen.getByRole("button", { name: "Enviar legenda" }));
    expect(await screen.findByText("Selecione um arquivo de legenda.")).toBeInTheDocument();

    await user.upload(input, new File(["x"], "legenda.txt", { type: "text/plain" }));
    await user.click(screen.getByRole("button", { name: "Enviar legenda" }));
    expect(await screen.findByText("A legenda precisa ser .srt ou .vtt.")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Idioma"));
    await user.type(screen.getByLabelText("Idioma"), "português!");
    await user.click(screen.getByRole("button", { name: "Enviar legenda" }));
    expect(await screen.findByText("Use um código de idioma como pt-BR ou en.")).toBeInTheDocument();
    expect(requestsTo("/api/media/m-direct/subtitles/upload")).toHaveLength(0);
  });

  it("uploads an .srt and selects the new track", async () => {
    const { user } = await renderConnectedPlayer();
    const srt = "1\n00:00:01,000 --> 00:00:02,000\nOlá\n";

    await user.upload(screen.getByLabelText("Arquivo de legenda (.srt ou .vtt)"), new File([srt], "filme.srt"));
    await user.click(screen.getByRole("button", { name: "Enviar legenda" }));

    expect(await screen.findByText("Legenda adicionada e selecionada.")).toBeInTheDocument();
    expect(requestsTo("/api/media/m-direct/subtitles/upload").map((r) => r.body)).toEqual([
      { fileName: "filme.srt", content: srt, language: "pt-BR" }
    ]);
    await waitFor(() => { expect(screen.getByLabelText("Legenda")).toHaveValue("ext-pt"); });
    expect(backend.socketFrames).toContainEqual({ type: "command", command: "setSubtitle", mediaId: "m-direct", subtitleId: "ext-pt" });
  });
});
