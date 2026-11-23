import { describeError } from "../../../shared/api/client";
import { Alert } from "../../../shared/ui/alert";
import { Button } from "../../../shared/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "../../../shared/ui/card";
import { useNetworkQuery } from "../../network/hooks/useNetwork";
import { useSessionQuery, useUpdateSession } from "../../player/hooks/useSession";
import { useDownloadPolling, useGenerateSample, useLibraryQuery, useRefreshLibrary } from "../hooks/useLibrary";
import { defaultTrackChoice, type MediaItem } from "../schemas/media";
import { MediaCard } from "./MediaCard";
import { ScanFolderForm } from "./ScanFolderForm";

function uniquePaths(paths: readonly (string | null | undefined)[]): string[] {
  return [...new Set(paths.filter((p): p is string => typeof p === "string" && p.length > 0))];
}

export function LibraryPage() {
  const library = useLibraryQuery();
  const network = useNetworkQuery();
  const session = useSessionQuery();
  const selectMedia = useUpdateSession();
  const refresh = useRefreshLibrary();
  const sample = useGenerateSample();
  const downloading = useDownloadPolling(library.data?.items);

  const quickPaths = uniquePaths([
    network.data?.suggestedDownloadsDir,
    ...(network.data?.lastScannedPaths ?? library.data?.lastScannedPaths ?? [])
  ]);

  function handleSelect(media: MediaItem) {
    selectMedia.mutate({ mediaId: media.id, ...defaultTrackChoice(media), positionSec: 0 });
  }

  const actionError = refresh.error ?? sample.error ?? selectMedia.error;

  return (
    <div className="space-y-4">
      <Card aria-labelledby="scan-title">
        <CardHeader>
          <div>
            <CardTitle id="scan-title">Adicionar vídeos</CardTitle>
            <CardDescription>Escaneie uma pasta local. Nada sai da sua rede.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                refresh.mutate();
              }}
              disabled={refresh.isPending}
            >
              {refresh.isPending ? "Atualizando…" : "Atualizar biblioteca"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                sample.mutate();
              }}
              disabled={sample.isPending}
            >
              {sample.isPending ? "Gerando…" : "Gerar vídeo de exemplo"}
            </Button>
          </div>
        </CardHeader>
        <ScanFolderForm quickPaths={quickPaths} />
      </Card>

      {actionError ? <Alert tone="error">{describeError(actionError)}</Alert> : null}
      {downloading ? <Alert>Downloads em andamento. A biblioteca atualiza sozinha.</Alert> : null}

      <section aria-labelledby="catalog-title" className="space-y-3">
        <h2 id="catalog-title" className="text-lg font-semibold">
          Biblioteca
        </h2>
        {library.isPending ? <p role="status">Carregando biblioteca…</p> : null}
        {library.isError ? <Alert tone="error">{describeError(library.error)}</Alert> : null}
        {library.data?.items.length === 0 ? (
          <p className="text-sm text-muted">Nenhum vídeo ainda. Escaneie uma pasta ou gere um exemplo.</p>
        ) : null}
        <ul className="space-y-3" aria-label="Vídeos">
          {library.data?.items.map((media) => {
            const selected = session.data?.mediaId === media.id;
            return (
              <MediaCard
                key={media.id}
                media={media}
                selected={selected}
                audioStreamIndex={selected ? (session.data?.audioStreamIndex ?? null) : null}
                onSelect={handleSelect}
                selecting={selectMedia.isPending}
              />
            );
          })}
        </ul>
      </section>
    </div>
  );
}
