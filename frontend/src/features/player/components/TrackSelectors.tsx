import { useLiveSocket } from "../../../shared/realtime/context";
import { Badge } from "../../../shared/ui/badge";
import { Label, Select } from "../../../shared/ui/input";
import {
  PLAYBACK_MODE_LABEL,
  describeAudioTrack,
  describeSubtitleTrack,
  playbackModeFor,
  type MediaItem
} from "../../library/schemas/media";
import { useUpdateSession } from "../hooks/useSession";
import type { Session } from "../schemas/session";

export interface TrackSelectorsProps {
  readonly media: MediaItem;
  readonly session: Session;
}

const NO_SUBTITLE = "";

export function TrackSelectors({ media, session }: TrackSelectorsProps) {
  const update = useUpdateSession();
  const live = useLiveSocket();
  const audioStreamIndex = session.audioStreamIndex ?? media.audioTracks[0]?.streamIndex ?? null;
  const mode = playbackModeFor(media, audioStreamIndex);

  function changeAudio(value: string) {
    const next = Number(value);
    update.mutate({ audioStreamIndex: next });
    live.send({
      type: "command",
      command: "setAudio",
      mediaId: media.id,
      audioStreamIndex: next,
      positionSec: Math.floor(live.receiverStatus?.positionSec ?? session.positionSec)
    });
  }

  function changeSubtitle(value: string) {
    const subtitleId = value === NO_SUBTITLE ? null : value;
    update.mutate({ subtitleId });
    live.send({ type: "command", command: "setSubtitle", mediaId: media.id, subtitleId });
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label htmlFor="audio-track">Faixa de áudio</Label>
          <Badge tone={mode === "direct-play" ? "success" : "info"}>{PLAYBACK_MODE_LABEL[mode]}</Badge>
        </div>
        <Select
          id="audio-track"
          value={audioStreamIndex === null ? "" : String(audioStreamIndex)}
          disabled={media.audioTracks.length === 0}
          onChange={(event) => {
            changeAudio(event.target.value);
          }}
        >
          {media.audioTracks.length === 0 ? <option value="">Sem áudio</option> : null}
          {media.audioTracks.map((track) => (
            <option key={track.streamIndex} value={String(track.streamIndex)}>
              {describeAudioTrack(track)}
              {track.isNativeTvCompatible ? "" : " → AAC"}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="subtitle-track">Legenda</Label>
        <Select
          id="subtitle-track"
          value={session.subtitleId ?? NO_SUBTITLE}
          onChange={(event) => {
            changeSubtitle(event.target.value);
          }}
        >
          <option value={NO_SUBTITLE}>Sem legenda</option>
          {media.subtitleTracks.map((track) => (
            <option key={track.id} value={track.id}>
              {describeSubtitleTrack(track)}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
