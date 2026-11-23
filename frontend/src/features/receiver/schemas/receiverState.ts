import type { BadgeTone } from "../../../shared/ui/badge";
import type { ReceiverState } from "../../../shared/realtime/messages";

export const RECEIVER_STATE_LABEL: Record<ReceiverState, { readonly label: string; readonly tone: BadgeTone }> = {
  idle: { label: "Ocioso", tone: "neutral" },
  loading: { label: "Carregando", tone: "info" },
  playing: { label: "Reproduzindo", tone: "success" },
  paused: { label: "Pausado", tone: "warning" },
  stopped: { label: "Parado", tone: "neutral" },
  ended: { label: "Finalizado", tone: "neutral" },
  error: { label: "Erro", tone: "danger" }
};
