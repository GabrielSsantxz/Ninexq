import { createServer } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { Server } from "socket.io";
import { startDiscordBot } from "./bot.js";

dotenv.config({ path: fileURLToPath(new URL("./.env", import.meta.url)) });

const PORT = Number(process.env.PORT) || 3001;
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const CLIENT_DIST_DIR = fileURLToPath(new URL("./dist/", import.meta.url));
if (process.env.NODE_ENV === "production") {
  if (!process.env.ADMIN_PASSWORD) {
    throw new Error("Set ADMIN_PASSWORD in the production environment before starting NineX.");
  }
  if (!process.env.CLIENT_ORIGIN) {
    throw new Error("Set CLIENT_ORIGIN to the public site origin before starting NineX in production.");
  }
}
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: CLIENT_ORIGINS, methods: ["GET", "POST"], credentials: true },
  maxHttpBufferSize: 1e6
});
const rooms = new Map();
const participantRoom = new Map();
const chatLimits = new Map();
const joinLimits = new Map();
const adminSessions = new Map();
const adminLoginAttempts = new Map();
const adminRoomTickets = new Map();
const joinLimitCleanup = setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [address, attempts] of joinLimits) {
    const recent = attempts.filter((timestamp) => timestamp >= cutoff);
    if (recent.length) joinLimits.set(address, recent);
    else joinLimits.delete(address);
  }
}, 60_000);
joinLimitCleanup.unref();

app.use(cors({ origin: CLIENT_ORIGINS, credentials: true }));
app.use(express.json({ limit: "16kb" }));
app.use("/api/admin", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
app.get("/api/rooms/by-link/:slug", (req, res) => {
  const slug = cleanText(req.params.slug, 11).toLowerCase();
  if (!/^(priv|pub)-[a-z0-9]{6}$/.test(slug)) {
    return res.status(400).json({ message: "Link de sala inválido." });
  }
  const room = [...rooms.values()].find((candidate) => candidate.slug === slug);
  if (!room) return res.status(404).json({ message: "Essa sala não existe mais ou o link está incorreto." });
  res.json({ code: room.code });
});

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, maxLength) : "";
}

function createCode() {
  let code;
  do {
    code = randomBytes(5).toString("hex").slice(0, 10).toUpperCase();
  } while (rooms.has(code));
  return code;
}

function createRoomSlug(isPrivate) {
  const prefix = isPrivate ? "priv" : "pub";
  let slug;
  do {
    slug = `${prefix}-${BigInt(`0x${randomBytes(8).toString("hex")}`).toString(36).padStart(13, "0").slice(-6)}`;
  } while ([...rooms.values()].some((room) => room.slug === slug));
  return slug;
}

function publicRoom(room) {
  return {
    code: room.code,
    slug: room.slug,
    name: room.name,
    description: room.description,
    isPrivate: room.isPrivate,
    locked: room.locked,
    createdAt: room.createdAt,
    leaderId: room.leaderId,
    participants: [...room.participants.values()]
  };
}

function broadcastRoom(room) {
  io.to(room.code).emit("room-updated", publicRoom(room));
}

function endRoom(room, message) {
  io.to(room.code).emit("room-ended", { message });
  for (const id of room.participants.keys()) {
    const participantSocket = io.sockets.sockets.get(id);
    if (participantSocket) participantSocket.leave(room.code);
    participantRoom.delete(id);
    chatLimits.delete(id);
  }
  rooms.delete(room.code);
}

function ensureDiscordRoom(channel) {
  const existingRoom = findDiscordRoom(channel.id);
  if (existingRoom) return { room: existingRoom, created: false };

  const name = cleanText(channel.name, 40) || "Canal de voz";
  const code = createCode();
  const room = {
    code,
    slug: createRoomSlug(true),
    name: `Discord · ${name}`,
    description: `Sala vinculada ao canal de voz ${name} do Discord.`,
    isPrivate: true,
    locked: false,
    createdAt: Date.now(),
    leaderId: null,
    discordChannelId: channel.id,
    participants: new Map()
  };
  rooms.set(room.code, room);
  return { room, created: true };
}

