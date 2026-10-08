"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  Camera, Check, KeyRound, Laptop, LogOut, Monitor, ShieldCheck, Smartphone, SlidersHorizontal, Trash2, User as UserIcon, X,
} from "lucide-react";
import { api } from "../../lib/api";

/**
 * Configurações ligadas à InduSense API:
 *  Perfil (com foto)  -> GET/PATCH /users/profile
 *  Senha              -> PATCH /users/profile/password
 *  Sessões            -> GET /users/profile/sessions, DELETE /users/profile/sessions/:id, POST .../revoke-others
 *  Permissões         -> o que cada perfil pode fazer
 *  Preferências       -> salvas neste navegador
 */

type Perfil = "ADMIN" | "OPERADOR" | "VISUALIZADOR";
type Me = {
  id: string; nome: string; email: string; cargo?: string | null; empresa?: string | null;
  perfil: Perfil; avatar?: string | null; ultimoAcesso?: string | null; createdAt?: string;
};
type Sessao = { id: string; atual: boolean; dispositivo?: string | null; ip?: string | null; criadaEm: string; ultimoUso: string; expiraEm: string };

const USER_KEY = "indusense_user";
const PREFS_KEY = "indusense_prefs";
const BASE = ((api as any).baseUrl as string) || "";
const token = () => (typeof window === "undefined" ? "" : localStorage.getItem("indusense_token") ?? "");

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}`, ...(init.headers || {}) },
    });
  } catch {
    throw new Error("Sem conexão com a API. Ela pode estar acordando; tente de novo em alguns segundos.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) throw new Error("Sessão expirada. Saia e entre de novo.");
    const msg = body?.message;
    throw new Error(Array.isArray(msg) ? msg[0] : msg || `Erro ${res.status}`);
  }
  return (body?.data ?? body) as T;
}

/** Guarda o usuário atualizado e avisa a barra lateral/topo para trocar nome e foto. */
export function salvarUsuarioLocal(u: Partial<Me>) {
  try {
    const atual = JSON.parse(localStorage.getItem(USER_KEY) || "{}");
    localStorage.setItem(USER_KEY, JSON.stringify({ ...atual, ...u }));
    window.dispatchEvent(new Event("indusense:user"));
  } catch { /* ignore */ }
}

/** Hook para Sidebar/Topbar: usuário salvo, atualizado quando o perfil muda. */
export function useSavedUser() {
  const [u, setU] = useState<Me | null>(null);
  useEffect(() => {
    const ler = () => { try { setU(JSON.parse(localStorage.getItem(USER_KEY) || "null")); } catch { setU(null); } };
    ler();
    window.addEventListener("indusense:user", ler);
    window.addEventListener("storage", ler);
    return () => { window.removeEventListener("indusense:user", ler); window.removeEventListener("storage", ler); };
  }, []);
  return u;
}

export const iniciais = (nome?: string | null) =>
  (nome || "?").split(" ").filter(Boolean).map((x) => x[0]).slice(0, 2).join("").toUpperCase();

/** Avatar com foto ou iniciais. */
export function Avatar({ user, size = 36, className = "" }: { user?: Partial<Me> | null; size?: number; className?: string }) {
  return user?.avatar
    ? <img src={user.avatar} alt="" className={`avatar-img ${className}`} style={{ width: size, height: size }} />
    : <span className={`avatar-fallback ${className}`} style={{ width: size, height: size, fontSize: size * 0.34 }}>{iniciais(user?.nome)}</span>;
}

// ---------------------------------------------------------------- utilidades

/** Reduz a foto para 256×256 (corte central) e devolve um JPEG em data URL (~20–40 KB). */
function redimensionar(arquivo: File): Promise<string> {
  return new Promise((ok, falha) => {
    if (!arquivo.type.startsWith("image/")) return falha(new Error("Escolha um arquivo de imagem."));
    if (arquivo.size > 15 * 1024 * 1024) return falha(new Error("Imagem maior que 15 MB."));
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      const lado = Math.min(img.width, img.height);
      const c = document.createElement("canvas");
      c.width = c.height = 256;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, (img.width - lado) / 2, (img.height - lado) / 2, lado, lado, 0, 0, 256, 256);
      URL.revokeObjectURL(url);
      ok(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); falha(new Error("Não foi possível ler essa imagem.")); };
    img.src = url;
  });
}

function descreverDispositivo(ua?: string | null) {
  const u = ua || "";
  const nav = /Edg\//.test(u) ? "Edge" : /OPR\//.test(u) ? "Opera" : /Chrome\//.test(u) ? "Chrome" : /Firefox\//.test(u) ? "Firefox"
    : /Safari\//.test(u) ? "Safari" : /Dart|okhttp|CFNetwork/i.test(u) ? "App InduSense" : "Navegador";
  const so = /iPhone|iPad/.test(u) ? "iPhone/iPad" : /Android/.test(u) ? "Android" : /Mac OS X|Macintosh/.test(u) ? "macOS"
    : /Windows/.test(u) ? "Windows" : /Linux/.test(u) ? "Linux" : /Dart/.test(u) ? "celular" : "";
  const movel = /iPhone|Android|Mobile|Dart/i.test(u);
  return { texto: so ? `${nav} no ${so}` : nav, movel };
}

function quando(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 2) return "agora";
  if (min < 60) return `há ${min} min`;
  if (min < 1440) return `há ${Math.round(min / 60)} h`;
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function forcaSenha(s: string) {
  let p = 0;
  if (s.length >= 8) p++;
  if (s.length >= 12) p++;
  if (/[a-z]/.test(s) && /[A-Z]/.test(s)) p++;
  if (/\d/.test(s)) p++;
  if (/[^A-Za-z0-9]/.test(s)) p++;
  return Math.min(p, 4);
}

const PERFIL_INFO: Record<Perfil, { nome: string; desc: string }> = {
  ADMIN: { nome: "Administrador", desc: "Acesso total ao sistema, inclusive usuários e cadastros." },
  OPERADOR: { nome: "Operador", desc: "Acompanha tudo e trata alertas e ocorrências." },
  VISUALIZADOR: { nome: "Visualizador", desc: "Somente visualização dos painéis." },
};

const PERMISSOES: { area: string; itens: [string, Perfil[]][] }[] = [
  { area: "Monitoramento", itens: [
    ["Ver painel, salas, sensores e câmeras", ["ADMIN", "OPERADOR", "VISUALIZADOR"]],
    ["Ver histórico e relatórios", ["ADMIN", "OPERADOR", "VISUALIZADOR"]],
  ] },
  { area: "Alertas e EPI", itens: [
    ["Ver alertas e ocorrências de EPI", ["ADMIN", "OPERADOR", "VISUALIZADOR"]],
    ["Resolver alertas e ocorrências", ["ADMIN", "OPERADOR"]],
    ["Registrar leituras manualmente", ["ADMIN", "OPERADOR"]],
  ] },
  { area: "Cadastros", itens: [
    ["Cadastrar e editar salas e sensores", ["ADMIN"]],
    ["Cadastrar e editar câmeras", ["ADMIN"]],
  ] },
  { area: "Administração", itens: [
    ["Criar, editar e desativar usuários", ["ADMIN"]],
    ["Alterar perfis de acesso", ["ADMIN"]],
  ] },
];

type Prefs = { unidade: "C" | "F"; intervalo: number; som: boolean; notificacoes: boolean };
const PREFS_PADRAO: Prefs = { unidade: "C", intervalo: 5, som: false, notificacoes: true };
export function lerPrefs(): Prefs {
  try { return { ...PREFS_PADRAO, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") }; } catch { return PREFS_PADRAO; }
}

// ---------------------------------------------------------------- tela

type Aba = "perfil" | "seguranca" | "sessoes" | "permissoes" | "preferencias";
const ABAS: { id: Aba; label: string; icon: any }[] = [
  { id: "perfil", label: "Perfil", icon: UserIcon },
  { id: "seguranca", label: "Senha", icon: KeyRound },
  { id: "sessoes", label: "Sessões", icon: Monitor },
  { id: "permissoes", label: "Permissões", icon: ShieldCheck },
  { id: "preferencias", label: "Preferências", icon: SlidersHorizontal },
];

export default function SettingsPage({ onGoUsers }: { onGoUsers?: () => void }) {
  const [aba, setAba] = useState<Aba>("perfil");
  const [me, setMe] = useState<Me | null>(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  const carregar = useCallback(async () => {
    setErro("");
    try {
      const u = await call<Me>("/users/profile");
      setMe(u);
      salvarUsuarioLocal(u);
    } catch (e: any) {
      setErro(e.message);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 3800);
    return () => clearTimeout(t);
  }, [aviso]);

  const ok = (texto: string) => setAviso({ tipo: "ok", texto });
  const falha = (texto: string) => setAviso({ tipo: "erro", texto });

  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <span className="eyebrow dark">SISTEMA</span>
          <h1>Configurações</h1>
          <p>Seu perfil, segurança da conta e preferências do painel.</p>
        </div>
      </div>

      {erro ? (
        <section className="panel settings-error">
          <b>Não foi possível carregar seu perfil</b>
          <span>{erro}</span>
          <button className="ghost-btn" onClick={carregar}>Tentar de novo</button>
        </section>
      ) : !me ? (
        <section className="panel settings-error"><span>Carregando…</span></section>
      ) : (
        <div className="cfg-layout">
          <nav className="cfg-tabs" aria-label="Seções">
            <div className="cfg-me">
              <Avatar user={me} size={44} />
              <div><b>{me.nome}</b><small>{PERFIL_INFO[me.perfil]?.nome ?? me.perfil}</small></div>
            </div>
            {ABAS.map(({ id, label, icon: Icon }) => (
              <button key={id} className={aba === id ? "active" : ""} onClick={() => setAba(id)}>
                <Icon size={16} /> {label}
              </button>
            ))}
          </nav>
          <div className="cfg-body">
            {aba === "perfil" && <PerfilTab me={me} onSaved={(u) => { setMe(u); salvarUsuarioLocal(u); ok("Perfil atualizado."); }} onError={falha} />}
            {aba === "seguranca" && <SenhaTab onDone={(n) => ok(n ? `Senha alterada. ${n} outro(s) aparelho(s) foram desconectados.` : "Senha alterada.")} onError={falha} />}
            {aba === "sessoes" && <SessoesTab onInfo={ok} onError={falha} />}
            {aba === "permissoes" && <PermissoesTab perfil={me.perfil} onGoUsers={onGoUsers} />}
            {aba === "preferencias" && <PreferenciasTab onSaved={() => ok("Preferências salvas neste navegador.")} />}
          </div>
        </div>
      )}

      {aviso && <div className={`users-toast ${aviso.tipo === "erro" ? "toast-error" : ""}`}>{aviso.texto}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- abas

function PerfilTab({ me, onSaved, onError }: { me: Me; onSaved: (u: Me) => void; onError: (m: string) => void }) {
  const [form, setForm] = useState({ nome: me.nome, email: me.email, cargo: me.cargo ?? "", empresa: me.empresa ?? "" });
  const [avatar, setAvatar] = useState<string | null>(me.avatar ?? null);
  const [salvando, setSalvando] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const mudou = form.nome !== me.nome || form.email !== me.email || form.cargo !== (me.cargo ?? "")
    || form.empresa !== (me.empresa ?? "") || avatar !== (me.avatar ?? null);

  async function escolherFoto(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try { setAvatar(await redimensionar(f)); } catch (err: any) { onError(err.message); }
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!form.nome.trim()) return onError("Informe seu nome.");
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) return onError("E-mail inválido.");
    setSalvando(true);
    try {
      const body: Record<string, string> = { nome: form.nome.trim(), email: form.email.trim().toLowerCase(), cargo: form.cargo.trim(), empresa: form.empresa.trim() };
      if (avatar !== (me.avatar ?? null)) body.avatar = avatar ?? "";
      onSaved(await call<Me>("/users/profile", { method: "PATCH", body: JSON.stringify(body) }));
    } catch (err: any) {
      onError(err.message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form className="panel cfg-card" onSubmit={salvar}>
      <h3>Perfil</h3>
      <p>Essas informações aparecem no painel e no aplicativo.</p>

      <div className="photo-row">
        <div className="photo-wrap">
          <Avatar user={{ nome: form.nome, avatar }} size={88} />
          <button type="button" className="photo-cam" onClick={() => input.current?.click()} aria-label="Trocar foto"><Camera size={15} /></button>
        </div>
        <div>
          <b>Foto de perfil</b>
          <small>JPG, PNG ou WEBP. Ela é recortada em quadrado automaticamente.</small>
          <div className="photo-actions">
            <button type="button" className="ghost-btn" onClick={() => input.current?.click()}>{avatar ? "Trocar foto" : "Enviar foto"}</button>
            {avatar && <button type="button" className="ghost-btn danger-text" onClick={() => setAvatar(null)}><Trash2 size={14} /> Remover</button>}
          </div>
        </div>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={escolherFoto} />
      </div>

      <div className="cfg-grid">
        <label>Nome completo<input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></label>
        <label>E-mail<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <label>Cargo<input value={form.cargo} onChange={(e) => setForm({ ...form, cargo: e.target.value })} placeholder="Ex.: Engenheiro de segurança" /></label>
        <label>Empresa<input value={form.empresa} onChange={(e) => setForm({ ...form, empresa: e.target.value })} /></label>
      </div>

      <div className="cfg-meta">
        <span>Perfil de acesso: <b>{PERFIL_INFO[me.perfil]?.nome ?? me.perfil}</b></span>
        {me.createdAt && <span>Conta criada em {new Date(me.createdAt).toLocaleDateString("pt-BR")}</span>}
      </div>

      <div className="cfg-actions">
        <button type="button" className="ghost-btn" disabled={!mudou || salvando}
          onClick={() => { setForm({ nome: me.nome, email: me.email, cargo: me.cargo ?? "", empresa: me.empresa ?? "" }); setAvatar(me.avatar ?? null); }}>
          Descartar
        </button>
        <button className="primary-btn" disabled={!mudou || salvando}>{salvando ? "Salvando…" : "Salvar alterações"}</button>
      </div>
    </form>
  );
}

function SenhaTab({ onDone, onError }: { onDone: (encerradas: number) => void; onError: (m: string) => void }) {
  const [f, setF] = useState({ atual: "", nova: "", confirmar: "" });
  const [ver, setVer] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const forca = forcaSenha(f.nova);
  const rotulo = ["Muito fraca", "Fraca", "Razoável", "Boa", "Forte"][forca];

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!f.atual) return onError("Informe a senha atual.");
    if (f.nova.length < 6) return onError("A nova senha precisa ter pelo menos 6 caracteres.");
    if (f.nova !== f.confirmar) return onError("A confirmação não confere com a nova senha.");
    setSalvando(true);
    try {
      const r = await call<{ sessoesEncerradas?: number }>("/users/profile/password", {
        method: "PATCH", body: JSON.stringify({ senhaAtual: f.atual, novaSenha: f.nova }),
      });
      setF({ atual: "", nova: "", confirmar: "" });
      onDone(r?.sessoesEncerradas ?? 0);
    } catch (err: any) {
      onError(err.message);
    } finally {
      setSalvando(false);
    }
  }

  const tipo = ver ? "text" : "password";
  return (
    <form className="panel cfg-card" onSubmit={salvar}>
      <h3>Alterar senha</h3>
      <p>Ao trocar a senha, os outros aparelhos conectados são desconectados por segurança.</p>
      <div className="cfg-narrow">
        <label>Senha atual<input type={tipo} autoComplete="current-password" value={f.atual} onChange={(e) => setF({ ...f, atual: e.target.value })} /></label>
        <label>Nova senha<input type={tipo} autoComplete="new-password" value={f.nova} onChange={(e) => setF({ ...f, nova: e.target.value })} /></label>
        {f.nova && (
          <div className="strength">
            <div className="strength-bar">{[0, 1, 2, 3].map((i) => <i key={i} className={i < forca ? `on s${forca}` : ""} />)}</div>
            <small>{rotulo}. Use 8+ caracteres, misturando letras maiúsculas, números e símbolos.</small>
          </div>
        )}
        <label>Confirmar nova senha<input type={tipo} autoComplete="new-password" value={f.confirmar} onChange={(e) => setF({ ...f, confirmar: e.target.value })} /></label>
        {f.confirmar && f.confirmar !== f.nova && <small className="field-error">As senhas não conferem.</small>}
        <label className="check-row"><input type="checkbox" checked={ver} onChange={(e) => setVer(e.target.checked)} /> Mostrar senhas</label>
      </div>
      <div className="cfg-actions">
        <button className="primary-btn" disabled={salvando}>{salvando ? "Alterando…" : "Alterar senha"}</button>
      </div>
    </form>
  );
}

function SessoesTab({ onInfo, onError }: { onInfo: (m: string) => void; onError: (m: string) => void }) {
  const [lista, setLista] = useState<Sessao[] | null>(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro("");
    try { setLista(await call<Sessao[]>("/users/profile/sessions")); }
    catch (e: any) {
      setErro(e.message.includes("404") || e.message.includes("Cannot GET")
        ? "A API ainda não tem o controle de sessões. Atualize a API no Render."
        : e.message);
    }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  async function encerrar(id: string) {
    setOcupado(id);
    try {
      await call(`/users/profile/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      setLista((l) => (l || []).filter((s) => s.id !== id));
      onInfo("Sessão encerrada. Aquele aparelho vai precisar entrar de novo.");
    } catch (e: any) { onError(e.message); } finally { setOcupado(null); }
  }

  async function encerrarOutras() {
    if (!confirm("Desconectar todos os outros aparelhos? Você continua conectado aqui.")) return;
    setOcupado("todas");
    try {
      const r = await call<{ message: string }>("/users/profile/sessions/revoke-others", { method: "POST", body: "{}" });
      setLista((l) => (l || []).filter((s) => s.atual));
      onInfo(r.message);
    } catch (e: any) { onError(e.message); } finally { setOcupado(null); }
  }

  async function sairDaqui() {
    try { await api.logout(); } finally { window.location.href = "/login"; }
  }

  const outras = (lista || []).filter((s) => !s.atual).length;
  return (
    <section className="panel cfg-card">
      <div className="cfg-card-head">
        <div>
          <h3>Sessões abertas</h3>
          <p>Navegadores e celulares onde sua conta está conectada.</p>
        </div>
        {outras > 0 && (
          <button className="ghost-btn danger-text" onClick={encerrarOutras} disabled={ocupado === "todas"}>
            <LogOut size={14} /> Encerrar as outras ({outras})
          </button>
        )}
      </div>

      {erro ? (
        <div className="settings-error inline"><span>{erro}</span><button className="ghost-btn" onClick={carregar}>Tentar de novo</button></div>
      ) : !lista ? (
        <p className="muted-line">Carregando…</p>
      ) : (
        <ul className="session-list">
          {lista.map((s) => {
            const d = descreverDispositivo(s.dispositivo);
            const Icon = d.movel ? Smartphone : Laptop;
            return (
              <li key={s.id} className={s.atual ? "current" : ""}>
                <span className="session-icon"><Icon size={18} /></span>
                <div>
                  <b>{d.texto}{s.atual && <em className="you-tag">esta sessão</em>}</b>
                  <small>
                    {s.atual ? "Ativa agora" : `Último uso ${quando(s.ultimoUso)}`}
                    {s.ip ? ` · IP ${s.ip}` : ""} · entrou em {new Date(s.criadaEm).toLocaleDateString("pt-BR")}
                  </small>
                </div>
                {s.atual
                  ? <button className="ghost-btn" onClick={sairDaqui}>Sair</button>
                  : <button className="ghost-btn danger-text" disabled={ocupado === s.id} onClick={() => encerrar(s.id)}><X size={14} /> Encerrar</button>}
              </li>
            );
          })}
          {lista.length === 0 && <li className="muted-line">Nenhuma sessão registrada ainda.</li>}
        </ul>
      )}
    </section>
  );
}

