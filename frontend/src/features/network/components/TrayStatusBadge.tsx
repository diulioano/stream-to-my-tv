import { detectEnvironment } from "../../../shared/api/baseUrl";
import { Badge } from "../../../shared/ui/badge";

export const TRAY_ACTIVE_LABEL = "Bandeja ativa: fechar a janela mantém a transmissão na TV";

/** Closing the desktop window hides it to the System Tray; the Node sidecar keeps streaming. */
export function TrayStatusBadge() {
  if (!detectEnvironment().isTauri) return null;
  return (
    <Badge tone="info" role="status">
      {TRAY_ACTIVE_LABEL}
    </Badge>
  );
}
