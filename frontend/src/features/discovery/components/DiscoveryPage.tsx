import { describeError } from "../../../shared/api/client";
import { Alert } from "../../../shared/ui/alert";
import { Button } from "../../../shared/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "../../../shared/ui/card";
import { isDownloadPending, type MediaItem } from "../../library/schemas/media";
import { useActiveMedia, useUpdateSession } from "../../player/hooks/useSession";
import type { Session } from "../../player/schemas/session";
import { castLoad, dlnaPush, rokuLaunch } from "../api/tvs";
import { useScanTvs, useTvCommand, useTvsQuery } from "../hooks/useTvs";
import { PROTOCOL_LABEL, type CommandResult, type DiscoveredTv } from "../schemas/tv";
import { RemoteControls } from "./RemoteControls";
import { TvCard } from "./TvCard";

const MAX_DETAIL_LENGTH = 160;

function mediaBlockedReason(media: MediaItem | null): string | null {
  if (!media) return "Selecione um vídeo na biblioteca.";
  if (isDownloadPending(media)) return "O vídeo ainda está em download.";
  return null;
}

function sendCommand(tv: DiscoveredTv, media: MediaItem | null, session: Session | undefined): Promise<CommandResult> {
  if (tv.protocol === "roku-ecp") return rokuLaunch(tv.id);
  if (!media) return Promise.reject(new Error("Selecione um vídeo na biblioteca."));
  const target = {
    tvId: tv.id,
    mediaId: media.id,
    audioStreamIndex: session?.audioStreamIndex ?? media.audioTracks[0]?.streamIndex ?? null,
    subtitleId: session?.subtitleId ?? null
  };
  return tv.protocol === "google-cast"
    ? castLoad({ ...target, startSec: Math.floor(session?.positionSec ?? 0) })
    : dlnaPush(target);
}

function successMessage(result: CommandResult): string {
  return result.detail && result.detail.length <= MAX_DETAIL_LENGTH ? result.detail : "Comando enviado para a TV.";
}

export function DiscoveryPage() {
  const tvs = useTvsQuery();
  const scan = useScanTvs();
  const command = useTvCommand();
  const selectTv = useUpdateSession();
  const { session, media } = useActiveMedia();

  const list = tvs.data ?? [];
  const selectedTv = list.find((tv) => tv.id === session?.selectedTvId) ?? list[0] ?? null;
  const mediaReason = mediaBlockedReason(media);

  function run(commandFn: () => Promise<CommandResult>) {
    command.mutate(commandFn);
  }

  return (
    <div className="space-y-4">
      <Card aria-labelledby="tvs-title">
        <CardHeader>
          <div>
            <CardTitle id="tvs-title">TVs na rede local</CardTitle>
            <CardDescription>Google Cast, DLNA DMR e Roku ECP via SSDP/mDNS na sua LAN.</CardDescription>
          </div>
          <Button
            onClick={() => {
              scan.mutate();
            }}
            disabled={scan.isPending}
          >
            {scan.isPending ? "Procurando…" : "Procurar TVs"}
          </Button>
        </CardHeader>
        {tvs.isPending ? <p role="status">Carregando TVs…</p> : null}
        {tvs.isError ? <Alert tone="error">{describeError(tvs.error)}</Alert> : null}
        {scan.isError ? <Alert tone="error">{describeError(scan.error)}</Alert> : null}
        {tvs.isSuccess && list.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma TV encontrada. Ligue a TV na mesma rede e procure de novo.</p>
        ) : null}
        <ul className="space-y-3" aria-label="TVs encontradas">
          {list.map((tv) => (
            <TvCard
              key={tv.id}
              tv={tv}
              selected={selectedTv?.id === tv.id}
              sendBlockedReason={mediaReason}
              busy={command.isPending}
              onSelect={() => {
                selectTv.mutate({ selectedTvId: tv.id });
              }}
              onSend={() => {
                run(() => sendCommand(tv, media, session));
              }}
            />
          ))}
        </ul>
      </Card>

      {command.isError ? <Alert tone="error">{describeError(command.error)}</Alert> : null}
      {command.isSuccess ? <Alert tone="success">{successMessage(command.data)}</Alert> : null}

      {selectedTv ? (
        <Card aria-labelledby="remote-title">
          <CardHeader>
            <CardTitle id="remote-title">Controle remoto · {selectedTv.name}</CardTitle>
            <CardDescription>{PROTOCOL_LABEL[selectedTv.protocol]}</CardDescription>
          </CardHeader>
          <RemoteControls tv={selectedTv} run={run} busy={command.isPending} />
        </Card>
      ) : null}
    </div>
  );
}
