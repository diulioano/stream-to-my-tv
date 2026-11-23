import { useState } from "react";
import { Button } from "../../../shared/ui/button";
import { castControl, rokuKeypress } from "../api/tvs";
import { ROKU_KEYS, type CastAction, type CommandResult, type DiscoveredTv } from "../schemas/tv";

const VOLUME_STEP = 0.1;

const CAST_BUTTONS: readonly { readonly action: CastAction; readonly label: string }[] = [
  { action: "PLAY", label: "Reproduzir" },
  { action: "PAUSE", label: "Pausar" },
  { action: "STOP", label: "Parar" },
  { action: "SUBTITLE_ON", label: "Legenda ligada" },
  { action: "SUBTITLE_OFF", label: "Legenda desligada" }
];

export interface RemoteControlsProps {
  readonly tv: DiscoveredTv;
  readonly run: (command: () => Promise<CommandResult>) => void;
  readonly busy: boolean;
}

function CastRemote({ tv, run, busy }: RemoteControlsProps) {
  const [volume, setVolume] = useState(0.5);

  function changeVolume(delta: number) {
    const next = Math.round(Math.min(1, Math.max(0, volume + delta)) * 10) / 10;
    setVolume(next);
    run(() => castControl(tv.id, "VOLUME", next));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {CAST_BUTTONS.map(({ action, label }) => (
          <Button
            key={action}
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => {
              run(() => castControl(tv.id, action));
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-2" role="group" aria-label="Volume da TV">
        <Button
          variant="secondary"
          size="sm"
          aria-label="Diminuir volume"
          disabled={busy || volume <= 0}
          onClick={() => {
            changeVolume(-VOLUME_STEP);
          }}
        >
          −
        </Button>
        <span className="w-12 text-center text-sm tabular-nums" aria-live="polite">
          {Math.round(volume * 100)}%
        </span>
        <Button
          variant="secondary"
          size="sm"
          aria-label="Aumentar volume"
          disabled={busy || volume >= 1}
          onClick={() => {
            changeVolume(VOLUME_STEP);
          }}
        >
          +
        </Button>
      </div>
    </div>
  );
}

function RokuRemote({ tv, run, busy }: RemoteControlsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {ROKU_KEYS.map((key) => (
        <Button
          key={key}
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => {
            run(() => rokuKeypress(tv.id, key));
          }}
        >
          {key}
        </Button>
      ))}
    </div>
  );
}

export function RemoteControls(props: RemoteControlsProps) {
  switch (props.tv.protocol) {
    case "google-cast":
      return <CastRemote {...props} />;
    case "roku-ecp":
      return <RokuRemote {...props} />;
    case "dlna-dmr":
      return <p className="text-sm text-muted">Renderizadores DLNA usam o controle remoto da própria TV.</p>;
  }
}
