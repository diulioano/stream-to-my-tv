import { Link } from "react-router";
import { useLiveSocket } from "../../../shared/realtime/context";
import { Alert } from "../../../shared/ui/alert";
import { Badge } from "../../../shared/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "../../../shared/ui/card";
import { isDownloadPending } from "../../library/schemas/media";
import { useActiveMedia } from "../hooks/useSession";
import { PlaybackControls } from "./PlaybackControls";
import { SubtitleUploadForm } from "./SubtitleUploadForm";
import { TrackSelectors } from "./TrackSelectors";

export function PlayerPage() {
  const { session, media, isLoading } = useActiveMedia();
  const live = useLiveSocket();

  if (isLoading) return <p role="status">Carregando sessão…</p>;
  if (!session || !media) {
    return (
      <Alert title="Nenhum vídeo selecionado">
        Escolha um vídeo na <Link to="/" className="underline">biblioteca</Link> para controlar a reprodução.
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <Card aria-labelledby="now-playing-title">
        <CardHeader>
          <div className="min-w-0">
            <CardDescription>Sessão ativa</CardDescription>
            <CardTitle id="now-playing-title" className="truncate text-lg">
              {media.title}
            </CardTitle>
          </div>
          <Badge tone={live.connected ? "success" : "danger"}>
            {live.connected ? "Tempo real conectado" : "Tempo real desconectado"}
          </Badge>
        </CardHeader>
        {isDownloadPending(media) ? (
          <Alert tone="error" className="mb-3">
            {media.downloadStatus?.reason ?? "O arquivo ainda está em download."}
          </Alert>
        ) : null}
        <PlaybackControls media={media} session={session} />
      </Card>

      <Card aria-labelledby="tracks-title">
        <CardHeader>
          <CardTitle id="tracks-title">Áudio e legendas</CardTitle>
        </CardHeader>
        <div className="space-y-4">
          <TrackSelectors media={media} session={session} />
          <SubtitleUploadForm mediaId={media.id} />
        </div>
      </Card>
    </div>
  );
}
