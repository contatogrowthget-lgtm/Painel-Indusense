"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Copy, KeyRound, MoreHorizontal, Plus, RefreshCw, Search, Trash2, UserCheck, UserX, X } from "lucide-react";
import { api } from "../../lib/api";

/**
 * Tela de usuários ligada à InduSense API (rotas /users, só para ADMIN).
 * Lista, cadastra, edita perfil, ativa/desativa, redefine senha e exclui.
 */

type Perfil = "ADMIN" | "OPERADOR" | "VISUALIZADOR";

type ApiUser = {
  id: string;
  nome: string;
  email: string;
  cargo?: string | null;
  empresa?: string | null;
  perfil: Perfil;
  role?: string;
  ativo: boolean;
  ultimoAcesso?: string | null;
  createdAt?: string;
  senhaTemporaria?: string;
};

const PERFIS: { value: Perfil; label: string; desc: string }[] = [
  { value: "ADMIN", label: "Administrador", desc: "Acesso total, inclusive usuários" },
  { value: "OPERADOR", label: "Operador", desc: "Vê tudo e resolve alertas" },
  { value: "VISUALIZADOR", label: "Visualizador", desc: "Só visualiza" },
];
const perfilLabel = (p: string) => PERFIS.find((x) => x.value === p)?.label ?? p;

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
    throw new Error("Sem conexão com a API. Ela pode estar acordando (aguarde uns segundos e tente de novo).");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) throw new Error("Sessão expirada. Saia e entre de novo.");
    if (res.status === 403) throw new Error("Só administradores podem gerenciar usuários.");
    const msg = body?.message;
    throw new Error(Array.isArray(msg) ? msg[0] : msg || `Erro ${res.status}`);
  }
  return (body?.data ?? body) as T;
}

function quando(iso?: string | null) {
  if (!iso) return "Nunca";
  const d = new Date(iso);
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1) return "Agora";
  if (min < 60) return `Há ${min} min`;
  if (min < 1440) return `Há ${Math.round(min / 60)} h`;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function gerarSenha() {
  const c = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const a = new Uint32Array(10);
  crypto.getRandomValues(a);
  return Array.from(a, (n) => c[n % c.length]).join("");
}

const vazio = { nome: "", email: "", perfil: "OPERADOR" as Perfil, senha: "", cargo: "", empresa: "" };

