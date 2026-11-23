import { Badge } from "../../../shared/ui/badge";
import { useServerStatus } from "../hooks/useNetwork";

export function ServerStatusBadge() {
  const status = useServerStatus();
  if (status.isPending) return <Badge>Conectando ao servidor…</Badge>;
  if (status.isError) return <Badge tone="danger">Servidor offline</Badge>;
  const { catalogCount, activeMediaProcesses } = status.data;
  return (
    <Badge tone="success" title={status.data.baseUrl}>
      Servidor online · {catalogCount} vídeos · {activeMediaProcesses} FFmpeg
    </Badge>
  );
}
