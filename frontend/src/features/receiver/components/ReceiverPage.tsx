import { describeError } from "../../../shared/api/client";
import { formatTime } from "../../../shared/lib/format";
import { Alert } from "../../../shared/ui/alert";
import { Badge } from "../../../shared/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "../../../shared/ui/card";
import { useReceiver } from "../hooks/useReceiver";
import { RECEIVER_STATE_LABEL } from "../schemas/receiverState";

export function ReceiverPage() {
  const { connected, receiverStatus, receiverUrl, network } = useReceiver();
  const state = receiverStatus ? RECEIVER_STATE_LABEL[receiverStatus.state] : null;

  return (
    <Card aria-labelledby="receiver-title">
      <CardHeader>
        <div>
          <CardTitle id="receiver-title">Web Receiver da Smart TV</CardTitle>
          <CardDescription>Abra o endereço abaixo no navegador da TV. Ela segue os comandos deste painel.</CardDescription>
        </div>
        <Badge tone={connected ? "success" : "danger"}>{connected ? "Canal em tempo real ativo" : "Canal desconectado"}</Badge>
      </CardHeader>

      {network.isError ? <Alert tone="error">{describeError(network.error)}</Alert> : null}
      <p className="mb-3 text-sm text-muted">
        O <code>/receiver</code> é servido pelo sidecar Node como um Web Receiver em HTML/JS puro, sem dependências,
        para funcionar até nos navegadores antigos de Smart TV.
      </p>
      {receiverUrl ? (
        <p className="mb-4">
          <a
            href={receiverUrl}
            target="_blank"
            rel="noreferrer"
            className="break-all font-mono text-lg text-primary underline"
          >
            {receiverUrl}
          </a>
        </p>
      ) : null}

      <section aria-label="Status do receiver" className="rounded-md border border-border p-3">
        {receiverStatus && state ? (
          <div className="space-y-1 text-sm">
            <p>
              <Badge tone={state.tone}>{state.label}</Badge>{" "}
              <span className="font-medium">{receiverStatus.title ?? receiverStatus.mediaId ?? "Sem título"}</span>
            </p>
            <p className="tabular-nums text-muted">
              {formatTime(receiverStatus.positionSec)} / {formatTime(receiverStatus.durationSec)}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted">Nenhum receiver reportou status ainda.</p>
        )}
      </section>
    </Card>
  );
}
