import { io } from "socket.io-client";

const API_BASE_URL = (import.meta.env.VITE_API_URL || import.meta.env.VITE_SOCKET_URL || "").replace(/\/+$/, "");

export function apiUrl(path) {
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export function createFriendsSocket() {
  return io(import.meta.env.VITE_SOCKET_URL || undefined, {
    autoConnect: false,
    transports: ["polling", "websocket"],
    reconnection: true,
    reconnectionAttempts: 8,
    reconnectionDelay: 700
  });
}

export function iceServers() {
  const servers = [{ urls: "stun:stun.l.google.com:19302" }];
  const turnUrl = import.meta.env.VITE_TURN_URL;
  if (turnUrl) {
    servers.push({
      urls: turnUrl.split(",").map((url) => url.trim()).filter(Boolean),
      username: import.meta.env.VITE_TURN_USERNAME || "",
      credential: import.meta.env.VITE_TURN_CREDENTIAL || ""
    });
  }
  return servers;
}
