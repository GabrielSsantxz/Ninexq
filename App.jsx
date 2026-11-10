import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check, ChevronDown, ChevronUp, Copy, Crown, DoorOpen, Expand, Link, LockKeyhole,
  LogIn, Maximize, MessageSquare, Mic, MicOff, Minimize, Monitor, Radio, Settings, Shield,
  ShieldCheck,
  Signal, SlidersHorizontal, Sparkles,
  Users, Video, VideoOff, Volume2, VolumeX, X
} from "lucide-react";
import Modal from "./Modal.jsx";
import { createFriendsSocket, iceServers } from "./socket.js";

function initials(name = "") {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
}

function VideoSurface({ stream, muted = false, onDoubleClick }) {
  const videoRef = useRef(null);
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream || null;
  }, [stream]);
  return <video ref={videoRef} autoPlay playsInline muted={muted} onDoubleClick={onDoubleClick} />;
}

function RemoteAudio({ stream, muted, onPlaybackError }) {
  const audioRef = useRef(null);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.srcObject = stream || null;
    if (stream && !muted) {
      audio.play().catch(onPlaybackError);
    }
  }, [muted, onPlaybackError, stream]);
  return <audio ref={audioRef} autoPlay playsInline muted={muted} />;
}

export default function App({ adminMode = false, adminCode = "", adminName = "", initialAdminTicket = "" }) {
  const socket = useMemo(() => createFriendsSocket(), []);
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState(null);
  const [selfId, setSelfId] = useState("");
  const [messages, setMessages] = useState([]);
  const [modal, setModal] = useState("");
  const [toast, setToast] = useState("");
  const [formError, setFormError] = useState("");
  const [formBusy, setFormBusy] = useState(false);
  const [adminJoinError, setAdminJoinError] = useState("");
  const [remoteStreams, setRemoteStreams] = useState({});
  const [localStream, setLocalStream] = useState(null);
  const [microphoneOn, setMicrophoneOn] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [sharingOn, setSharingOn] = useState(false);
  const [audioOn, setAudioOn] = useState(true);
  const [roomSoundsOn, setRoomSoundsOn] = useState(() => localStorage.getItem("friendsRoomSounds") !== "false");
  const [chatText, setChatText] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [collapsedLeft, setCollapsedLeft] = useState(false);
  const [collapsedRight, setCollapsedRight] = useState(() => window.matchMedia("(max-width: 760px)").matches);
  const [selectedStream, setSelectedStream] = useState("");
  const [showStreamStrip, setShowStreamStrip] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [selectedParticipant, setSelectedParticipant] = useState(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [roomDraft, setRoomDraft] = useState({ name: "", description: "", locked: false });
  const [joinCode, setJoinCode] = useState(new URLSearchParams(window.location.search).get("room") || "");
  const videoTrackRef = useRef(null);
  const audioTrackRef = useRef(null);
  const screenAudioTrackRef = useRef(null);
  const micStreamRef = useRef(null);
  const selfIdRef = useRef("");
  const roomRef = useRef(null);
  const selfNameRef = useRef("");
  const reconnectRoomRef = useRef(null);
  const mediaStateRef = useRef({ camera: false, sharing: false });
  const stopVideoSourceRef = useRef(() => {});
  const peerConnections = useRef(new Map());
  const pendingCandidates = useRef(new Map());
  const remoteMediaStreams = useRef(new Map());
  const previousStreamCount = useRef(0);
  const chatEndRef = useRef(null);
  const toastTimer = useRef(null);
  const audioContextRef = useRef(null);
  const roomSoundsOnRef = useRef(roomSoundsOn);
  const adminTicketRef = useRef(initialAdminTicket);
  const adminNameRef = useRef(adminName);
  const isLeader = room?.leaderId === selfId;
  const participants = room?.participants || [];
  const selfParticipant = participants.find((person) => person.id === selfId);
  const isAdmin = selfParticipant?.admin === true;
  const canManageRoom = isLeader || isAdmin;
  const streams = participants.filter((person) => {
    const hasMedia = person.id === selfId
      ? Boolean(videoTrackRef.current && localStream)
      : Boolean(remoteStreams[person.id]);
    return hasMedia && (person.sharing || person.camera);
  });
  const activeStream = streams.find((person) => person.id === selectedStream) || streams[0];
  const activeMediaStream = activeStream?.id === selfId ? localStream : remoteStreams[activeStream?.id];
  selfIdRef.current = selfId;
  roomRef.current = room;
  selfNameRef.current = participants.find((person) => person.id === selfId)?.name || "";
  mediaStateRef.current = { camera: cameraOn, sharing: sharingOn };
  roomSoundsOnRef.current = roomSoundsOn;

  const playPlip = useCallback(() => {
    if (!roomSoundsOnRef.current) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      const context = audioContextRef.current || new AudioContextClass();
      audioContextRef.current = context;
      if (context.state === "suspended") context.resume().catch((error) => {
        console.error(`Não foi possível habilitar o som da sala: ${error.message}`);
      });
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(740, now);
      oscillator.frequency.exponentialRampToValueAtTime(1180, now + 0.075);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.12, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.15);
    } catch (error) {
      console.error(`Não foi possível reproduzir o som da sala: ${error.message}`);
    }
  }, []);

  useEffect(() => {
    const unlockAudio = () => {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass || audioContextRef.current) return;
      try {
        audioContextRef.current = new AudioContextClass();
        if (audioContextRef.current.state === "suspended") {
          audioContextRef.current.resume().catch((error) => {
            console.error(`Não foi possível habilitar o som da sala: ${error.message}`);
          });
        }
      } catch (error) {
        console.error(`Não foi possível inicializar o som da sala: ${error.message}`);
      }
    };
    document.addEventListener("pointerdown", unlockAudio, { once: true });
    document.addEventListener("keydown", unlockAudio, { once: true });
    return () => {
      document.removeEventListener("pointerdown", unlockAudio);
      document.removeEventListener("keydown", unlockAudio);
    };
  }, []);

  const notify = useCallback((message) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 3200);
  }, []);
  const reportAudioPlaybackError = useCallback(() => {
    notify("O navegador bloqueou o áudio da sala. Interaja com a página e ative o áudio novamente.");
  }, [notify]);

  const emitMediaState = useCallback((overrides = {}) => {
    socket.emit("media-state", {
      microphone: Boolean(audioTrackRef.current?.enabled),
      camera: Boolean(videoTrackRef.current && mediaStateRef.current.camera),
      sharing: Boolean(videoTrackRef.current && mediaStateRef.current.sharing),
      ...overrides
    });
  }, [socket]);

  const createPeer = useCallback((peerId) => {
    const existing = peerConnections.current.get(peerId);
    if (existing) return existing;
    const connection = new RTCPeerConnection({ iceServers: iceServers() });
    const isInitiator = selfIdRef.current.localeCompare(peerId) < 0;
    connection.onicecandidate = (event) => {
      if (event.candidate) socket.emit("signal", { targetId: peerId, type: "ice-candidate", data: event.candidate });
    };
    connection.onnegotiationneeded = async () => {
      if (!isInitiator || connection.signalingState !== "stable") return;
      try {
        connection.makingOffer = true;
        await connection.setLocalDescription();
        socket.emit("signal", { targetId: peerId, type: "offer", data: connection.localDescription });
      } catch (error) {
        notify(`Não foi possível iniciar a conexão: ${error.message}`);
      } finally {
        connection.makingOffer = false;
      }
    };
    connection.ontrack = (event) => {
      let incoming = remoteMediaStreams.current.get(peerId);
      if (!incoming) {
        incoming = new MediaStream();
        remoteMediaStreams.current.set(peerId, incoming);
      }
      if (!incoming.getTracks().some((track) => track.id === event.track.id)) incoming.addTrack(event.track);
      setRemoteStreams((current) => ({ ...current, [peerId]: incoming }));
    };
    connection.onconnectionstatechange = () => {
      if (["failed", "closed"].includes(connection.connectionState)) {
        remoteMediaStreams.current.delete(peerId);
        setRemoteStreams((current) => {
          const next = { ...current };
          delete next[peerId];
          return next;
        });
      }
    };
    peerConnections.current.set(peerId, connection);

    connection.localSenders = new Map();
    if (isInitiator) {
      connection.localSenders.set("video", connection.addTransceiver("video", { direction: "sendrecv" }).sender);
      connection.localSenders.set("microphone", connection.addTransceiver("audio", { direction: "sendrecv" }).sender);
      connection.localSenders.set("screen-audio", connection.addTransceiver("audio", { direction: "sendrecv" }).sender);
      for (const [role, track] of [["video", videoTrackRef.current], ["microphone", audioTrackRef.current], ["screen-audio", screenAudioTrackRef.current]]) {
        const sender = connection.localSenders.get(role);
        if (track) sender.replaceTrack(track).catch((error) => notify(`Falha ao iniciar transmissão: ${error.message}`));
      }
    }
    return connection;
  }, [notify, socket]);

  const syncTracks = useCallback((track, enabled) => {
    const role = track.kind === "video" ? "video" : track === audioTrackRef.current ? "microphone" : "screen-audio";
    for (const [peerId, connection] of peerConnections.current.entries()) {
      const sender = connection.localSenders.get(role);
      if (sender) {
        sender.replaceTrack(enabled ? track : null).catch((error) => notify(`Falha ao atualizar transmissão: ${error.message}`));
      }
    }
  }, [notify]);

  useEffect(() => {
    socket.connect();
    const joinAsAdmin = async (code, reconnecting) => {
      try {
        let ticket = reconnecting ? "" : adminTicketRef.current;
        adminTicketRef.current = "";
        if (!ticket) {
          const response = await fetch(`/api/admin/rooms/${encodeURIComponent(code)}/access-ticket`, {
            method: "POST",
            credentials: "same-origin"
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.message || "Não foi possível gerar acesso administrativo.");
          ticket = payload.ticket;
        }
        socket.emit("admin-join-room", { code, ticket, name: adminNameRef.current });
      } catch (error) {
        setAdminJoinError(error.message);
      }
    };
    const onConnect = () => {
      setConnected(true);
      if (reconnectRoomRef.current) {
        const previousRoom = reconnectRoomRef.current;
        if (adminMode) joinAsAdmin(previousRoom.code, true);
        else socket.emit("join-room", previousRoom);
        reconnectRoomRef.current = null;
      } else if (adminMode && adminCode) {
        joinAsAdmin(adminCode, false);
      }
    };
    const onDisconnect = () => {
      setConnected(false);
      if (roomRef.current) reconnectRoomRef.current = { code: roomRef.current.code, userName: selfNameRef.current };
      for (const connection of peerConnections.current.values()) connection.close();
      peerConnections.current.clear();
      remoteMediaStreams.current.clear();
      setRemoteStreams({});
    };
    const onJoined = ({ room: joinedRoom, selfId: id }) => {
      setRoom(joinedRoom);
      setSelfId(id);
      reconnectRoomRef.current = null;
      setMessages([]);
      setModal("");
      setFormBusy(false);
      setRoomDraft({ name: joinedRoom.name, description: joinedRoom.description, locked: joinedRoom.locked });
      setRemoteStreams({});
      setAdminJoinError("");
      if (adminMode) sessionStorage.removeItem("friendsAdminRoomTicket");
      notify(`Conectado à sala ${joinedRoom.code}`);
      window.history.replaceState({}, "", adminMode
        ? `/admin/room?room=${encodeURIComponent(joinedRoom.code)}`
        : `/watch/${joinedRoom.slug}`);
    };
    const onRoom = (nextRoom) => {
      const previousParticipants = new Map((roomRef.current?.participants || []).map((person) => [person.id, person]));
      for (const person of nextRoom.participants || []) {
        const previous = previousParticipants.get(person.id);
        if (!previous) continue;
        if (previous.sharing !== person.sharing || previous.camera !== person.camera) {
          playPlip();
          break;
        }
      }
      setRoom(nextRoom);
    };
    const onMessage = (message) => setMessages((current) => [...current, message]);
    const onError = ({ message }) => {
      setFormError(message);
      setFormBusy(false);
      if (adminMode && !roomRef.current) {
        sessionStorage.removeItem("friendsAdminRoomTicket");
        setAdminJoinError(message);
      }
      notify(message);
    };
    const onSignal = async ({ fromId, type, data }) => {
      const connection = createPeer(fromId);
      try {
        if (type === "offer") {
          const readyForOffer = !connection.makingOffer &&
            (connection.signalingState === "stable" || connection.isSettingRemoteAnswerPending);
          const offerCollision = !readyForOffer;
          const polite = selfIdRef.current.localeCompare(fromId) > 0;
          connection.ignoreOffer = !polite && offerCollision;
          if (connection.ignoreOffer) return;
          await connection.setRemoteDescription(data);
          const queued = pendingCandidates.current.get(fromId) || [];
          for (const candidate of queued) await connection.addIceCandidate(candidate);
          pendingCandidates.current.delete(fromId);
          if (!connection.localSenders.size) {
            const transceivers = connection.getTransceivers();
            const audioTransceivers = transceivers.filter((transceiver) => transceiver.receiver.track.kind === "audio");
            connection.localSenders.set("video", transceivers.find((transceiver) => transceiver.receiver.track.kind === "video")?.sender);
            connection.localSenders.set("microphone", audioTransceivers[0]?.sender);
            connection.localSenders.set("screen-audio", audioTransceivers[1]?.sender);
          }
          for (const [role, track] of [["video", videoTrackRef.current], ["microphone", audioTrackRef.current], ["screen-audio", screenAudioTrackRef.current]]) {
            const sender = connection.localSenders.get(role);
            if (track && sender) await sender.replaceTrack(track);
          }
          const answer = await connection.createAnswer();
          await connection.setLocalDescription(answer);
          socket.emit("signal", { targetId: fromId, type: "answer", data: connection.localDescription });
        } else if (type === "answer") {
          connection.isSettingRemoteAnswerPending = true;
          await connection.setRemoteDescription(data);
          connection.isSettingRemoteAnswerPending = false;
          const queued = pendingCandidates.current.get(fromId) || [];
          for (const candidate of queued) await connection.addIceCandidate(candidate);
          pendingCandidates.current.delete(fromId);
        } else if (type === "ice-candidate") {
          if (connection.ignoreOffer) return;
          if (connection.remoteDescription) await connection.addIceCandidate(data);
          else pendingCandidates.current.set(fromId, [...(pendingCandidates.current.get(fromId) || []), data]);
        }
      } catch (error) {
        notify(`Falha na conexão com participante: ${error.message}`);
      }
    };
    const onParticipantLeft = ({ id }) => {
      playPlip();
      const connection = peerConnections.current.get(id);
      if (connection) connection.close();
      peerConnections.current.delete(id);
      remoteMediaStreams.current.delete(id);
      pendingCandidates.current.delete(id);
      setRemoteStreams((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    };
    const onParticipantJoined = () => playPlip();
    const onRemoved = ({ message }) => {
      cleanupMedia();
      clearRoom();
      notify(message);
    };
    const onEnded = ({ message }) => {
      cleanupMedia();
      clearRoom();
      notify(message);
    };
    const onMute = () => {
      if (audioTrackRef.current) {
        audioTrackRef.current.enabled = false;
        setMicrophoneOn(false);
        emitMediaState({ microphone: false });
      }
      notify("A liderança solicitou que você silencie o microfone.");
    };
    const onEndStream = () => stopVideoSourceRef.current();

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room-joined", onJoined);
    socket.on("room-updated", onRoom);
    socket.on("new-message", onMessage);
    socket.on("action-error", onError);
    socket.on("signal", onSignal);
    socket.on("participant-joined", onParticipantJoined);
    socket.on("participant-left", onParticipantLeft);
    socket.on("removed-from-room", onRemoved);
    socket.on("room-ended", onEnded);
    socket.on("mute-requested", onMute);
    socket.on("end-stream-requested", onEndStream);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room-joined", onJoined);
      socket.off("room-updated", onRoom);
      socket.off("new-message", onMessage);
      socket.off("action-error", onError);
      socket.off("signal", onSignal);
      socket.off("participant-joined", onParticipantJoined);
      socket.off("participant-left", onParticipantLeft);
      socket.off("removed-from-room", onRemoved);
      socket.off("room-ended", onEnded);
      socket.off("mute-requested", onMute);
      socket.off("end-stream-requested", onEndStream);
      socket.disconnect();
    };
    // Socket lifecycle is intentionally bound once; mutable refs keep long-lived handlers current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cleanupMedia = useCallback(() => {
    for (const connection of peerConnections.current.values()) connection.close();
    peerConnections.current.clear();
    pendingCandidates.current.clear();
    remoteMediaStreams.current.clear();
    videoTrackRef.current?.stop();
    audioTrackRef.current?.stop();
    screenAudioTrackRef.current?.stop();
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    videoTrackRef.current = null;
    audioTrackRef.current = null;
    screenAudioTrackRef.current = null;
    micStreamRef.current = null;
    setLocalStream(null);
    setRemoteStreams({});
    setMicrophoneOn(false);
    setCameraOn(false);
    setSharingOn(false);
  }, []);

  const clearRoom = useCallback(() => {
    if (adminMode) {
      window.location.replace("/admin");
      return;
    }
    setRoom(null);
    setSelfId("");
    setModal("");
    setMessages([]);
    window.history.replaceState({}, "", "/");
  }, [adminMode]);

  const stopVideoSource = useCallback(() => {
    const track = videoTrackRef.current;
    if (!track) return;
    syncTracks(track, false);
    track.stop();
    videoTrackRef.current = null;
    if (screenAudioTrackRef.current) {
      syncTracks(screenAudioTrackRef.current, false);
      screenAudioTrackRef.current.stop();
      screenAudioTrackRef.current = null;
    }
    setLocalStream(micStreamRef.current ? new MediaStream(micStreamRef.current.getAudioTracks()) : null);
    setSharingOn(false);
    setCameraOn(false);
    emitMediaState({ sharing: false, camera: false });
  }, [emitMediaState, syncTracks]);
  stopVideoSourceRef.current = stopVideoSource;

  const leaveRoom = useCallback(() => {
    cleanupMedia();
    socket.emit("leave-room");
    clearRoom();
  }, [cleanupMedia, clearRoom, socket]);

  useEffect(() => {
    if (!room || !selfId) return;
    const currentIds = new Set(participants.map((person) => person.id));
    for (const [id, connection] of peerConnections.current.entries()) {
      if (!currentIds.has(id)) {
        connection.close();
        peerConnections.current.delete(id);
        remoteMediaStreams.current.delete(id);
      }
    }
    for (const person of participants) {
      if (person.id !== selfId && selfId.localeCompare(person.id) < 0) createPeer(person.id);
    }
  }, [createPeer, participants, room, selfId]);

  useEffect(() => {
    if (streams.length > 1 && previousStreamCount.current < 2) setShowStreamStrip(true);
    previousStreamCount.current = streams.length;
    if (selectedStream && !streams.some((person) => person.id === selectedStream)) setSelectedStream("");
  }, [selectedStream, streams]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!room) {
      const roomFromLink = new URLSearchParams(window.location.search).get("room");
      const slug = window.location.pathname.match(/^\/watch\/((?:priv|pub)-[a-z0-9]{6})$/i)?.[1];
      if (slug) {
        fetch(`/api/rooms/by-link/${encodeURIComponent(slug)}`)
          .then(async (response) => {
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.message || "Não foi possível encontrar a sala.");
            setJoinCode(payload.code);
            setModal("join");
          })
          .catch((error) => {
            setFormError(error.message);
            setJoinCode("");
            setModal("join");
          });
      } else if (roomFromLink) {
        setJoinCode(roomFromLink);
        setModal("join");
      }
    }
    const onKeyDown = (event) => {
      if (event.key === "Escape") setModal("");
      if (event.key.toLowerCase() === "m" && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName) && room) toggleMicrophone();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [room]);

  async function submitRoom(event) {
    event.preventDefault();
    setFormError("");
    setFormBusy(true);
    const form = new FormData(event.currentTarget);
    const userName = String(form.get("userName") || "").trim();
    if (!userName) {
      setFormError("Digite seu nome para continuar.");
      setFormBusy(false);
      return;
    }
    if (modal === "create") {
      socket.emit("create-room", {
        userName,
        name: String(form.get("roomName") || "").trim(),
        description: String(form.get("description") || "").trim(),
        isPrivate: form.get("privacy") === "private"
      });
    } else {
      socket.emit("join-room", { userName, code: String(form.get("code") || joinCode).trim().toUpperCase() });
    }
  }

  function sendMessage(event) {
    event.preventDefault();
    const text = chatText.trim();
    if (!text || sendingMessage) return;
    if (!connected || !room) {
      notify("Conecte-se à sala para enviar mensagens.");
      return;
    }

    setSendingMessage(true);
    socket.timeout(5000).emit("send-message", { text }, (timeoutError, response) => {
      setSendingMessage(false);
      if (timeoutError) {
        notify("Não foi possível confirmar o envio. Tente novamente.");
        return;
      }
      if (!response?.ok) {
        notify(response?.message || "Não foi possível enviar a mensagem.");
        return;
      }
      setChatText((current) => current.trim() === text ? "" : current);
    });
  }

  async function toggleMicrophone() {
    if (microphoneOn) {
      if (audioTrackRef.current) {
        audioTrackRef.current.enabled = false;
        setMicrophoneOn(false);
        emitMediaState({ microphone: false });
      }
      return;
    }
    try {
      if (!audioTrackRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStreamRef.current = stream;
        audioTrackRef.current = stream.getAudioTracks()[0];
        syncTracks(audioTrackRef.current, true);
      }
      audioTrackRef.current.enabled = true;
      setMicrophoneOn(true);
      emitMediaState({ microphone: true });
    } catch (error) {
      notify(error.name === "NotAllowedError" ? "Permita o acesso ao microfone nas configurações do navegador." : `Não foi possível acessar o microfone: ${error.message}`);
    }
  }

  async function startVideoSource(kind) {
    if (videoTrackRef.current) stopVideoSource();
    try {
      const stream = kind === "screen"
        ? await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true })
        : await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error("Nenhuma faixa de vídeo foi disponibilizada.");
      videoTrackRef.current = track;
      screenAudioTrackRef.current = kind === "screen" ? stream.getAudioTracks()[0] || null : null;
      setLocalStream(stream);
      syncTracks(track, true);
      if (screenAudioTrackRef.current) syncTracks(screenAudioTrackRef.current, true);
      const sharing = kind === "screen";
      setSharingOn(sharing);
      setCameraOn(!sharing);
      emitMediaState({ sharing, camera: !sharing });
      track.onended = () => {
        if (videoTrackRef.current === track) stopVideoSource();
      };
    } catch (error) {
      if (error.name !== "AbortError") {
        notify(error.name === "NotAllowedError" ? "A permissão de captura foi negada ou cancelada." : `Não foi possível iniciar a transmissão: ${error.message}`);
      }
    }
  }

  async function copyText(value, label) {
    try {
      await navigator.clipboard.writeText(value);
      setInviteCopied(true);
      window.setTimeout(() => setInviteCopied(false), 1800);
      notify(`${label} copiado.`);
    } catch {
      notify("Não foi possível copiar. Verifique as permissões do navegador.");
    }
  }

  function requestConfirmation(action) {
    setModal(action);
  }

  function confirmAction() {
    if (modal === "confirm-end-room") socket.emit("end-room");
    if (modal === "confirm-kick" && selectedParticipant) socket.emit("kick-participant", { targetId: selectedParticipant.id });
    setModal("");
    if (modal === "confirm-end-room") {
      cleanupMedia();
      clearRoom();
    }
    if (modal === "confirm-kick") setSelectedParticipant(null);
  }

  function saveSettings(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("roomName") || "").trim();
    const description = String(form.get("description") || "").trim();
    const locked = form.get("locked") === "on";
    socket.emit("update-room", { name, description, locked });
    setModal("");
    notify("Configurações da sala atualizadas.");
  }

  if (adminMode && !room) {
    return (
      <main className="admin-auth-page">
        <section className="admin-auth-card">
          <a className="admin-brand" href="/admin"><span className="brand-mark"><span /></span>NineX<span>.</span></a>
          <div className={`admin-auth-icon${adminJoinError ? " admin-auth-error-icon" : ""}`}>{adminJoinError ? <ShieldCheck size={22} /> : <span className="admin-spinner" />}</div>
          <span className="admin-kicker">ACESSO ADMINISTRATIVO À SALA</span>
          <h1>{adminJoinError ? "Não foi possível entrar" : "Conectando à sala..."}</h1>
          <p>{adminJoinError || "Validando o convite administrativo e conectando aos participantes."}</p>
          {adminJoinError && <a className="admin-back-link" href="/admin">Voltar ao painel</a>}
        </section>
      </main>
    );
  }

  if (!room) {
    return (
      <main className="landing">
        <nav className="landing-nav">
          <a className="brand" href="/" aria-label="NineX início"><span className="brand-mark"><span /></span>NineX<span className="brand-period">.</span></a>
          <span className="nav-note"><span className={`connection-dot ${connected ? "online" : ""}`} />{connected ? "Tudo pronto para conectar" : "Conectando ao servidor"}</span>
        </nav>
        <section className="hero">
          <div className="hero-eyebrow"><span className="eyebrow-line" /> UM ESPAÇO SÓ SEU <span className="eyebrow-line" /></div>
          <h1>Juntos, mesmo<br />de <span>longe.</span></h1>
          <p className="hero-description">Crie um espaço privado para conversar, compartilhar sua tela e fazer acontecer — de qualquer lugar.</p>
          <div className="hero-actions">
            <button className="button-primary" onClick={() => { setFormError(""); setModal("create"); }}><Sparkles size={17} /> Criar sala</button>
            <button className="button-secondary" onClick={() => { setFormError(""); setModal("join"); }}><LogIn size={17} /> Entrar em uma sala</button>
          </div>
          <div className="join-inline"><LockKeyhole size={15} /><span>Já tem um convite?</span><button onClick={() => { setFormError(""); setModal("join"); }}>Insira o código da sala <span>→</span></button></div>
        </section>
        <div className="landing-footer"><span>CONVERSAS QUE APROXIMAM.</span><a className="admin-entry-link" href="/admin">Administração</a><span className="footer-status"><span className={`connection-dot ${connected ? "online" : ""}`} />{connected ? "SERVIÇO OPERACIONAL" : "CONECTANDO"}</span></div>
        {modal === "create" && (
          <Modal title="Criar uma sala" description="Seu espaço, suas pessoas. Comece quando quiser." onClose={() => setModal("")}>
            <form className="form-stack" onSubmit={submitRoom}>
              <label>Seu nome<input name="userName" autoFocus maxLength="32" placeholder="Como podemos te chamar?" required /></label>
              <label>Nome da sala<input name="roomName" maxLength="48" placeholder="Ex.: Sala de planejamento" required /></label>
              <label>Descrição <span className="optional">opcional</span><input name="description" maxLength="160" placeholder="Sobre o que vamos conversar?" /></label>
              <div className="form-label">Privacidade</div>
              <div className="privacy-select"><label><input type="radio" name="privacy" value="private" defaultChecked /><LockKeyhole size={16} /><span><b>Privada</b><small>Só entra quem tiver o convite</small></span></label><label><input type="radio" name="privacy" value="public" /><Users size={16} /><span><b>Pública</b><small>Qualquer pessoa com o código</small></span></label></div>
              {formError && <p className="form-error">{formError}</p>}
              <button className="button-primary button-full" disabled={formBusy || !connected}>{formBusy ? <span className="spinner" /> : <Sparkles size={16} />} Criar sala</button>
            </form>
          </Modal>
        )}
        {modal === "join" && (
          <Modal title="Entrar em uma sala" description="Insira o código que alguém compartilhou com você." onClose={() => setModal("")}>
            <form className="form-stack" onSubmit={submitRoom}>
              <label>Seu nome<input name="userName" autoFocus maxLength="32" placeholder="Como podemos te chamar?" required /></label>
              <label>Código da sala<input name="code" value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} maxLength="10" placeholder="Ex.: A4F29C12D3" className="code-input" required /></label>
              {formError && <p className="form-error">{formError}</p>}
              <button className="button-primary button-full" disabled={formBusy || !connected}>{formBusy ? <span className="spinner" /> : <LogIn size={16} />} Entrar na sala</button>
              <p className="secure-note"><Shield size={14} /> Sua conexão é privada e segura.</p>
            </form>
          </Modal>
        )}
        {toast && <div className="toast"><span className="toast-dot" />{toast}</div>}
      </main>
    );
  }

  return (
    <main className={`room-app${collapsedLeft ? " left-collapsed" : ""}${collapsedRight ? " right-collapsed" : ""}${expanded ? " stage-expanded" : ""}`}>
      <header className="room-header">
        <a className="brand room-brand" href="#" onClick={(event) => event.preventDefault()}><span className="brand-mark"><span /></span>NineX<span className="brand-period">.</span></a>
        <div className="header-divider" />
        <div className="room-heading">
          <div className="room-title-line"><h1>{room.name}</h1><span className={`room-privacy ${room.isPrivate ? "" : "public"}`}><LockKeyhole size={11} />{room.isPrivate ? "PRIVADA" : "PÚBLICA"}</span></div>
          <div className="room-meta"><span className="room-code">{room.code}</span><span className="meta-dot" />{room.description || "Sala de conversa"}<span className="meta-dot" /><Users size={13} />{participants.length}</div>
        </div>
        <div className="header-actions">
          <div className={`connection-pill ${connected ? "connected" : ""}`}><span className="connection-dot" />{connected ? "Conectado" : "Reconectando"}</div>
          <button className="button-invite" onClick={() => setModal("invite")}><Link size={15} /> Convidar</button>
          <button
            className="icon-button chat-toggle"
            onClick={() => setCollapsedRight(!collapsedRight)}
            aria-label={collapsedRight ? "Abrir conversa" : "Fechar conversa"}
            aria-expanded={!collapsedRight}
            aria-controls="room-chat-panel"
            title={collapsedRight ? "Abrir conversa" : "Fechar conversa"}
          ><MessageSquare size={16} /></button>
          {canManageRoom && <button className="icon-button header-manage" onClick={() => { setRoomDraft({ name: room.name, description: room.description, locked: room.locked }); setModal("settings"); }} title={isAdmin ? "Gerenciar como administrador" : "Gerenciar sala"}><SlidersHorizontal size={17} /></button>}
        </div>
      </header>
      <div className="room-layout">
        <div className="remote-audio-output" aria-hidden="true">
          {participants.filter((person) => person.id !== selfId && remoteStreams[person.id]?.getAudioTracks().length)
            .map((person) => <RemoteAudio key={person.id} stream={remoteStreams[person.id]} muted={!audioOn} onPlaybackError={reportAudioPlaybackError} />)}
        </div>
        <aside className={`participants-panel ${collapsedLeft ? "is-collapsed" : ""}`}>
          <div className="panel-top"><div className="panel-heading"><Users size={15} /><span>PARTICIPANTES</span><span className="count-badge">{participants.length}</span></div><button className="icon-button subtle panel-toggle" onClick={() => setCollapsedLeft(!collapsedLeft)} aria-label="Recolher participantes"><ChevronDown size={16} /></button></div>
          <div className="participant-list">
            {participants.map((person) => {
              const isSelf = person.id === selfId;
              const canManagePerson = canManageRoom && !isSelf && !person.admin;
              return <button key={person.id} className={`participant-row${isSelf ? " is-self" : ""}${person.admin ? " is-admin" : ""}${canManagePerson ? " can-manage" : ""}`} onClick={() => canManagePerson && (setSelectedParticipant(person), setModal("participant"))} title={canManagePerson ? "Opções de gerenciamento" : person.name}>
                <span className={`participant-avatar${person.id === room.leaderId ? " leader-avatar" : ""}${person.admin ? " admin-avatar" : ""}`}>{person.admin ? <ShieldCheck size={15} /> : initials(person.name)}{person.id === room.leaderId && <span className="leader-crown"><Crown size={9} /></span>}</span>
                <span className="participant-info"><b>{person.name}{person.admin && <ShieldCheck className="participant-admin-mark" size={12} aria-label="Administrador" />}{isSelf && <small> (você)</small>}</b><small>{person.admin ? "Administrador" : person.id === room.leaderId ? "Líder da sala" : "Participante"}</small></span>
                <span className="participant-status">{person.microphone ? <Mic size={13} className="status-live" /> : <MicOff size={13} />}{person.camera ? <Video size={13} className="status-live" /> : null}{person.sharing ? <Monitor size={13} className="status-live" /> : null}</span>
              </button>;
            })}
          </div>
          <div className="panel-bottom"><span className="secure-indicator"><Shield size={13} /> Sala protegida</span><span>até 24 pessoas</span></div>
        </aside>
        <section className="stage-panel">
          <div className="stage-toolbar"><div className="stage-label"><span className="live-indicator" />{streams.length ? `${streams.length} TRANSMISS${streams.length > 1 ? "ÕES ATIVAS" : "ÃO ATIVA"}` : "ESPAÇO DE TRANSMISSÃO"}</div><div className="stage-actions"><span className="stage-quality"><Signal size={13} /> Alta qualidade</span><button className="icon-button subtle" onClick={() => setExpanded(!expanded)} title={expanded ? "Voltar ao layout" : "Expandir transmissão"}>{expanded ? <Minimize size={16} /> : <Expand size={16} />}</button></div></div>
          {streams.length > 1 && <div className={`stream-picker${showStreamStrip ? " is-open" : ""}`}>
            <button className="stream-picker-toggle" onClick={() => setShowStreamStrip(!showStreamStrip)} aria-expanded={showStreamStrip} aria-label={showStreamStrip ? "Recolher transmissões" : "Mostrar transmissões"} title={showStreamStrip ? "Recolher transmissões" : "Mostrar transmissões"}>
              {showStreamStrip ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
              <span>{streams.length} telas</span>
            </button>
            {showStreamStrip && <div className="stream-strip">{streams.map((person) => <button key={person.id} className={`stream-card${person.id === activeStream?.id ? " active" : ""}`} onClick={() => setSelectedStream(person.id)} aria-pressed={person.id === activeStream?.id}>
              <span className="stream-card-preview"><VideoSurface stream={person.id === selfId ? localStream : remoteStreams[person.id]} muted /><span className="stream-card-type">{person.sharing ? <Monitor size={11} /> : <Video size={11} />}</span></span>
              <span className="stream-card-name"><span className="live-indicator" />{person.name}</span>
            </button>)}</div>}
          </div>}
          <div className={`stage-content${activeStream ? " has-stream" : ""}`}>
            {activeStream ? <div className="stream-view"><VideoSurface stream={activeMediaStream} muted onDoubleClick={() => setExpanded(!expanded)} /><div className="stream-caption"><span className="live-indicator" />{activeStream.id === selfId ? "Você está" : `${activeStream.name} está`} {activeStream.sharing ? "compartilhando a tela" : "com a câmera ligada"}</div><button className="fullscreen-button" onClick={(event) => { const video = event.currentTarget.parentElement.querySelector("video"); if (document.fullscreenElement) document.exitFullscreen(); else video?.requestFullscreen?.(); }} title="Tela cheia"><Maximize size={16} /></button></div> : (
              <div className="stage-empty"><div className="empty-emblem"><div className="emblem-ring ring-one" /><div className="emblem-ring ring-two" /><span><Monitor size={23} /></span></div><h2>Ninguém está transmitindo <span>ainda.</span></h2><p>Compartilhe sua tela ou ligue a câmera<br />para começar a conversa.</p><div className="empty-actions"><button className="button-primary" onClick={() => startVideoSource("screen")}><Monitor size={16} /> Compartilhar tela</button><button className="button-secondary" onClick={() => startVideoSource("camera")}><Video size={16} /> Ligar câmera</button></div><div className="permission-note"><Shield size={12} /> Somente você escolhe o que compartilhar.</div></div>
            )}
            {localStream && videoTrackRef.current && activeStream?.id !== selfId && <div className="self-preview"><VideoSurface stream={localStream} muted /><span><span className="live-indicator" />Você</span><button onClick={stopVideoSource} title="Encerrar transmissão"><X size={13} /></button></div>}
          </div>
          <div className="stage-footer"><span><span className="footer-live-dot" /> {sharingOn ? "Sua tela está sendo compartilhada" : cameraOn ? "Sua câmera está ativa" : "Sala pronta para compartilhar"}</span><span>Mídia protegida pelo WebRTC</span></div>
        </section>
        <aside id="room-chat-panel" className={`chat-panel ${collapsedRight ? "is-collapsed" : ""}`}>
          <div className="panel-top"><div className="panel-heading"><MessageSquare size={15} /><span>CONVERSA</span><span className="chat-live-dot" /></div><button className="icon-button subtle panel-toggle" onClick={() => setCollapsedRight(!collapsedRight)} aria-label="Recolher conversa"><ChevronDown size={16} /></button></div>
          <div className="chat-messages">
            <div className="chat-intro"><span className="chat-intro-icon"><LockKeyhole size={14} /></span><p>Esta conversa é só de vocês.<br /><span>Mensagens visíveis para quem está na sala.</span></p></div>
            {messages.map((message) => <div key={message.id} className={`chat-message${message.senderId === selfId ? " own-message" : ""}`}><div className="message-heading"><b>{message.senderId === selfId ? "Você" : message.sender}</b><time>{formatTime(message.timestamp)}</time></div><p>{message.text}</p></div>)}
            <div ref={chatEndRef} />
          </div>
          <form className="chat-composer" onSubmit={sendMessage}><textarea value={chatText} onChange={(event) => setChatText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(event); } }} maxLength="1000" placeholder="Escreva uma mensagem..." rows="1" /><div className="composer-bottom"><span>Enter para enviar · Shift + Enter para nova linha</span><button type="submit" disabled={!chatText.trim() || sendingMessage || !connected} aria-label="Enviar mensagem"><span>{sendingMessage ? "Enviando…" : "Enviar"}</span><span>↑</span></button></div></form>
        </aside>
      </div>
      <div className="control-dock">
        <div className="dock-side-info"><span className={`dock-avatar${isAdmin ? " admin-avatar" : ""}`}>{isAdmin ? <ShieldCheck size={15} /> : initials(selfParticipant?.name)}</span><span><b>{selfParticipant?.name || "Você"}</b><small>{isAdmin ? "Administrador" : isLeader ? "Líder da sala" : "Na sala"}</small></span></div>
        <div className="dock-controls">
          <button className={`control-button${microphoneOn ? " control-active" : " control-off"}`} onClick={toggleMicrophone} title="Microfone (M)" aria-label={microphoneOn ? "Desativar microfone" : "Ativar microfone"}>{microphoneOn ? <Mic size={18} /> : <MicOff size={18} />}<span className="tooltip">{microphoneOn ? "Desativar microfone" : "Ativar microfone"} · M</span></button>
          <button className={`control-button${audioOn ? " control-active" : " control-off"}`} onClick={() => setAudioOn(!audioOn)} title={audioOn ? "Silenciar áudio recebido" : "Ativar áudio recebido"} aria-label="Alternar áudio recebido">{audioOn ? <Volume2 size={18} /> : <VolumeX size={18} />}<span className="tooltip">{audioOn ? "Silenciar áudio" : "Ativar áudio"}</span></button>
          <button className={`control-button${cameraOn ? " control-active" : " control-off"}`} onClick={() => cameraOn ? stopVideoSource() : startVideoSource("camera")} title={cameraOn ? "Desligar câmera" : "Ligar câmera"} aria-label="Alternar câmera">{cameraOn ? <Video size={18} /> : <VideoOff size={18} />}<span className="tooltip">{cameraOn ? "Desligar câmera" : "Ligar câmera"}</span></button>
          <span className="dock-separator" />
          <button className={`control-button share-control${sharingOn ? " is-sharing" : ""}`} onClick={() => sharingOn ? stopVideoSource() : startVideoSource("screen")} title={sharingOn ? "Encerrar compartilhamento" : "Compartilhar tela"} aria-label="Compartilhar tela">{sharingOn ? <Radio size={18} /> : <Monitor size={18} />}<span className="tooltip">{sharingOn ? "Encerrar transmissão" : "Compartilhar tela"}</span></button>
          <button
            className={`control-button${roomSoundsOn ? " control-active" : " control-off"}`}
            onClick={() => setRoomSoundsOn((current) => {
              const next = !current;
              localStorage.setItem("friendsRoomSounds", String(next));
              return next;
            })}
            title={roomSoundsOn ? "Desativar sons de eventos" : "Ativar sons de eventos"}
            aria-label={roomSoundsOn ? "Desativar sons de eventos" : "Ativar sons de eventos"}
            aria-pressed={roomSoundsOn}
          >
            {roomSoundsOn ? <Volume2 size={18} /> : <VolumeX size={18} />}
            <span className="tooltip">{roomSoundsOn ? "Sons de eventos ativos" : "Sons de eventos desativados"}</span>
          </button>
          <button className="control-button settings-control" onClick={() => { setRoomDraft({ name: room.name, description: room.description, locked: room.locked }); setModal("settings"); }} title="Configurações" aria-label="Configurações"><Settings size={18} /><span className="tooltip">Configurações</span></button>
        </div>
        <div className="dock-side-actions">{canManageRoom && <button className="end-room-button" onClick={() => requestConfirmation("confirm-end-room")}><DoorOpen size={15} /><span>Encerrar sala</span></button>}<button className="leave-button" onClick={() => requestConfirmation("confirm-leave")} title="Sair da sala"><LogIn size={16} /><span>Sair</span></button></div>
      </div>

      {modal === "invite" && <Modal title="Convide alguém" description="Compartilhe o código ou o link para sua sala." onClose={() => setModal("")}>
        <div className="invite-code-label">CÓDIGO DA SALA</div><div className="invite-code"><strong>{room.code}</strong><button className="icon-button" onClick={() => copyText(room.code, "Código")} aria-label="Copiar código">{inviteCopied ? <Check size={17} /> : <Copy size={17} />}</button></div><button className="button-secondary button-full invite-link" onClick={() => copyText(`${window.location.origin}/watch/${room.slug}`, "Link de convite")}><Link size={16} /> Copiar link de convite</button><p className="secure-note"><LockKeyhole size={14} /> A sala {room.isPrivate ? "é privada. Compartilhe apenas com quem você confia." : "pode ser acessada por qualquer pessoa com o código."}</p>
      </Modal>}
      {modal === "settings" && <Modal title={canManageRoom ? "Gerenciar sala" : "Configurações"} description={canManageRoom ? (isAdmin ? "Você tem privilégios administrativos acima da liderança desta sala." : "Personalize sua sala e controle quem pode entrar.") : "Preferências da sua experiência."} onClose={() => setModal("")}>
        {canManageRoom ? <form className="form-stack" onSubmit={saveSettings}><label>Nome da sala<input name="roomName" defaultValue={roomDraft.name} maxLength="48" required /></label><label>Descrição<input name="description" defaultValue={roomDraft.description} maxLength="160" placeholder="Adicione uma descrição" /></label><label className="toggle-setting"><span><b>Bloquear novas entradas</b><small>Quem não está na sala não poderá entrar.</small></span><input type="checkbox" name="locked" defaultChecked={roomDraft.locked} /></label><div className="settings-note"><Shield size={15} /> As permissões são verificadas pelo servidor.</div><button className="button-primary button-full"><Check size={16} /> Salvar alterações</button><button type="button" className="danger-outline button-full" onClick={() => setModal("confirm-end-room")}><DoorOpen size={16} /> Encerrar sala para todos</button></form> : <div className="settings-note"><Shield size={15} /> Apenas a liderança pode alterar as configurações desta sala.</div>}
      </Modal>}
      {modal === "participant" && selectedParticipant && <Modal title={selectedParticipant.name} description={selectedParticipant.id === room.leaderId ? "Líder da sala" : "Gerenciar participante"} onClose={() => { setModal(""); setSelectedParticipant(null); }}><div className="participant-actions"><button className="participant-action" onClick={() => { socket.emit("transfer-leadership", { targetId: selectedParticipant.id }); setModal(""); }}><Crown size={17} /><span><b>Transferir liderança</b><small>Passar o controle da sala</small></span></button><button className="participant-action" onClick={() => { socket.emit("mute-participant", { targetId: selectedParticipant.id }); setModal(""); notify("Solicitação de silêncio enviada."); }}><MicOff size={17} /><span><b>Solicitar silêncio</b><small>A pessoa poderá ativar o microfone novamente</small></span></button>{selectedParticipant.sharing && <button className="participant-action" onClick={() => { socket.emit("end-participant-stream", { targetId: selectedParticipant.id }); setModal(""); }}><Monitor size={17} /><span><b>Encerrar transmissão</b><small>Parar o compartilhamento desta pessoa</small></span></button>}<button className="participant-action danger-text" onClick={() => setModal("confirm-kick")}><X size={17} /><span><b>Remover da sala</b><small>A pessoa precisará de um novo convite</small></span></button></div></Modal>}
      {modal === "confirm-leave" && <Modal title="Sair da sala?" description={isAdmin ? "Você poderá voltar a esta sala pelo painel administrativo." : isLeader ? "A liderança será transferida automaticamente para outra pessoa." : "Você poderá voltar com o código da sala."} onClose={() => setModal("")}><div className="confirm-actions"><button className="button-secondary" onClick={() => setModal("")}>Continuar na sala</button><button className="danger-button" onClick={leaveRoom}>Sair da sala</button></div></Modal>}
      {modal === "confirm-end-room" && <Modal title="Encerrar esta sala?" description="Todas as pessoas serão desconectadas e a sala deixará de existir." onClose={() => setModal("")}><div className="confirm-actions"><button className="button-secondary" onClick={() => setModal("")}>Cancelar</button><button className="danger-button" onClick={confirmAction}>Encerrar para todos</button></div></Modal>}
      {modal === "confirm-kick" && <Modal title={`Remover ${selectedParticipant?.name}?`} description="Essa pessoa será desconectada da sala." onClose={() => setModal("participant")}><div className="confirm-actions"><button className="button-secondary" onClick={() => setModal("participant")}>Cancelar</button><button className="danger-button" onClick={confirmAction}>Remover participante</button></div></Modal>}
      {toast && <div className="toast room-toast"><span className="toast-dot" />{toast}</div>}
    </main>
  );
}
