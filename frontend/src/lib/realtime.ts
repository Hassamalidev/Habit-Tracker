import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { API_BASE, CLIENT_ID, getToken } from "./api";
import type { ChatMessage, MessagePage } from "./types";

type Status = "connecting" | "live" | "offline";

function socketUrl(token: string): string {
  const base = API_BASE || window.location.origin;
  const url = new URL("/api/ws", base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", token);
  url.searchParams.set("client_id", CLIENT_ID);
  return url.toString();
}

/**
 * Keeps this tab in step with the same account elsewhere.
 *
 * The server only sends changes that came from a *different* client, so an
 * incoming message always means genuinely new information. Rather than patch
 * the cache by hand for each event shape, it invalidates the affected queries
 * and lets React Query refetch - simpler, and it cannot drift out of sync.
 */
export function useRealtime(enabled: boolean) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>("offline");
  const [devices, setDevices] = useState(1);
  const retryRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setStatus("offline");
      return;
    }

    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let heartbeat: number | undefined;
    let disposed = false;

    const connect = () => {
      const token = getToken();
      if (!token || disposed) return;

      setStatus("connecting");
      socket = new WebSocket(socketUrl(token));

      socket.onopen = () => {
        retryRef.current = 0;
        setStatus("live");
        // Render's proxy drops idle sockets; a periodic ping keeps ours alive.
        heartbeat = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) socket.send("ping");
        }, 25000);
      };

      socket.onmessage = (event) => {
        let message: {
          type?: string;
          devices?: number;
          message?: ChatMessage;
          group_id?: string;
        };
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        if (message.type === "pong") return;
        if (message.type === "connected") {
          setDevices(message.devices ?? 1);
          return;
        }

        if (message.type === "group.message" && message.message) {
          const chat = message.message;
          // Append straight into the open room so the line appears at once;
          // refetching a whole page for one message would feel like lag.
          queryClient.setQueryData<MessagePage>(
            ["group-messages", chat.group_id],
            (current) =>
              !current || current.messages.some((m) => m.id === chat.id)
                ? current
                : { ...current, messages: [...current.messages, chat] },
          );
          // The group list carries unread badges and previews, so it refreshes.
          queryClient.invalidateQueries({ queryKey: ["groups"] });
          window.dispatchEvent(
            new CustomEvent("habit:group-message", { detail: chat }),
          );
          return;
        }

        if (message.type === "group.member") {
          queryClient.invalidateQueries({ queryKey: ["groups"] });
          if (message.group_id)
            queryClient.invalidateQueries({
              queryKey: ["group", message.group_id],
            });
          return;
        }
        if (message.type?.startsWith("entry") || message.type?.startsWith("entries")) {
          queryClient.invalidateQueries({ queryKey: ["grid"] });
          queryClient.invalidateQueries({ queryKey: ["analytics"] });
        }
        if (message.type?.startsWith("habit")) {
          queryClient.invalidateQueries({ queryKey: ["grid"] });
          queryClient.invalidateQueries({ queryKey: ["habits"] });
          queryClient.invalidateQueries({ queryKey: ["analytics"] });
        }
      };

      socket.onclose = () => {
        window.clearInterval(heartbeat);
        if (disposed) return;
        setStatus("offline");
        // Back off so a sleeping free-tier server is not hammered awake.
        const delay = Math.min(30000, 1000 * 2 ** retryRef.current);
        retryRef.current += 1;
        reconnectTimer = window.setTimeout(connect, delay);
      };

      socket.onerror = () => socket?.close();
    };

    connect();

    return () => {
      disposed = true;
      window.clearInterval(heartbeat);
      window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [enabled, queryClient]);

  return { status, devices };
}
