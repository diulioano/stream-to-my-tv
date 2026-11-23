import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { API_BASE_URL, webSocketUrl } from "../api/baseUrl";
import { queryKeys } from "../api/queryKeys";
import { LiveSocketContext, type LiveSocket } from "./context";
import { parseServerMessage, type CommandMessage, type StatusMessage } from "./messages";

const RECONNECT_DELAY_MS = 2000;

export function LiveSocketProvider({ children, url }: { readonly children: ReactNode; readonly url?: string }) {
  const queryClient = useQueryClient();
  const socketRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [receiverStatus, setReceiverStatus] = useState<StatusMessage | null>(null);
  const targetUrl = url ?? webSocketUrl(API_BASE_URL, window.location);

  useEffect(() => {
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    function connect() {
      const socket = new WebSocket(targetUrl);
      socketRef.current = socket;
      socket.addEventListener("open", () => {
        setConnected(true);
        socket.send(JSON.stringify({ type: "register", role: "controller" }));
      });
      socket.addEventListener("message", (event: MessageEvent<unknown>) => {
        const message = parseServerMessage(event.data);
        if (!message) return;
        if (message.type === "status") setReceiverStatus(message);
        else void queryClient.invalidateQueries({ queryKey: queryKeys.session });
      });
      socket.addEventListener("close", () => {
        setConnected(false);
        if (!disposed) reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      });
    }

    connect();
    return () => {
      disposed = true;
      clearTimeout(reconnectTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [targetUrl, queryClient]);

  const send = useCallback((command: CommandMessage) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(command));
    return true;
  }, []);

  const value = useMemo<LiveSocket>(() => ({ connected, receiverStatus, send }), [connected, receiverStatus, send]);
  return <LiveSocketContext.Provider value={value}>{children}</LiveSocketContext.Provider>;
}
