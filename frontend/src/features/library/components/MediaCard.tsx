import { formatBytes, formatTime } from "../../../shared/lib/format";
import { Badge } from "../../../shared/ui/badge";
import { Button } from "../../../shared/ui/button";
import { Card, CardHeader, CardTitle } from "../../../shared/ui/card";
import { PLAYBACK_MODE_LABEL, playbackModeFor, type MediaItem } from "../schemas/media";

export interface MediaCardProps {
  readonly media: MediaItem;
  readonly selected: boolean;
  readonly audioStreamIndex: number | null;
  readonly onSelect: (media: MediaItem) => void;
  readonly selecting: boolean;
}

function DownloadReadiness({ media }: { readonly media: MediaItem }) {
  const status = media.downloadStatus;
  if (!status) return null;
  if (status.ready) return <Badge tone="success">Pronto para transmitir</Badge>;
  const pct = Math.round(Math.min(100, Math.max(0, status.estimatedProgressPct)));
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <Badge tone="warning">Baixando</Badge>
        <span>{pct}%</span>
      </div>
      <div
        role="progressbar"
        aria-label={`Download de ${media.title}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-1.5 overflow-hidden rounded-full bg-surface-muted"
      >
        <div className="h-full bg-warning" style={{ width: `${pct}%` }} />
      </div>
      {status.reason ? <p className="text-xs text-muted">{status.reason}</p> : null}
    </div>
  );
}

export function MediaCard({ media, selected, audioStreamIndex, onSelect, selecting }: MediaCardProps) {
  const mode = playbackModeFor(media, audioStreamIndex);
  const video = media.video;
  const audio = media.audioTracks.find((t) => t.streamIndex === audioStreamIndex) ?? media.audioTracks[0];

  return (
    <li>
      <Card aria-label={media.title} className={selected ? "border-primary" : undefined}>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle className="truncate">{media.title}</CardTitle>
            <p className="truncate text-xs text-muted" title={media.filePath}>
              {media.fileName}
            </p>
          </div>
          <Badge tone={mode === "direct-play" ? "success" : "info"}>{PLAYBACK_MODE_LABEL[mode]}</Badge>
        </CardHeader>
        <dl className="mb-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-muted">Contêiner</dt>
            <dd>{media.container.toUpperCase()}</dd>
          </div>
          <div>
            <dt className="text-muted">Vídeo</dt>
            <dd>{video ? `${video.codec.toUpperCase()} ${video.width}×${video.height}` : "—"}</dd>
          </div>
          <div>
            <dt className="text-muted">Áudio</dt>
            <dd>{audio ? `${audio.codec.toUpperCase()} ${audio.channels}ch` : "—"}</dd>
          </div>
          <div>
            <dt className="text-muted">Duração · Tamanho</dt>
            <dd>
              {formatTime(media.durationSec)} · {formatBytes(media.fileSize)}
            </dd>
          </div>
        </dl>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-40 flex-1">
            <DownloadReadiness media={media} />
          </div>
          <Button
            variant={selected ? "secondary" : "primary"}
            size="sm"
            aria-pressed={selected}
            disabled={selecting}
            onClick={() => {
              onSelect(media);
            }}
          >
            {selected ? "Selecionado" : "Selecionar"}
          </Button>
        </div>
      </Card>
    </li>
  );
}
