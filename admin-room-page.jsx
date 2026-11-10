import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Shield, ShieldAlert } from "lucide-react";
import App from "./App.jsx";
import { apiUrl } from "./socket.js";

export default function AdminRoomPage() {
  const [access, setAccess] = useState({ status: "loading", ticket: "", message: "" });
  const [adminName, setAdminName] = useState("");
  const code = new URLSearchParams(window.location.search).get("room")?.toUpperCase() || "";

  useEffect(() => {
    let active = true;
    async function prepareAdminAccess() {
      try {
        const ticket = sessionStorage.getItem("friendsAdminRoomTicket");
        if (!/^[A-F0-9]{10}$/.test(code) || !ticket) {
          throw new Error("Volte ao painel e entre na sala pelo botão “Entrar como admin”.");
        }
        const response = await fetch(apiUrl("/api/admin/session"), { credentials: "include" });
        const session = await response.json().catch(() => ({}));
        if (!response.ok || !session.authenticated) {
          throw new Error(session.message || "Sua sessão administrativa expirou. Entre novamente no painel.");
        }
        if (active) setAccess({ status: "ready", ticket, message: "" });
      } catch (error) {
        if (active) setAccess({ status: "error", ticket: "", message: error.message });
      }
    }
    prepareAdminAccess();
    return () => { active = false; };
  }, [code]);

  function joinRoom(event) {
    event.preventDefault();
    const name = adminName.trim();
    if (!name) return;
    setAdminName(name);
    setAccess((current) => ({ ...current, status: "joining" }));
  }

  if (access.status === "joining") {
    return <App adminMode adminCode={code} adminName={adminName} initialAdminTicket={access.ticket} />;
  }

  return (
    <main className="admin-auth-page">
      <section className="admin-auth-card">
        <a className="admin-brand" href="/"><span className="brand-mark"><span /></span>NineX<span>.</span></a>
        <div className="admin-auth-icon">{access.status === "loading" ? <Shield size={22} /> : access.status === "error" ? <ShieldAlert size={22} /> : <Shield size={22} />}</div>
        <span className="admin-kicker">ACESSO ADMINISTRATIVO À SALA</span>
        <h1>{access.status === "loading" ? "Preparando acesso..." : access.status === "ready" ? "Como você quer aparecer?" : "Não foi possível entrar"}</h1>
        <p>{access.status === "loading" ? "Validando sua sessão e preparando uma entrada protegida." : access.status === "ready" ? "Escolha o nome que os participantes verão. Seu distintivo indicará que você é administrador." : access.message}</p>
        {access.status === "ready" && <form className="admin-login-form" onSubmit={joinRoom}>
          <label htmlFor="admin-display-name">Nome de exibição</label>
          <div className="admin-password-field admin-name-field">
            <input id="admin-display-name" value={adminName} onChange={(event) => setAdminName(event.target.value)} maxLength={32} placeholder="Seu nome na sala" autoComplete="nickname" autoFocus required />
            <Shield size={15} aria-label="Distintivo administrativo" />
          </div>
          <button className="admin-submit" type="submit" disabled={!adminName.trim()}>Entrar na sala <ArrowRight size={15} /></button>
        </form>}
        {access.status === "error" && <a className="admin-back-link" href="/admin"><ArrowLeft size={15} /> Voltar ao painel</a>}
      </section>
    </main>
  );
}
