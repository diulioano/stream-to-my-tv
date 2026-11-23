import { Badge } from "../../../shared/ui/badge";
import { Button } from "../../../shared/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "../../../shared/ui/card";
import { PROTOCOL_LABEL, type DiscoveredTv } from "../schemas/tv";

const SEND_LABEL: Record<DiscoveredTv["protocol"], string> = {
  "google-cast": "Transmitir via Cast",
  "dlna-dmr": "Enviar via DLNA",
  "roku-ecp": "Abrir na Roku"
};

export interface TvCardProps {
  readonly tv: DiscoveredTv;
  readonly selected: boolean;
  readonly sendBlockedReason: string | null;
  readonly busy: boolean;
  readonly onSelect: () => void;
  readonly onSend: () => void;
}

/** Roku launches its own app, so it never needs a selected media. */
function blockedReason(tv: DiscoveredTv, mediaReason: string | null): string | null {
  if (tv.protocol === "roku-ecp") return null;
  if (tv.protocol === "dlna-dmr" && !tv.avTransportControlUrl) return "Renderizador sem AVTransport.";
  return mediaReason;
}

export function TvCard({ tv, selected, sendBlockedReason, busy, onSelect, onSend }: TvCardProps) {
  const reason = blockedReason(tv, sendBlockedReason);
  const reasonId = `tv-${tv.id}-blocked`;
  return (
    <li>
      <Card aria-label={tv.name} className={selected ? "border-primary" : undefined}>
        <CardHeader>
          <div>
            <CardTitle>{tv.name}</CardTitle>
            <CardDescription>
              {[tv.manufacturer, tv.modelName].filter(Boolean).join(" · ")} — {tv.ip}:{tv.port}
            </CardDescription>
          </div>
          <Badge tone="info">{PROTOCOL_LABEL[tv.protocol]}</Badge>
        </CardHeader>
        {tv.protocol === "roku-ecp" && tv.ecpMode === "limited" ? (
          <p className="mb-2 text-xs text-warning">ECP em modo limitado: ative o controle por apps na Roku.</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={selected ? "secondary" : "ghost"} size="sm" aria-pressed={selected} onClick={onSelect}>
            {selected ? "TV selecionada" : "Selecionar TV"}
          </Button>
          <Button
            size="sm"
            disabled={busy || reason !== null}
            aria-describedby={reason ? reasonId : undefined}
            onClick={onSend}
          >
            {SEND_LABEL[tv.protocol]}
          </Button>
          {reason ? (
            <span id={reasonId} className="text-xs text-muted">
              {reason}
            </span>
          ) : null}
        </div>
      </Card>
    </li>
  );
}
