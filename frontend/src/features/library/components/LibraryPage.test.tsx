import { act, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "../../../test/render";
import { API, backend, requestsTo, server } from "../../../test/server";

async function findCard(title: string) {
  return within(await screen.findByRole("region", { name: title }));
}

describe("LibraryPage", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows playback mode, codec metadata and download readiness per video", async () => {
    renderApp();

    const direct = await findCard("Filme Direto");
    expect(direct.getByText("Direct Play")).toBeInTheDocument();
    expect(direct.getByText("MP4")).toBeInTheDocument();
    expect(direct.getByText("H264 1920×1080")).toBeInTheDocument();
    expect(direct.getByText("AAC 2ch")).toBeInTheDocument();
    expect(direct.getByText("1:30:00 · 1.5 GB")).toBeInTheDocument();
    expect(direct.getByText("Pronto para transmitir")).toBeInTheDocument();
    expect(direct.getByRole("button", { name: "Selecionado" })).toHaveAttribute("aria-pressed", "true");

    const downloading = await findCard("Série Baixando");
    expect(downloading.getByText("Remux AAC")).toBeInTheDocument();
    expect(downloading.getByRole("progressbar", { name: "Download de Série Baixando" })).toHaveAttribute("aria-valuenow", "42");
    expect(downloading.getByText("Cabeçalho moov/ftyp ainda não gravado.")).toBeInTheDocument();
  });

  it("validates the scan form before calling the server", async () => {
    const { user } = renderApp();
    await user.click(await screen.findByRole("button", { name: "Escanear" }));

    expect(await screen.findByText("Informe ao menos uma pasta ou arquivo para escanear.")).toBeInTheDocument();
    expect(screen.getByLabelText("Pasta ou arquivo de vídeo")).toHaveAttribute("aria-invalid", "true");
    expect(requestsTo("/api/library/scan")).toHaveLength(0);
  });

  it("scans one path as { path } and several as { paths }", async () => {
    const { user } = renderApp();
    const input = await screen.findByLabelText("Pasta ou arquivo de vídeo");

    await user.type(input, "D:/Filmes");
    await user.click(screen.getByRole("button", { name: "Escanear" }));
    expect(await screen.findByText("1 vídeo encontrado.")).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "D:/A; E:/B");
    await user.click(screen.getByRole("button", { name: "Escanear" }));

    await waitFor(() => {
      expect(requestsTo("/api/library/scan").map((r) => r.body)).toEqual([{ path: "D:/Filmes" }, { paths: ["D:/A", "E:/B"] }]);
    });
  });

  it("scans a quick path chip from the suggested downloads folder", async () => {
    const { user } = renderApp();
    const chips = within(await screen.findByRole("list", { name: "Pastas sugeridas" }));
    expect(chips.getByRole("button", { name: "D:/Filmes" })).toBeInTheDocument();

    await user.click(chips.getByRole("button", { name: "C:/Users/me/Downloads" }));

    await waitFor(() => {
      expect(requestsTo("/api/library/scan").map((r) => r.body)).toEqual([{ path: "C:/Users/me/Downloads" }]);
    });
    expect(screen.getByLabelText("Pasta ou arquivo de vídeo")).toHaveValue("C:/Users/me/Downloads");
  });

  it("shows the server error when a scan path is restricted", async () => {
    server.use(http.post(`${API}/api/library/scan`, () => HttpResponse.json({ error: "Scan path is restricted" }, { status: 403 })));
    const { user } = renderApp();
    await user.type(await screen.findByLabelText("Pasta ou arquivo de vídeo"), "C:/Windows");
    await user.click(screen.getByRole("button", { name: "Escanear" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Scan path is restricted");
  });

  it("refreshes the catalog and reflects finished downloads", async () => {
    const { user } = renderApp();
    await findCard("Série Baixando");
    await user.click(screen.getByRole("button", { name: "Atualizar biblioteca" }));

    const card = await findCard("Série Baixando");
    expect(await card.findByText("Pronto para transmitir")).toBeInTheDocument();
    expect(card.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("polls refresh on its own while a download is pending", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderApp();
    expect(await screen.findByText("Downloads em andamento. A biblioteca atualiza sozinha.")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    await waitFor(() => {
      expect(requestsTo("/api/library/refresh")).toHaveLength(1);
    });
    await waitFor(() => {
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.queryByText("Downloads em andamento. A biblioteca atualiza sozinha.")).not.toBeInTheDocument();
    });
  });

  it("generates a sample video and selects it", async () => {
    const { user } = renderApp();
    await findCard("Filme Direto");
    await user.click(screen.getByRole("button", { name: "Gerar vídeo de exemplo" }));

    const sample = await findCard("Amostra Gerada");
    expect(await sample.findByRole("button", { name: "Selecionado" })).toBeInTheDocument();
  });

  it("selects a video with its default tracks through POST /api/session", async () => {
    const { user } = renderApp();
    const card = await findCard("Série Baixando");
    await user.click(card.getByRole("button", { name: "Selecionar" }));

    expect(await card.findByRole("button", { name: "Selecionado" })).toBeInTheDocument();
    expect(requestsTo("/api/session").map((r) => r.body)).toEqual([
      { mediaId: "m-remux", audioStreamIndex: 1, subtitleId: null, positionSec: 0 }
    ]);
    expect(backend.session.mediaId).toBe("m-remux");
  });

  it("shows an empty state when nothing is scanned", async () => {
    backend.items = [];
    renderApp();
    expect(await screen.findByText("Nenhum vídeo ainda. Escaneie uma pasta ou gere um exemplo.")).toBeInTheDocument();
  });

  it("reports a library that fails validation", async () => {
    server.use(http.get(`${API}/api/library`, () => HttpResponse.json({ items: [{ id: "x" }] })));
    renderApp();
    expect(await screen.findByRole("alert")).toHaveTextContent("Resposta inválida de /api/library");
  });
});
