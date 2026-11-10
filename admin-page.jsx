import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowLeft, ArrowRight, Check, Clock3, DoorOpen, Eye, EyeOff,
  KeyRound, LockKeyhole, LogOut, Monitor, RefreshCw, Search, Shield,
  ShieldCheck, UnlockKeyhole, Users, Video
} from "lucide-react";
import { apiUrl } from "./socket.js";

async function adminRequest(path, options = {}) {
  const response = await fetch(apiUrl(path), {
    credentials: "include",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = response.status === 404
      ? "A API administrativa não foi encontrada. Configure VITE_API_URL com a URL pública do backend e publique o frontend novamente."
      : payload.message || "Não foi possível concluir a operação.";
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function MetricCard({ icon: Icon, label, value, note, accent = false }) {
  return (
    <article className={`admin-metric${accent ? " metric-accent" : ""}`}>
      <div className="metric-top">
        <span className="metric-icon"><Icon size={17} /></span>
        <span className="metric-note">{note}</span>
      </div>
      <strong>{value}</strong>
      <span className="metric-label">{label}</span>
    </article>
  );
}

export default function AdminPage() {
  const [phase, setPhase] = useState("checking");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [overview, setOverview] = useState({ rooms: 0, participants: 0, sharing: 0, lockedRooms: 0 });
  const [rooms, setRooms] = useState([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [pendingRoom, setPendingRoom] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [enteringRoom, setEnteringRoom] = useState("");

  const refreshDashboard = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      const [nextOverview, nextRooms] = await Promise.all([
        adminRequest("/api/admin/overview"),
        adminRequest("/api/admin/rooms")
      ]);
      setOverview(nextOverview);
      setRooms(nextRooms.rooms);
      setError("");
      setPhase("dashboard");
    } catch (requestError) {
      if (requestError.status === 401) {
        setPhase("login");
        setRooms([]);
        setOverview({ rooms: 0, participants: 0, sharing: 0, lockedRooms: 0 });
      } else {
        setError(requestError.message);
        if (requestError.status === 503) setPhase("unconfigured");
      }
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    adminRequest("/api/admin/session")
      .then(({ authenticated }) => {
        if (!active) return;
        if (authenticated) refreshDashboard(true);
        else setPhase("login");
      })
      .catch((requestError) => {
        if (!active) return;
        setError(requestError.message);
        setPhase(requestError.status === 503 ? "unconfigured" : "login");
      });
    return () => { active = false; };
  }, [refreshDashboard]);

  useEffect(() => {
    if (phase !== "dashboard") return undefined;
    const timer = window.setInterval(() => refreshDashboard(true), 15_000);
    return () => window.clearInterval(timer);
  }, [phase, refreshDashboard]);

  const visibleRooms = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
    return rooms.filter((room) => {
      const matchesFilter = filter === "all" ||
        (filter === "locked" && room.locked) ||
        (filter === "sharing" && room.participants.some((participant) => participant.sharing));
      const matchesQuery = !normalizedQuery ||
        `${room.name} ${room.code} ${room.leader} ${room.participants.map((person) => person.name).join(" ")}`
          .toLocaleLowerCase("pt-BR")
          .includes(normalizedQuery);
      return matchesFilter && matchesQuery;
    });
  }, [filter, query, rooms]);

  async function submitLogin(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await adminRequest("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ password })
      });
      setPassword("");
      await refreshDashboard(true);
    } catch (requestError) {
      setError(requestError.message);
      if (requestError.status === 503) setPhase("unconfigured");
    } finally {
      setBusy(false);
    }
  }

  async function toggleRoomLock(room) {
    setBusy(true);
    setError("");
    try {
      await adminRequest(`/api/admin/rooms/${encodeURIComponent(room.code)}`, {
        method: "PATCH",
        body: JSON.stringify({ locked: !room.locked })
      });
      setToast(room.locked ? "Sala desbloqueada." : "Sala bloqueada para novas entradas.");
      await refreshDashboard(true);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function endSelectedRoom() {
    if (!pendingRoom) return;
    setBusy(true);
    setError("");
    try {
      await adminRequest(`/api/admin/rooms/${encodeURIComponent(pendingRoom.code)}`, { method: "DELETE" });
      setToast(`Sala ${pendingRoom.code} encerrada.`);
      setPendingRoom(null);
      await refreshDashboard(true);
    } catch (requestError) {
      setError(requestError.message);
      setPendingRoom(null);
    } finally {
      setBusy(false);
    }
  }

  async function enterRoomAsAdmin(room) {
    setEnteringRoom(room.code);
    setError("");
    try {
      const { ticket } = await adminRequest(`/api/admin/rooms/${encodeURIComponent(room.code)}/access-ticket`, {
        method: "POST"
      });
      sessionStorage.setItem("friendsAdminRoomTicket", ticket);
      window.location.assign(`/admin/room?room=${encodeURIComponent(room.code)}`);
    } catch (requestError) {
      setError(requestError.message);
      setEnteringRoom("");
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await adminRequest("/api/admin/logout", { method: "POST" });
      setRooms([]);
      setOverview({ rooms: 0, participants: 0, sharing: 0, lockedRooms: 0 });
      setPhase("login");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (phase === "checking") {
    return <main className="admin-auth-page"><div className="admin-auth-card"><span className="admin-spinner" /><p>Verificando acesso administrativo...</p></div></main>;
  }

  if (phase === "unconfigured") {
    return (
      <main className="admin-auth-page">
        <section className="admin-auth-card">
          <a className="admin-brand" href="/"><span className="brand-mark"><span /></span>NineX<span>.</span></a>
          <div className="admin-auth-icon"><Shield size={22} /></div>
          <span className="admin-kicker">CONFIGURAÇÃO NECESSÁRIA</span>
          <h1>Painel desativado</h1>
          <p>Defina uma senha segura em <code>ADMIN_PASSWORD</code> no ambiente do servidor e reinicie a aplicação para habilitar o acesso.</p>
          <a className="admin-back-link" href="/"><ArrowLeft size={15} /> Voltar ao NineX</a>
        </section>
      </main>
    );
  }

  if (phase === "login") {
    return (
      <main className="admin-auth-page">
        <section className="admin-auth-card">
          <a className="admin-brand" href="/"><span className="brand-mark"><span /></span>NineX<span>.</span></a>
          <div className="admin-auth-icon"><ShieldCheck size={22} /></div>
          <span className="admin-kicker">ÁREA RESTRITA</span>
          <h1>Acesso administrativo</h1>
          <p>Entre com a senha de administrador configurada no servidor.</p>
          <form className="admin-login-form" onSubmit={submitLogin}>
            <label htmlFor="admin-password">Senha administrativa</label>
            <div className="admin-password-field">
              <KeyRound size={16} />
              <input
                autoFocus
                id="admin-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Digite sua senha"
                autoComplete="current-password"
                required
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}>
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {error && <p className="admin-error">{error}</p>}
            <button className="admin-submit" disabled={busy || !password}>
              {busy ? <span className="admin-spinner" /> : <ShieldCheck size={16} />} Entrar no painel <ArrowRight size={15} />
            </button>
          </form>
          <div className="admin-auth-foot"><LockKeyhole size={13} /> Conexão protegida por sessão HttpOnly</div>
          <a className="admin-back-link" href="/"><ArrowLeft size={15} /> Voltar ao NineX</a>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <a className="admin-brand" href="/"><span className="brand-mark"><span /></span>NineX<span>.</span></a>
        <div className="admin-side-label">WORKSPACE</div>
        <div className="admin-side-active"><Activity size={16} /> Visão geral</div>
        <div className="admin-sidebar-bottom">
          <span className="admin-online"><i /> Servidor operacional</span>
          <button onClick={logout} disabled={busy}><LogOut size={15} /> Sair do painel</button>
        </div>
      </aside>

      <section className="admin-main">
        <header className="admin-topbar">
          <div><span className="admin-breadcrumb">NineX <span>/</span> Administração</span><h1>Painel de controle</h1></div>
          <div className="admin-top-actions"><span className="admin-live"><i /> AO VIVO</span><button className="admin-refresh" onClick={() => refreshDashboard()} disabled={refreshing}><RefreshCw size={15} className={refreshing ? "is-spinning" : ""} /> Atualizar</button></div>
        </header>
        <div className="admin-content">
          <div className="admin-welcome"><div><h2>Visão geral</h2><p>Acompanhe as salas e a atividade da plataforma em tempo real.</p></div><div className="admin-updated"><Clock3 size={14} /> Atualização automática a cada 15s</div></div>
          {error && <div className="admin-inline-error"><Shield size={15} />{error}</div>}
          <section className="admin-metrics">
            <MetricCard icon={Activity} label="Salas ativas" value={overview.rooms} note="AGORA" accent />
            <MetricCard icon={Users} label="Pessoas conectadas" value={overview.participants} note="AO VIVO" />
            <MetricCard icon={Monitor} label="Transmitindo" value={overview.sharing} note="WEBRTC" />
            <MetricCard icon={LockKeyhole} label="Salas bloqueadas" value={overview.lockedRooms} note="ACESSO" />
          </section>

          <section className="admin-room-section">
            <div className="admin-section-heading"><div><span className="admin-section-icon"><Users size={16} /></span><div><h2>Salas em andamento</h2><p>{rooms.length} {rooms.length === 1 ? "sala ativa" : "salas ativas"} no servidor</p></div></div><span className="admin-count">{visibleRooms.length} resultados</span></div>
            <div className="admin-filters">
              <label className="admin-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por sala, código ou participante..." /></label>
              <div className="admin-filter-tabs">
                {[["all", "Todas"], ["sharing", "Transmitindo"], ["locked", "Bloqueadas"]].map(([value, label]) => <button key={value} className={filter === value ? "selected" : ""} onClick={() => setFilter(value)}>{label}</button>)}
              </div>
            </div>
            <div className="admin-room-list">
              {visibleRooms.length ? visibleRooms.map((room) => (
                <article className="admin-room-card" key={room.code}>
                  <div className="admin-room-card-head">
                    <div className="admin-room-title"><span className="admin-room-icon"><Video size={17} /></span><div><h3>{room.name}</h3><span>{room.code} <i /> {room.isPrivate ? "Privada" : "Pública"} <i /> Criada {formatTime(room.createdAt)}</span></div></div>
                    <div className="admin-room-badges"><span className={`room-state ${room.locked ? "is-locked" : ""}`}><i />{room.locked ? "Bloqueada" : "Aberta"}</span><span className="room-people"><Users size={13} />{room.participants.length}</span></div>
                  </div>
                  {room.description && <p className="admin-room-description">{room.description}</p>}
                  <div className="admin-room-details">
                    <div className="admin-room-leader"><span>LÍDER</span><strong>{room.leader}</strong></div>
                    <div className="admin-participant-chips">{room.participants.map((participant) => <span className="admin-person-chip" key={participant.id}><i className={participant.sharing ? "person-sharing" : ""} />{participant.name}{participant.sharing && <Monitor size={11} />}</span>)}</div>
                  </div>
                  <div className="admin-room-actions">
                    <button className="admin-enter-room" onClick={() => enterRoomAsAdmin(room)} disabled={busy || Boolean(enteringRoom)}>
                      <ShieldCheck size={14} />{enteringRoom === room.code ? "Entrando..." : "Entrar como admin"}
                    </button>
                    <a href={`/watch/${room.slug}`} target="_blank" rel="noreferrer">Abrir convite <ArrowRight size={14} /></a>
                    <button onClick={() => toggleRoomLock(room)} disabled={busy}>{room.locked ? <UnlockKeyhole size={14} /> : <LockKeyhole size={14} />}{room.locked ? "Desbloquear entradas" : "Bloquear entradas"}</button>
                    <button className="admin-end-action" onClick={() => setPendingRoom(room)} disabled={busy}><DoorOpen size={14} /> Encerrar sala</button>
                  </div>
                </article>
              )) : (
                <div className="admin-empty"><span><Search size={19} /></span><h3>{rooms.length ? "Nenhuma sala encontrada" : "Nenhuma sala ativa"}</h3><p>{rooms.length ? "Tente mudar a busca ou o filtro selecionado." : "As salas aparecerão aqui assim que alguém criar uma."}</p></div>
              )}
            </div>
          </section>
          <footer className="admin-footer"><span><ShieldCheck size={14} /> Sessão administrativa protegida</span><a href="/"><ArrowLeft size={14} /> Voltar para o NineX</a></footer>
        </div>
      </section>

      {pendingRoom && <div className="admin-confirm-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingRoom(null); }}>
        <section className="admin-confirm" role="dialog" aria-modal="true" aria-labelledby="admin-confirm-title">
          <span className="admin-confirm-icon"><DoorOpen size={19} /></span>
          <h2 id="admin-confirm-title">Encerrar “{pendingRoom.name}”?</h2>
          <p>Todos os {pendingRoom.participants.length} participantes serão desconectados. Esta ação não pode ser desfeita.</p>
          <div><button onClick={() => setPendingRoom(null)} disabled={busy}>Cancelar</button><button className="admin-end-action" onClick={endSelectedRoom} disabled={busy}>{busy ? "Encerrando..." : "Encerrar sala"}</button></div>
        </section>
      </div>}
      {toast && <div className="admin-toast"><Check size={15} />{toast}</div>}
    </main>
  );
}
