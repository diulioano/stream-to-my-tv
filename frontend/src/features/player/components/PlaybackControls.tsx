import { useState } from "react";
import { formatTime } from "../../../shared/lib/format";
import { useLiveSocket } from "../../../shared/realtime/context";
import { Button } from "../../../shared/ui/button";
import { playbackModeFor, type MediaItem } from "../../library/schemas/media";
import { useUpdateSession } from "../hooks/useSession";
import type { Session } from "../schemas/session";

const SKIP_BACK_SEC = 10;
const SKIP_FORWARD_SEC = 30;

export interface PlaybackControlsProps {
  readonly media: MediaItem;
  readonly session: Session;
}

export function PlaybackControls({ media, session }: PlaybackControlsProps) {
  const live = useLiveSocket();
  const update = useUpdateSession();
  const [draftSec, setDraftSec] = useState<number | null>(null);

  const remote = live.receiverStatus?.mediaId === media.id ? live.receiverStatus : null;
  const positionSec = remote?.positionSec ?? session.positionSec;
  const durationSec = remote && remote.durationSec > 0 ? remote.durationSec : media.durationSec;
  const playing = remote ? remote.state === "playing" : session.playing;
  const shownSec = draftSec ?? positionSec;

  function setPlaying(next: boolean) {
    live.send({ type: "command", command: next ? "play" : "pause" });
    update.mutate({ playing: next });
  }

  function seek(target: number) {
    const clamped = Math.max(0, Math.min(Math.floor(target), Math.floor(durationSec)));
    live.send({ type: "command", command: "seek", positionSec: clamped });
    update.mutate({ positionSec: clamped });
    setDraftSec(null);
  }

  function commitDraft() {
    if (draftSec !== null) seek(draftSec);
  }

  function loadOnReceiver() {
    const audioStreamIndex = session.audioStreamIndex ?? media.audioTracks[0]?.streamIndex ?? null;
    live.send({
      type: "command",
      command: "load",
      mediaId: media.id,
      title: media.title,
      audioStreamIndex,
      subtitleId: session.subtitleId,
      startSec: Math.floor(positionSec),
      durationSec: media.durationSec,
      canDirectPlay: playbackModeFor(media, audioStreamIndex) === "direct-play"
    });
    update.mutate({ playing: true });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="w-16 text-right text-xs tabular-nums" aria-hidden="true">
          {formatTime(shownSec)}
        </span>
        <input
          type="range"
          aria-label="Posição"
          aria-valuetext={`${formatTime(shownSec)} de ${formatTime(durationSec)}`}
          min={0}
          max={Math.max(1, Math.floor(durationSec))}
          value={Math.floor(shownSec)}
          onChange={(event) => {
            setDraftSec(Number(event.target.value));
          }}
          onPointerUp={commitDraft}
          onKeyUp={commitDraft}
          className="h-2 flex-1 accent-(--color-primary)"
        />
        <span className="w-16 text-xs tabular-nums" aria-hidden="true">
          {formatTime(durationSec)}
        </span>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Controles de reprodução">
        <Button
          variant="secondary"
          onClick={() => {
            seek(positionSec - SKIP_BACK_SEC);
          }}
        >
          −{SKIP_BACK_SEC}s
        </Button>
        <Button
          onClick={() => {
            setPlaying(!playing);
          }}
        >
          {playing ? "Pausar" : "Reproduzir"}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            seek(positionSec + SKIP_FORWARD_SEC);
          }}
        >
          +{SKIP_FORWARD_SEC}s
        </Button>
        <Button variant="secondary" onClick={loadOnReceiver} disabled={!live.connected}>
          Enviar ao Web Receiver
        </Button>
      </div>
    </div>
  );
}