function findDiscordRoom(channelId) {
  return [...rooms.values()].find((room) => room.discordChannelId === channelId) || null;
}

function requestAddress(req) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function adminCookie(req) {
  const cookieHeader = req.headers.cookie || "";
  const cookie = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith("friends_admin="));
  return cookie ? cookie.slice("friends_admin=".length) : "";
}

function sessionCookie(value, maxAge) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `friends_admin=${encodeURIComponent(value)}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function requireAdmin(req, res, next) {
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(503).json({ message: "Painel admin desativado: configure ADMIN_PASSWORD no servidor." });
  }
  const token = adminCookie(req);
  const expiresAt = adminSessions.get(token);
  if (!token || !expiresAt || expiresAt <= Date.now()) {
    if (token) adminSessions.delete(token);
    return res.status(401).json({ message: "Sessão administrativa expirada. Entre novamente." });
  }
  next();
}

function requireSameOrigin(req, res, next) {
  const origin = req.get("origin");
  let isLocalDevelopmentOrigin = false;
  if (origin && process.env.NODE_ENV !== "production") {
    try {
      const { protocol, hostname } = new URL(origin);
      isLocalDevelopmentOrigin = ["http:", "https:"].includes(protocol)
        && ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
    } catch {
      isLocalDevelopmentOrigin = false;
    }
  }
  if (origin && !CLIENT_ORIGINS.includes(origin) && !isLocalDevelopmentOrigin) {
    return res.status(403).json({ message: "Origem não autorizada." });
  }
  next();
}

app.get("/api/admin/session", (req, res) => {
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(503).json({ message: "Painel admin desativado: configure ADMIN_PASSWORD no servidor." });
  }
  const token = adminCookie(req);
  const expiresAt = adminSessions.get(token);
  if (!token || !expiresAt || expiresAt <= Date.now()) {
    if (token) adminSessions.delete(token);
    return res.status(200).json({ authenticated: false });
  }
  res.json({ authenticated: true, expiresAt });
});

app.post("/api/admin/login", requireSameOrigin, (req, res) => {
  const configuredPassword = process.env.ADMIN_PASSWORD;
  if (!configuredPassword) {
    return res.status(503).json({ message: "Painel admin desativado: configure ADMIN_PASSWORD no servidor." });
  }
  const address = requestAddress(req);
  const now = Date.now();
  const attempts = (adminLoginAttempts.get(address) || []).filter((timestamp) => now - timestamp < 15 * 60_000);
  if (attempts.length >= 5) {
    adminLoginAttempts.set(address, attempts);
    return res.status(429).json({ message: "Muitas tentativas de acesso. Aguarde 15 minutos." });
  }

  const suppliedPassword = typeof req.body?.password === "string" ? req.body.password : "";
  const expectedHash = createHash("sha256").update(configuredPassword).digest();
  const suppliedHash = createHash("sha256").update(suppliedPassword).digest();
  if (!timingSafeEqual(expectedHash, suppliedHash)) {
    attempts.push(now);
    adminLoginAttempts.set(address, attempts);
    return res.status(401).json({ message: "Senha incorreta." });
  }

  adminLoginAttempts.delete(address);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = now + 8 * 60 * 60_000;
  adminSessions.set(token, expiresAt);
  res.setHeader("Set-Cookie", sessionCookie(token, 8 * 60 * 60));
  res.json({ authenticated: true, expiresAt });
});

app.post("/api/admin/logout", requireSameOrigin, requireAdmin, (req, res) => {
  adminSessions.delete(adminCookie(req));
  res.setHeader("Set-Cookie", sessionCookie("", 0));
  res.json({ authenticated: false });
});

app.get("/api/admin/overview", requireAdmin, (_req, res) => {
  const activeRooms = [...rooms.values()];
  const participants = activeRooms.flatMap((room) => [...room.participants.values()]);
  res.json({
    rooms: activeRooms.length,
    participants: participants.length,
    sharing: participants.filter((participant) => participant.sharing).length,
    lockedRooms: activeRooms.filter((room) => room.locked).length
  });
});

app.get("/api/admin/rooms", requireAdmin, (_req, res) => {
  const activeRooms = [...rooms.values()]
    .map((room) => ({
      code: room.code,
      slug: room.slug,
      name: room.name,
      description: room.description,
      isPrivate: room.isPrivate,
      locked: room.locked,
      createdAt: room.createdAt,
      leader: room.participants.get(room.leaderId)?.name || "Desconhecido",
      participants: [...room.participants.values()].map(({ id, name, microphone, camera, sharing }) => ({
        id,
        name,
        microphone,
        camera,
        sharing
      }))
    }))
    .sort((left, right) => right.createdAt - left.createdAt);
  res.json({ rooms: activeRooms });
});

app.post("/api/admin/rooms/:code/access-ticket", requireSameOrigin, requireAdmin, (req, res) => {
  const code = cleanText(req.params.code, 10).toUpperCase();
  if (!rooms.has(code)) return res.status(404).json({ message: "Sala não encontrada." });
  const ticket = randomBytes(32).toString("base64url");
  adminRoomTickets.set(createHash("sha256").update(ticket).digest("hex"), {
    code,
    expiresAt: Date.now() + 60_000
  });
  res.json({ ticket, expiresAt: Date.now() + 60_000 });
});

app.patch("/api/admin/rooms/:code", requireSameOrigin, requireAdmin, (req, res) => {
  const code = cleanText(req.params.code, 10).toUpperCase();
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ message: "Sala não encontrada." });
  if (typeof req.body?.locked !== "boolean") {
    return res.status(400).json({ message: "Informe se a sala deve ficar bloqueada." });
  }
  room.locked = req.body.locked;
  broadcastRoom(room);
  res.json({ room: publicRoom(room) });
});

app.delete("/api/admin/rooms/:code", requireSameOrigin, requireAdmin, (req, res) => {
  const code = cleanText(req.params.code, 10).toUpperCase();
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ message: "Sala não encontrada." });
  endRoom(room, "A administração encerrou esta sala.");
  res.json({ ended: true, code });
});

const adminSessionCleanup = setInterval(() => {
  const now = Date.now();
  for (const [token, expiresAt] of adminSessions) {
    if (expiresAt <= now) adminSessions.delete(token);
  }
  for (const [address, attempts] of adminLoginAttempts) {
    const recent = attempts.filter((timestamp) => now - timestamp < 15 * 60_000);
    if (recent.length) adminLoginAttempts.set(address, recent);
    else adminLoginAttempts.delete(address);
  }
  for (const [ticketHash, ticket] of adminRoomTickets) {
    if (ticket.expiresAt <= now) adminRoomTickets.delete(ticketHash);
  }
}, 60_000);
adminSessionCleanup.unref();

function error(socket, message) {
  socket.emit("action-error", { message });
}

function getRoomFor(socket, roomCode) {
  const code = typeof roomCode === "string" ? roomCode.toUpperCase() : participantRoom.get(socket.id);
  const room = rooms.get(code);
  if (!room || !room.participants.has(socket.id)) return null;
  return room;
}

function leaveRoom(socket, reason = "left") {
  const code = participantRoom.get(socket.id);
  const room = rooms.get(code);
  if (!room) {
    participantRoom.delete(socket.id);
    return;
  }
  room.participants.delete(socket.id);
  participantRoom.delete(socket.id);
  socket.leave(code);
  socket.to(code).emit("participant-left", { id: socket.id, reason });

  if (room.participants.size === 0) {
    if (room.discordChannelId) room.leaderId = null;
    else rooms.delete(code);
    return;
  }
  if (room.leaderId === socket.id) {
    const nextLeader = [...room.participants.values()].find((participant) => !participant.admin);
    room.leaderId = nextLeader?.id || null;
    io.to(code).emit("leadership-changed", { leaderId: room.leaderId });
  }
  broadcastRoom(room);
}

io.on("connection", (socket) => {
  socket.on("create-room", (payload = {}) => {
    if (participantRoom.has(socket.id)) return error(socket, "Saia da sala atual antes de criar outra.");
    const userName = cleanText(payload.userName, 32);
    const name = cleanText(payload.name, 48);
    const description = cleanText(payload.description, 160);
    if (!userName || !name) return error(socket, "Informe seu nome e o nome da sala.");

    const code = createCode();
    const room = {
      code,
      slug: createRoomSlug(payload.isPrivate === true),
      name,
      description,
      isPrivate: payload.isPrivate === true,
      locked: false,
      createdAt: Date.now(),
      leaderId: socket.id,
      participants: new Map()
    };
    const participant = { id: socket.id, name: userName, microphone: false, camera: false, sharing: false };
    room.participants.set(socket.id, participant);
    rooms.set(code, room);
    participantRoom.set(socket.id, code);
    socket.join(code);
    socket.emit("room-joined", { room: publicRoom(room), selfId: socket.id });
  });

  socket.on("join-room", (payload = {}) => {
    if (participantRoom.has(socket.id)) return error(socket, "Você já está em uma sala.");
    const code = cleanText(payload.code, 10).toUpperCase();
    const userName = cleanText(payload.userName, 32);
    const room = rooms.get(code);
    if (!userName || !code) return error(socket, "Informe seu nome e o código da sala.");
    if (!room) {
      const address = socket.handshake.address || socket.id;
      const now = Date.now();
      const attempts = (joinLimits.get(address) || []).filter((timestamp) => now - timestamp < 60_000);
      if (attempts.length >= 8) return error(socket, "Muitas tentativas de entrada. Aguarde um minuto e tente novamente.");
      attempts.push(now);
      joinLimits.set(address, attempts);
      return error(socket, "Não encontramos uma sala com esse código.");
    }
    if (room.locked) return error(socket, "Esta sala está bloqueada para novas entradas.");
    if (room.participants.size >= 24) return error(socket, "Esta sala atingiu o limite de participantes.");

    const participant = { id: socket.id, name: userName, microphone: false, camera: false, sharing: false };
    room.participants.set(socket.id, participant);
    if (!room.leaderId) {
      room.leaderId = socket.id;
      io.to(code).emit("leadership-changed", { leaderId: socket.id });
    }
    participantRoom.set(socket.id, code);
    socket.join(code);
    socket.emit("room-joined", { room: publicRoom(room), selfId: socket.id });
    broadcastRoom(room);
    socket.to(code).emit("participant-joined", { id: socket.id });
  });

  socket.on("admin-join-room", (payload = {}) => {
    if (participantRoom.has(socket.id)) return error(socket, "Saia da sala atual antes de entrar em outra.");
    const code = cleanText(payload.code, 10).toUpperCase();
    const ticket = typeof payload.ticket === "string" ? payload.ticket : "";
    const name = cleanText(payload.name, 32);
    if (!/^[A-F0-9]{10}$/.test(code) || !ticket || ticket.length > 128) {
      return error(socket, "Convite administrativo inválido ou expirado.");
    }
    if (!name) return error(socket, "Informe o nome que será exibido na sala.");

    const ticketHash = createHash("sha256").update(ticket).digest("hex");
    const ticketEntry = adminRoomTickets.get(ticketHash);
    adminRoomTickets.delete(ticketHash);
    const room = rooms.get(code);
    if (!ticketEntry || ticketEntry.expiresAt <= Date.now() || ticketEntry.code !== code) {
      return error(socket, "Convite administrativo inválido ou expirado.");
    }
    if (!room) return error(socket, "A sala não está mais disponível.");

    room.participants.set(socket.id, {
      id: socket.id,
      name,
      microphone: false,
      camera: false,
      sharing: false,
      admin: true
    });
    participantRoom.set(socket.id, code);
    socket.join(code);
    socket.emit("room-joined", { room: publicRoom(room), selfId: socket.id });
    broadcastRoom(room);
    socket.to(code).emit("participant-joined", { id: socket.id });
  });

  socket.on("leave-room", () => leaveRoom(socket));

  socket.on("send-message", (payload = {}, acknowledge) => {
    const room = getRoomFor(socket);
    const text = cleanText(payload.text, 1000);
    if (!room || !text) {
      acknowledge?.({ ok: false, message: "Você não está conectado a uma sala." });
      return;
    }
    const now = Date.now();
    const previous = chatLimits.get(socket.id) || [];
    const recent = previous.filter((timestamp) => now - timestamp < 10_000);
    if (recent.length >= 8) {
      acknowledge?.({ ok: false, message: "Aguarde um instante antes de enviar outra mensagem." });
      return;
    }
    recent.push(now);
    chatLimits.set(socket.id, recent);
    io.to(room.code).emit("new-message", {
      id: randomBytes(8).toString("hex"),
      senderId: socket.id,
      sender: room.participants.get(socket.id).name,
      text,
      timestamp: now
    });
    acknowledge?.({ ok: true });
  });

  socket.on("media-state", (payload = {}) => {
    const room = getRoomFor(socket);
    if (!room) return;
    const participant = room.participants.get(socket.id);
    participant.microphone = payload.microphone === true;
    participant.camera = payload.camera === true;
    participant.sharing = payload.sharing === true;
    broadcastRoom(room);
  });

  socket.on("signal", (payload = {}) => {
    const room = getRoomFor(socket);
    const targetId = typeof payload.targetId === "string" ? payload.targetId : "";
    if (!room || !room.participants.has(targetId) || !["offer", "answer", "ice-candidate"].includes(payload.type)) return;
    const dataSize = JSON.stringify(payload.data ?? null).length;
    if (dataSize > 500_000) return error(socket, "Sinalização excedeu o tamanho permitido.");
    io.to(targetId).emit("signal", { fromId: socket.id, type: payload.type, data: payload.data });
  });

  socket.on("kick-participant", (payload = {}) => {
    const room = getRoomFor(socket);
    const targetId = typeof payload.targetId === "string" ? payload.targetId : "";
    const actor = room?.participants.get(socket.id);
    if (!room || (room.leaderId !== socket.id && !actor?.admin)) {
      return error(socket, "Apenas a liderança ou a administração pode remover participantes.");
    }
    if (targetId === socket.id || !room.participants.has(targetId)) return;
    if (room.participants.get(targetId).admin) return error(socket, "Não é possível remover uma sessão administrativa.");
    io.to(targetId).emit("removed-from-room", { message: "Você foi removido da sala pela liderança ou administração." });
    const target = io.sockets.sockets.get(targetId);
    if (target) leaveRoom(target, "removed");
  });

  socket.on("mute-participant", (payload = {}) => {
    const room = getRoomFor(socket);
    const targetId = typeof payload.targetId === "string" ? payload.targetId : "";
    const actor = room?.participants.get(socket.id);
    if (!room || (room.leaderId !== socket.id && !actor?.admin)) {
      return error(socket, "Apenas a liderança ou a administração pode solicitar o silêncio.");
    }
    if (targetId === socket.id || !room.participants.has(targetId)) return;
    if (room.participants.get(targetId).admin) return error(socket, "Não é possível moderar outra sessão administrativa.");
    io.to(targetId).emit("mute-requested");
  });

  socket.on("end-participant-stream", (payload = {}) => {
    const room = getRoomFor(socket);
    const targetId = typeof payload.targetId === "string" ? payload.targetId : "";
    const actor = room?.participants.get(socket.id);
    if (!room || (room.leaderId !== socket.id && !actor?.admin)) {
      return error(socket, "Apenas a liderança ou a administração pode encerrar transmissões.");
    }
    if (!room.participants.has(targetId)) return;
    if (room.participants.get(targetId).admin) return error(socket, "Não é possível moderar outra sessão administrativa.");
    io.to(targetId).emit("end-stream-requested");
  });

  socket.on("update-room", (payload = {}) => {
    const room = getRoomFor(socket);
    const actor = room?.participants.get(socket.id);
    if (!room || (room.leaderId !== socket.id && !actor?.admin)) {
      return error(socket, "Apenas a liderança ou a administração pode alterar as configurações.");
    }
    if (typeof payload.locked === "boolean") room.locked = payload.locked;
    if (typeof payload.name === "string") {
      const name = cleanText(payload.name, 48);
      if (name) room.name = name;
    }
    if (typeof payload.description === "string") room.description = cleanText(payload.description, 160);
    broadcastRoom(room);
  });

  socket.on("transfer-leadership", (payload = {}) => {
    const room = getRoomFor(socket);
    const targetId = typeof payload.targetId === "string" ? payload.targetId : "";
    const actor = room?.participants.get(socket.id);
    if (!room || (room.leaderId !== socket.id && !actor?.admin)) {
      return error(socket, "Apenas a liderança ou a administração pode transferir o controle.");
    }
    if (!room.participants.has(targetId)) return error(socket, "Participante não encontrado.");
    if (room.participants.get(targetId).admin) return error(socket, "A administração não pode ser líder da sala.");
    room.leaderId = targetId;
    io.to(room.code).emit("leadership-changed", { leaderId: targetId });
    broadcastRoom(room);
  });

  socket.on("end-room", () => {
    const room = getRoomFor(socket);
    const actor = room?.participants.get(socket.id);
    if (!room || (room.leaderId !== socket.id && !actor?.admin)) {
      return error(socket, "Apenas a liderança ou a administração pode encerrar a sala.");
    }
    endRoom(room, actor.admin ? "A administração encerrou esta sala." : "A liderança encerrou esta sala.");
  });

  socket.on("disconnect", () => {
    leaveRoom(socket);
    chatLimits.delete(socket.id);
    const address = socket.handshake.address || socket.id;
    const attempts = joinLimits.get(address);
    if (attempts && attempts.every((timestamp) => Date.now() - timestamp >= 60_000)) joinLimits.delete(address);
  });
});

if (process.env.NODE_ENV === "production" && !existsSync(new URL("./dist/index.html", import.meta.url))) {
  throw new Error("Production client build is missing. Run `npm run build` before starting NineX.");
}

app.use(express.static(CLIENT_DIST_DIR, {
  index: false,
  maxAge: process.env.NODE_ENV === "production" ? "1y" : 0,
  setHeaders(response, path) {
    if (path.endsWith("index.html")) response.setHeader("Cache-Control", "no-cache");
  }
}));

app.get("*", (req, res, next) => {
  if (req.path === "/api" || req.path.startsWith("/api/") || req.path.startsWith("/socket.io/")) {
    return next();
  }
  res.sendFile(fileURLToPath(new URL("./dist/index.html", import.meta.url)), (sendError) => {
    if (sendError) next(sendError);
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`NineX server listening on port ${PORT}`);
});

startDiscordBot({
  token: process.env.DISCORD_BOT_TOKEN,
  guildId: process.env.DISCORD_GUILD_ID,
  logChannelId: process.env.DISCORD_LOG_CHANNEL_ID,
  friendsUrl: process.env.FRIENDS_PUBLIC_URL || CLIENT_ORIGINS[0],
  ensureRoom: ensureDiscordRoom,
  findRoom: findDiscordRoom,
  endRoom
});
