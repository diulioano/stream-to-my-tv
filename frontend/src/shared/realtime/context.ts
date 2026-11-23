import { createContext, useContext } from "react";
import type { CommandMessage, StatusMessage } from "./messages";

export interface LiveSocket {
  readonly connected: boolean;
  /** Last `status` frame broadcast by the Web Receiver. */
  readonly receiverStatus: StatusMessage | null;
  /** Sends a command to the receiver; returns false while disconnected. */
  readonly send: (command: CommandMessage) => boolean;
}

const DISCONNECTED: LiveSocket = { connected: false, receiverStatus: null, send: () => false };

export const LiveSocketContext = createContext<LiveSocket>(DISCONNECTED);

export function useLiveSocket(): LiveSocket {
  return useContext(LiveSocketContext);
}
