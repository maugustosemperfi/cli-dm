import { useEffect, useRef, useCallback } from "react";
import type { GameEvent } from "../protocol/events";
import { useGameState } from "../stores/gameState";

const WS_RECONNECT_DELAY = 2000;

interface UseWebSocketOptions {
  url: string;
  onRawOutput?: (agentId: string, data: Uint8Array) => void;
}

export function useWebSocket({ url, onRawOutput }: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const handleEvent = useGameState((s) => s.handleEvent);
  const setConnected = useGameState((s) => s.setConnected);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      console.log("[CLI_DM] WebSocket connected");
    };

    ws.onclose = () => {
      setConnected(false);
      console.log("[CLI_DM] WebSocket disconnected, reconnecting...");
      reconnectTimer.current = setTimeout(connect, WS_RECONNECT_DELAY);
    };

    ws.onerror = (err) => {
      console.error("[CLI_DM] WebSocket error:", err);
      ws.close();
    };

    ws.onmessage = (msg) => {
      try {
        const event: GameEvent = JSON.parse(msg.data);

        // Route raw output to terminal panes via callback
        if (
          (event.type === "raw.stdout" || event.type === "raw.stderr") &&
          onRawOutput
        ) {
          const bytes = Uint8Array.from(atob(event.data), (c) =>
            c.charCodeAt(0)
          );
          onRawOutput(event.agentId, bytes);
        }

        // All events go through the global state handler
        handleEvent(event);
      } catch (err) {
        console.warn("[CLI_DM] Failed to parse event:", err);
      }
    };
  }, [url, handleEvent, setConnected, onRawOutput]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return wsRef;
}
