import { useLiveSocket } from "../../../shared/realtime/context";
import { useNetworkQuery } from "../../network/hooks/useNetwork";
import { receiverUrlFor } from "../api/receiver";

export function useReceiver() {
  const { connected, receiverStatus } = useLiveSocket();
  const network = useNetworkQuery();
  const receiverUrl = network.data ? receiverUrlFor(network.data.panelUrl) : null;
  return { connected, receiverStatus, receiverUrl, network };
}