export default function UsersPage() {
  const eu = useMemo(() => {
    try { return JSON.parse(localStorage.getItem("indusense_user") || "null"); } catch { return null; }
  }, []);

  const [users, setUsers] = useState<ApiUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [aviso, setAviso] = useState("");

  const [modal, setModal] = useState<"novo" | "editar" | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(vazio);
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState("");
  const [credencial, setCredencial] = useState<{ email: string; senha: string } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro("");
    try {
      setUsers(await call<ApiUser[]>("/users"));
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(""), 3500);
    return () => clearTimeout(t);
  }, [aviso]);

  useEffect(() => {
    const fechar = () => setMenu(null);
    window.addEventListener("click", fechar);
    return () => window.removeEventListener("click", fechar);
  }, []);

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return users
      .filter((u) => !q || u.nome.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
      .sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome));
  }, [users, busca]);

  function abrirNovo() {
    setForm({ ...vazio, senha: gerarSenha() });
    setEditId(null);
    setErroForm("");
    setModal("novo");
  }

  function abrirEditar(u: ApiUser) {
    setForm({ nome: u.nome, email: u.email, perfil: u.perfil, senha: "", cargo: u.cargo ?? "", empresa: u.empresa ?? "" });
    setEditId(u.id);
    setErroForm("");
    setModal("editar");
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErroForm("");
    if (!form.nome.trim()) return setErroForm("Informe o nome.");
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) return setErroForm("Informe um e-mail válido.");
    if (modal === "novo" && form.senha.length < 6) return setErroForm("A senha precisa ter pelo menos 6 caracteres.");
    if (modal === "editar" && form.senha && form.senha.length < 6) return setErroForm("A nova senha precisa ter pelo menos 6 caracteres.");

    const body: Record<string, string> = {
      nome: form.nome.trim(),
      email: form.email.trim().toLowerCase(),
      perfil: form.perfil,
    };
    if (form.cargo.trim()) body.cargo = form.cargo.trim();
    if (form.empresa.trim()) body.empresa = form.empresa.trim();
    if (form.senha) body.senha = form.senha;

    setSalvando(true);
    try {
      if (modal === "novo") {
        const criado = await call<ApiUser>("/users", { method: "POST", body: JSON.stringify(body) });
        setUsers((u) => [...u, criado]);
        setCredencial({ email: criado.email, senha: form.senha });
        setAviso(`${criado.nome} cadastrado.`);
      } else if (editId) {
        const atualizado = await call<ApiUser>(`/users/${editId}`, { method: "PATCH", body: JSON.stringify(body) });
        setUsers((u) => u.map((x) => (x.id === editId ? atualizado : x)));
        if (form.senha) setCredencial({ email: atualizado.email, senha: form.senha });
        setAviso("Usuário atualizado.");
      }
      setModal(null);
    } catch (e: any) {
      setErroForm(e.message);
    } finally {
      setSalvando(false);
    }
  }

  async function alternarAtivo(u: ApiUser) {
    try {
      const r = await call<ApiUser>(`/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ ativo: !u.ativo }) });
      setUsers((l) => l.map((x) => (x.id === u.id ? r : x)));
      setAviso(r.ativo ? `${u.nome} reativado.` : `${u.nome} desativado. Ele não consegue mais entrar.`);
    } catch (e: any) {
      setAviso(e.message);
    }
  }

  async function redefinirSenha(u: ApiUser) {
    const senha = gerarSenha();
    try {
      await call<ApiUser>(`/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ senha }) });
      setCredencial({ email: u.email, senha });
    } catch (e: any) {
      setAviso(e.message);
    }
  }

  async function excluir(u: ApiUser) {
    if (!confirm(`Excluir ${u.nome} (${u.email})? Essa ação não pode ser desfeita.`)) return;
    try {
      await call(`/users/${u.id}`, { method: "DELETE" });
      setUsers((l) => l.filter((x) => x.id !== u.id));
      setAviso(`${u.nome} excluído.`);
    } catch (e: any) {
      setAviso(e.message);
    }
  }

  const ativos = users.filter((u) => u.ativo).length;
  const admins = users.filter((u) => u.perfil === "ADMIN").length;

  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <span className="eyebrow dark">ACESSO</span>
          <h1>Usuários</h1>
          <p>
            {users.length
              ? `${users.length} usuário${users.length === 1 ? "" : "s"} · ${ativos} ativo${ativos === 1 ? "" : "s"} · ${admins} administrador${admins === 1 ? "" : "es"}`
              : "Gerencie quem acessa o painel e o aplicativo."}
          </p>
        </div>
        <div className="heading-actions">
          <button className="ghost-btn" onClick={carregar} title="Atualizar"><RefreshCw size={15} /></button>
          <button className="primary-btn" onClick={abrirNovo}><Plus size={17} /> Adicionar usuário</button>
        </div>
      </div>

      <section className="panel table-panel">
        <div className="table-toolbar">
          <label className="search-box">
            <Search size={15} />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou e-mail" />
          </label>
        </div>

        {loading ? (
          <p className="users-empty">Carregando usuários…</p>
        ) : erro ? (
          <div className="users-empty">
            <b>Não foi possível carregar os usuários</b>
            <span>{erro}</span>
            <button className="ghost-btn" onClick={carregar}>Tentar de novo</button>
          </div>
        ) : lista.length === 0 ? (
          <p className="users-empty">{busca ? "Nenhum usuário encontrado." : "Nenhum usuário cadastrado."}</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Usuário</th><th>E-mail</th><th>Perfil</th><th>Status</th><th>Último acesso</th><th></th></tr>
              </thead>
              <tbody>
                {lista.map((u) => {
                  const souEu = eu?.id === u.id;
                  return (
                    <tr key={u.id} className={u.ativo ? "" : "user-off"}>
                      <td>
                        <div className="person">
                          <span>{u.nome.split(" ").filter(Boolean).map((x) => x[0]).slice(0, 2).join("").toUpperCase()}</span>
                          <div>
                            <b>{u.nome}{souEu && <em className="you-tag">você</em>}</b>
                            {(u.cargo || u.empresa) && <small>{[u.cargo, u.empresa].filter(Boolean).join(" · ")}</small>}
                          </div>
                        </div>
                      </td>
                      <td>{u.email}</td>
                      <td><span className={`role-pill role-${u.perfil.toLowerCase()}`}>{perfilLabel(u.perfil)}</span></td>
                      <td>
                        <span className={`status-badge ${u.ativo ? "success" : "offline"}`}><i />{u.ativo ? "Ativo" : "Inativo"}</span>
                      </td>
                      <td>{quando(u.ultimoAcesso)}</td>
                      <td className="user-actions">
                        <button className="more-btn" onClick={(e) => { e.stopPropagation(); setMenu(menu === u.id ? null : u.id); }} aria-label="Ações">
                          <MoreHorizontal />
                        </button>
                        {menu === u.id && (
                          <div className="user-menu" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => { setMenu(null); abrirEditar(u); }}>Editar</button>
                            <button onClick={() => { setMenu(null); redefinirSenha(u); }}><KeyRound size={14} /> Gerar nova senha</button>
                            {!souEu && (
                              <button onClick={() => { setMenu(null); alternarAtivo(u); }}>
                                {u.ativo ? <><UserX size={14} /> Desativar</> : <><UserCheck size={14} /> Reativar</>}
                              </button>
                            )}
                            {!souEu && (
                              <button className="danger" onClick={() => { setMenu(null); excluir(u); }}><Trash2 size={14} /> Excluir</button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modal && (
        <div className="modal-backdrop" onClick={() => !salvando && setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h2>{modal === "novo" ? "Novo usuário" : "Editar usuário"}</h2>
                <p>{modal === "novo" ? "Ele poderá entrar no painel e no aplicativo." : "Deixe a senha em branco para manter a atual."}</p>
              </div>
              <button className="more-btn" onClick={() => setModal(null)} aria-label="Fechar"><X /></button>
            </div>
            <form onSubmit={salvar}>
              <label>Nome completo<input autoFocus value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex.: Maria Souza" /></label>
              <label>E-mail<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="usuario@empresa.com" /></label>
              <div className="form-row">
                <label>Cargo <small>(opcional)</small><input value={form.cargo} onChange={(e) => setForm({ ...form, cargo: e.target.value })} placeholder="Ex.: Técnico de segurança" /></label>
                <label>Empresa <small>(opcional)</small><input value={form.empresa} onChange={(e) => setForm({ ...form, empresa: e.target.value })} /></label>
              </div>
              <label>Perfil de acesso</label>
              <div className="role-options">
                {PERFIS.map((p) => (
                  <button type="button" key={p.value} className={form.perfil === p.value ? "selected" : ""} onClick={() => setForm({ ...form, perfil: p.value })}>
                    <b>{p.label}</b><small>{p.desc}</small>
                  </button>
                ))}
              </div>
              <label>
                {modal === "novo" ? "Senha inicial" : "Nova senha (opcional)"}
                <div className="password-row">
                  <input value={form.senha} onChange={(e) => setForm({ ...form, senha: e.target.value })} placeholder={modal === "novo" ? "Mínimo 6 caracteres" : "Em branco = não muda"} />
                  <button type="button" className="ghost-btn" onClick={() => setForm({ ...form, senha: gerarSenha() })}>Gerar</button>
                </div>
              </label>
              {erroForm && <div className="error-box" style={{ marginTop: 14 }}>{erroForm}</div>}
              <div className="modal-actions">
                <button type="button" className="ghost-btn" onClick={() => setModal(null)} disabled={salvando}>Cancelar</button>
                <button className="primary-btn" disabled={salvando}>{salvando ? "Salvando…" : modal === "novo" ? "Criar usuário" : "Salvar"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {credencial && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-head">
              <div>
                <h2>Acesso pronto</h2>
                <p>Envie estes dados para a pessoa. A senha não aparece de novo depois que você fechar.</p>
              </div>
            </div>
            <div className="cred-box">
              <div><small>E-mail</small><b>{credencial.email}</b></div>
              <div><small>Senha</small><b className="mono">{credencial.senha}</b></div>
            </div>
            <div className="modal-actions">
              <button
                className="ghost-btn"
                onClick={() => {
                  navigator.clipboard?.writeText(`Acesso InduSense\nE-mail: ${credencial.email}\nSenha: ${credencial.senha}`);
                  setAviso("Dados copiados.");
                }}
              >
                <Copy size={14} /> Copiar
              </button>
              <button className="primary-btn" onClick={() => setCredencial(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {aviso && <div className="users-toast">{aviso}</div>}
    </div>
  );
}