function PermissoesTab({ perfil, onGoUsers }: { perfil: Perfil; onGoUsers?: () => void }) {
  const ordem: Perfil[] = ["ADMIN", "OPERADOR", "VISUALIZADOR"];
  return (
    <section className="panel cfg-card">
      <div className="cfg-card-head">
        <div>
          <h3>Permissões</h3>
          <p>Seu perfil é <b>{PERFIL_INFO[perfil]?.nome ?? perfil}</b>: {PERFIL_INFO[perfil]?.desc}</p>
        </div>
        {perfil === "ADMIN" && onGoUsers && <button className="primary-btn" onClick={onGoUsers}>Gerenciar usuários</button>}
      </div>
      <div className="table-scroll">
        <table className="perm-table">
          <thead>
            <tr><th>O que pode fazer</th>{ordem.map((p) => <th key={p} className={p === perfil ? "mine" : ""}>{PERFIL_INFO[p].nome}</th>)}</tr>
          </thead>
          <tbody>
            {PERMISSOES.map((g) => [
              <tr key={g.area} className="perm-group"><td colSpan={4}>{g.area}</td></tr>,
              ...g.itens.map(([txt, quem]) => (
                <tr key={txt}>
                  <td>{txt}</td>
                  {ordem.map((p) => (
                    <td key={p} className={p === perfil ? "mine" : ""}>
                      {quem.includes(p) ? <Check size={16} className="perm-yes" /> : <span className="perm-no">—</span>}
                    </td>
                  ))}
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
      {perfil !== "ADMIN" && <p className="muted-line">Precisa de mais acesso? Peça a um administrador para mudar seu perfil.</p>}
    </section>
  );
}

function PreferenciasTab({ onSaved }: { onSaved: () => void }) {
  const [p, setP] = useState<Prefs>(PREFS_PADRAO);
  useEffect(() => setP(lerPrefs()), []);

  function salvar(e: FormEvent) {
    e.preventDefault();
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
    window.dispatchEvent(new Event("indusense:prefs"));
    onSaved();
  }

  async function pedirNotificacao(v: boolean) {
    if (v && typeof Notification !== "undefined" && Notification.permission === "default") {
      await Notification.requestPermission().catch(() => undefined);
    }
    setP({ ...p, notificacoes: v });
  }

  return (
    <form className="panel cfg-card" onSubmit={salvar}>
      <h3>Preferências</h3>
      <p>Valem para este navegador.</p>
      <div className="cfg-narrow">
        <label>Unidade de temperatura
          <select value={p.unidade} onChange={(e) => setP({ ...p, unidade: e.target.value as "C" | "F" })}>
            <option value="C">Celsius (°C)</option><option value="F">Fahrenheit (°F)</option>
          </select>
        </label>
        <label>Atualizar os dados a cada
          <select value={p.intervalo} onChange={(e) => setP({ ...p, intervalo: Number(e.target.value) })}>
            <option value={5}>5 segundos</option><option value={10}>10 segundos</option><option value={30}>30 segundos</option><option value={60}>1 minuto</option>
          </select>
        </label>
        <label className="toggle-row">Notificações do navegador para alertas críticos
          <input type="checkbox" checked={p.notificacoes} onChange={(e) => pedirNotificacao(e.target.checked)} />
        </label>
        <label className="toggle-row">Som ao chegar ocorrência de EPI
          <input type="checkbox" checked={p.som} onChange={(e) => setP({ ...p, som: e.target.checked })} />
        </label>
      </div>
      <div className="cfg-actions"><button className="primary-btn">Salvar preferências</button></div>
    </form>
  );
}
