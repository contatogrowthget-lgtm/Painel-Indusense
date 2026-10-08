"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  AirVent, Check, ChevronRight, Copy, Cpu, MoreHorizontal, Nfc, Pencil, Plus, Power, RefreshCw, Search,
  ShieldAlert, Thermometer, Trash2, Waves, WifiOff, X,
} from "lucide-react";
import { api } from "../../lib/api";

/**
 * Monitoramento por sala, ligado à InduSense API:
 *   GET /salas, GET /sensors           -> cartões com leituras ao vivo
 *   POST /salas + POST /sensors        -> "Adicionar sala" já com os sensores
 *   PATCH /salas/:id, DELETE /salas/:id -> editar, ativar/desativar, excluir
 * Depois de criar, mostra como ligar o ESP32 (POST /readings com x-api-key).
 */

type Tipo = "temperatura" | "umidade" | "qualidade_ar" | "gas";
type Sala = {
  id: string; codigo: string; nome: string; setor: string; localizacao?: string | null;
  nfcTagId?: string | null; dispositivoModelo?: string | null; ativo: boolean;
};
type Sensor = {
  id: string; codigo?: string | null; nome: string; tipo: Tipo | string; salaId: string;
  limiteMin: number; limiteMax: number; valorAtual: number; status: string;
  ultimaLeitura?: string | null; online?: boolean; ativo: boolean; unidade?: string;
};

const TIPOS: { tipo: Tipo; label: string; unidade: string; icon: any; min: number; max: number; prefixo: string }[] = [
  { tipo: "temperatura", label: "Temperatura", unidade: "°C", icon: Thermometer, min: 15, max: 30, prefixo: "TEMP" },
  { tipo: "umidade", label: "Umidade", unidade: "%", icon: Waves, min: 30, max: 70, prefixo: "UMID" },
  { tipo: "qualidade_ar", label: "Qualidade do ar", unidade: "AQI", icon: AirVent, min: 0, max: 100, prefixo: "AR" },
  { tipo: "gas", label: "Gases", unidade: "ppm", icon: ShieldAlert, min: 0, max: 50, prefixo: "GAS" },
];
const infoTipo = (t: string) => TIPOS.find((x) => x.tipo === t);

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
    if (res.status === 403) throw new Error("Só administradores podem cadastrar ou alterar salas.");
    const msg = body?.message;
    throw new Error(Array.isArray(msg) ? msg[0] : msg || `Erro ${res.status}`);
  }
  return (body?.data ?? body) as T;
}

function intervaloPreferido() {
  try { return Math.max(5, Number(JSON.parse(localStorage.getItem("indusense_prefs") || "{}").intervalo) || 10); } catch { return 10; }
}

function quando(iso?: string | null) {
  if (!iso) return "sem leitura";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  if (min < 1440) return `há ${Math.round(min / 60)} h`;
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)).replace(".", ",");

type Estado = "normal" | "atencao" | "critico" | "offline" | "sem_sensores" | "inativa";
const ESTADO: Record<Estado, { label: string; cls: string }> = {
  normal: { label: "Normal", cls: "success" },
  atencao: { label: "Atenção", cls: "warning" },
  critico: { label: "Crítico", cls: "critical" },
  offline: { label: "Offline", cls: "offline" },
  sem_sensores: { label: "Sem sensores", cls: "offline" },
  inativa: { label: "Desativada", cls: "offline" },
};

function estadoSala(sala: Sala, sensores: Sensor[]): Estado {
  if (!sala.ativo) return "inativa";
  if (!sensores.length) return "sem_sensores";
  const on = sensores.filter((s) => s.online !== false && s.status !== "offline");
  if (!on.length) return "offline";
  if (on.some((s) => s.status === "critico")) return "critico";
  if (on.some((s) => s.status === "atencao")) return "atencao";
  return "normal";
}

// ---------------------------------------------------------------- tela

export default function MonitoringPage() {
  const router = useRouter();
  const admin = useMemo(() => {
    try { return JSON.parse(localStorage.getItem("indusense_user") || "{}").perfil === "ADMIN"; } catch { return false; }
  }, []);

  const [salas, setSalas] = useState<Sala[] | null>(null);
  const [sensores, setSensores] = useState<Sensor[]>([]);
  const [erro, setErro] = useState("");
  const [atualizado, setAtualizado] = useState<Date | null>(null);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"todas" | Estado>("todas");
  const [modal, setModal] = useState<{ modo: "nova" } | { modo: "editar"; sala: Sala } | null>(null);
  const [conexao, setConexao] = useState<{ sala: Sala; sensores: Sensor[] } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  const carregar = useCallback(async (silencioso = false) => {
    try {
      const [ss, sn] = await Promise.all([call<Sala[]>("/salas"), call<Sensor[]>("/sensors")]);
      setSalas(ss);
      setSensores(sn);
      setErro("");
      setAtualizado(new Date());
    } catch (e: any) {
      if (!silencioso || !salas) setErro(e.message);
    }
  }, [salas]);

  const carregarRef = useRef(carregar);
  carregarRef.current = carregar;

  useEffect(() => {
    carregarRef.current();
    const t = setInterval(() => carregarRef.current(true), intervaloPreferido() * 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const fechar = () => setMenu(null);
    window.addEventListener("click", fechar);
    return () => window.removeEventListener("click", fechar);
  }, []);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 3800);
    return () => clearTimeout(t);
  }, [aviso]);

  const porSala = useMemo(() => {
    const m = new Map<string, Sensor[]>();
    sensores.filter((s) => s.ativo !== false).forEach((s) => m.set(s.salaId, [...(m.get(s.salaId) || []), s]));
    return m;
  }, [sensores]);

  const linhas = useMemo(() => (salas || []).map((sala) => {
    const ss = porSala.get(sala.id) || [];
    return { sala, sensores: ss, estado: estadoSala(sala, ss) };
  }), [salas, porSala]);

  const contagem = useMemo(() => {
    const c: Record<string, number> = { todas: linhas.length };
    linhas.forEach((l) => { c[l.estado] = (c[l.estado] || 0) + 1; });
    return c;
  }, [linhas]);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const peso: Record<Estado, number> = { critico: 0, atencao: 1, offline: 2, normal: 3, sem_sensores: 4, inativa: 5 };
    return linhas
      .filter((l) => filtro === "todas" || l.estado === filtro)
      .filter((l) => !q || [l.sala.nome, l.sala.codigo, l.sala.setor, l.sala.localizacao].some((v) => (v || "").toLowerCase().includes(q)))
      .sort((a, b) => peso[a.estado] - peso[b.estado] || a.sala.nome.localeCompare(b.sala.nome));
  }, [linhas, busca, filtro]);

  async function alternarAtiva(sala: Sala) {
    try {
      const r = await call<Sala>(`/salas/${sala.id}`, { method: "PATCH", body: JSON.stringify({ ativo: !sala.ativo }) });
      setSalas((l) => (l || []).map((s) => (s.id === sala.id ? { ...s, ...r } : s)));
      setAviso({ tipo: "ok", texto: r.ativo ? `${sala.nome} reativada.` : `${sala.nome} desativada.` });
    } catch (e: any) { setAviso({ tipo: "erro", texto: e.message }); }
  }

  async function excluir(sala: Sala) {
    const n = (porSala.get(sala.id) || []).length;
    if (!confirm(`Excluir "${sala.nome}" (${sala.codigo})?${n ? ` Os ${n} sensores e todo o histórico de leituras dela também serão apagados.` : ""}\n\nEssa ação não pode ser desfeita.`)) return;
    try {
      await call(`/salas/${sala.id}`, { method: "DELETE" });
      setSalas((l) => (l || []).filter((s) => s.id !== sala.id));
      setSensores((l) => l.filter((s) => s.salaId !== sala.id));
      setAviso({ tipo: "ok", texto: `${sala.nome} excluída.` });
    } catch (e: any) { setAviso({ tipo: "erro", texto: e.message }); }
  }

  const abas: { id: "todas" | Estado; label: string }[] = [
    { id: "todas", label: "Todas" }, { id: "critico", label: "Crítico" }, { id: "atencao", label: "Atenção" },
    { id: "normal", label: "Normal" }, { id: "offline", label: "Offline" }, { id: "sem_sensores", label: "Sem sensores" },
  ];

  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <span className="eyebrow dark">SALAS</span>
          <h1>Monitoramento em tempo real</h1>
          <p>
            {salas ? `${salas.length} sala${salas.length === 1 ? "" : "s"} · ${sensores.length} sensores` : "Carregando salas…"}
            {atualizado && ` · atualizado às ${atualizado.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`}
          </p>
        </div>
        <div className="heading-actions">
          <button className="ghost-btn" onClick={() => carregar()} title="Atualizar agora"><RefreshCw size={15} /></button>
          {admin && <button className="primary-btn" onClick={() => setModal({ modo: "nova" })}><Plus size={17} /> Adicionar sala</button>}
        </div>
      </div>

      <div className="mon-toolbar">
        <label className="search-box">
          <Search size={15} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, código ou setor" />
        </label>
        <div className="mon-tabs">
          {abas.filter((a) => a.id === "todas" || contagem[a.id]).map((a) => (
            <button key={a.id} className={filtro === a.id ? "selected" : ""} onClick={() => setFiltro(a.id)}>
              {a.label} <em>{contagem[a.id] || 0}</em>
            </button>
          ))}
        </div>
      </div>

      {erro && !salas ? (
        <section className="panel settings-error">
          <b>Não foi possível carregar as salas</b><span>{erro}</span>
          <button className="ghost-btn" onClick={() => carregar()}>Tentar de novo</button>
        </section>
      ) : !salas ? (
        <section className="panel settings-error"><span>Carregando…</span></section>
      ) : salas.length === 0 ? (
        <section className="panel mon-empty">
          <span className="mon-empty-icon"><Cpu size={26} /></span>
          <b>Nenhuma sala cadastrada</b>
          <span>Cadastre uma sala com os sensores dela. Depois é só ligar o ESP32 e as leituras aparecem aqui.</span>
          {admin && <button className="primary-btn" onClick={() => setModal({ modo: "nova" })}><Plus size={17} /> Adicionar a primeira sala</button>}
        </section>
      ) : visiveis.length === 0 ? (
        <section className="panel settings-error"><span>Nenhuma sala encontrada com esse filtro.</span></section>
      ) : (
        <div className="monitor-grid">
          {visiveis.map(({ sala, sensores: ss, estado }) => {
            const ultima = ss.map((s) => s.ultimaLeitura).filter(Boolean).sort().pop();
            const online = ss.filter((s) => s.online !== false && s.status !== "offline").length;
            return (
              <article className={`device-card mon-card est-${estado}`} key={sala.id}>
                <div className="device-card-head">
                  <div>
                    <span className={`device-dot ${estado === "offline" || estado === "inativa" || estado === "sem_sensores" ? "offline" : "online"}`} />
                    <b>{sala.nome}</b>
                    <small>{sala.codigo}{sala.dispositivoModelo ? ` · ${sala.dispositivoModelo}` : ""}</small>
                  </div>
                  <div className="mon-head-right">
                    <span className={`status-badge ${ESTADO[estado].cls}`}><i /> {ESTADO[estado].label}</span>
                    {admin && (
                      <div className="mon-menu-wrap">
                        <button className="more-btn" aria-label="Ações" onClick={(e) => { e.stopPropagation(); setMenu(menu === sala.id ? null : sala.id); }}><MoreHorizontal /></button>
                        {menu === sala.id && (
                          <div className="user-menu" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => { setMenu(null); setModal({ modo: "editar", sala }); }}><Pencil size={14} /> Editar sala</button>
                            <button onClick={() => { setMenu(null); setConexao({ sala, sensores: ss }); }}><Cpu size={14} /> Conectar dispositivo</button>
                            <button onClick={() => { setMenu(null); alternarAtiva(sala); }}><Power size={14} /> {sala.ativo ? "Desativar" : "Reativar"}</button>
                            <button className="danger" onClick={() => { setMenu(null); excluir(sala); }}><Trash2 size={14} /> Excluir</button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <p className="location">{[sala.setor, sala.localizacao && sala.localizacao !== sala.setor ? sala.localizacao : null].filter(Boolean).join(" • ") || "Sem localização"}</p>

                {ss.length === 0 ? (
                  <div className="mon-nosensor">
                    <WifiOff size={18} />
                    <div><b>Nenhum sensor nesta sala</b><span>{admin ? "Edite a sala para adicionar sensores." : "Peça a um administrador para cadastrar."}</span></div>
                  </div>
                ) : (
                  <div className="sensor-values">
                    {TIPOS.map((t) => {
                      const lista = ss.filter((s) => s.tipo === t.tipo);
                      if (!lista.length) return <div key={t.tipo} className="sv-empty"><t.icon /><span>{t.label}</span><b>—</b></div>;
                      const ativos = lista.filter((s) => s.online !== false && s.status !== "offline");
                      const valor = ativos.length ? ativos.reduce((a, s) => a + s.valorAtual, 0) / ativos.length : null;
                      const pior = ativos.some((s) => s.status === "critico") ? "critico" : ativos.some((s) => s.status === "atencao") ? "atencao" : ativos.length ? "normal" : "offline";
                      return (
                        <div key={t.tipo} className={`sv-${pior}`} title={`Limites: ${lista[0].limiteMin}–${lista[0].limiteMax} ${t.unidade}`}>
                          <t.icon /><span>{t.label}</span>
                          <b>{valor === null ? "offline" : `${fmt(valor)} ${t.unidade}`}</b>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="device-card-foot">
                  <small>{ss.length ? `${online}/${ss.length} sensores online · última leitura ${quando(ultima)}` : "Aguardando sensores"}</small>
                  <button className="text-button" onClick={() => router.push(`/dashboard/monitoramento/${sala.codigo}`)}>Ver detalhes <ChevronRight size={12} /></button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {modal && (
        <SalaModal
          modo={modal.modo}
          sala={modal.modo === "editar" ? modal.sala : undefined}
          sensoresAtuais={modal.modo === "editar" ? porSala.get(modal.sala.id) || [] : []}
          onClose={() => setModal(null)}
          onSaved={(sala, novos, criada) => {
            setModal(null);
            setSalas((l) => {
              const lista = l || [];
              return lista.some((s) => s.id === sala.id) ? lista.map((s) => (s.id === sala.id ? { ...s, ...sala } : s)) : [...lista, sala];
            });
            if (novos.length) setSensores((l) => [...l, ...novos]);
            setAviso({ tipo: "ok", texto: criada ? `${sala.nome} cadastrada.` : "Sala atualizada." });
            if (criada) setConexao({ sala, sensores: [...(porSala.get(sala.id) || []), ...novos] });
            carregar(true);
          }}
        />
      )}

      {conexao && <ConexaoModal sala={conexao.sala} sensores={conexao.sensores} onClose={() => setConexao(null)} />}

      {aviso && <div className={`users-toast ${aviso.tipo === "erro" ? "toast-error" : ""}`}>{aviso.texto}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- cadastro / edição

type SensorForm = { ativo: boolean; min: string; max: string; codigo: string };

function SalaModal({
  modo, sala, sensoresAtuais, onClose, onSaved,
}: {
  modo: "nova" | "editar";
  sala?: Sala;
  sensoresAtuais: Sensor[];
  onClose: () => void;
  onSaved: (sala: Sala, novosSensores: Sensor[], criada: boolean) => void;
}) {
  const [f, setF] = useState({
    nome: sala?.nome ?? "", setor: sala?.setor ?? "", localizacao: sala?.localizacao ?? "",
    codigo: sala?.codigo ?? "", nfcTagId: sala?.nfcTagId ?? "", dispositivoModelo: sala?.dispositivoModelo ?? "ESP32 DevKit",
  });
  const existentes = new Set(sensoresAtuais.map((s) => s.tipo));
  const [sens, setSens] = useState<Record<Tipo, SensorForm>>(() =>
    Object.fromEntries(TIPOS.map((t) => [t.tipo, { ativo: modo === "nova", min: String(t.min), max: String(t.max), codigo: "" }])) as Record<Tipo, SensorForm>,
  );
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [avancado, setAvancado] = useState(false);

  const paraCriar = TIPOS.filter((t) => sens[t.tipo].ativo && !existentes.has(t.tipo));

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro("");
    if (!f.nome.trim()) return setErro("Informe o nome da sala.");
    for (const t of paraCriar) {
      const mn = Number(sens[t.tipo].min.replace(",", ".")), mx = Number(sens[t.tipo].max.replace(",", "."));
      if (!Number.isFinite(mn) || !Number.isFinite(mx)) return setErro(`Limites de ${t.label.toLowerCase()} inválidos.`);
      if (mn >= mx) return setErro(`Em ${t.label.toLowerCase()}, o mínimo precisa ser menor que o máximo.`);
    }

    setSalvando(true);
    try {
      const corpo: Record<string, string> = { nome: f.nome.trim(), dispositivoModelo: f.dispositivoModelo.trim() || "ESP32 DevKit" };
      if (f.setor.trim()) corpo.setor = f.setor.trim();
      corpo.localizacao = f.localizacao.trim();
      if (modo === "nova") {
        if (f.codigo.trim()) corpo.codigo = f.codigo.trim().toUpperCase();
        if (f.nfcTagId.trim()) corpo.nfcTagId = f.nfcTagId.trim();
      } else if (f.nfcTagId.trim() && f.nfcTagId.trim() !== sala?.nfcTagId) {
        corpo.nfcTagId = f.nfcTagId.trim();
      }

      const salva = modo === "nova"
        ? await call<Sala>("/salas", { method: "POST", body: JSON.stringify(corpo) })
        : await call<Sala>(`/salas/${sala!.id}`, { method: "PATCH", body: JSON.stringify(corpo) });

      const novos: Sensor[] = [];
      const falhas: string[] = [];
      for (const t of paraCriar) {
        const s = sens[t.tipo];
        try {
          novos.push(await call<Sensor>("/sensors", {
            method: "POST",
            body: JSON.stringify({
              nome: `${t.label} · ${salva.nome}`,
              tipo: t.tipo,
              salaId: salva.id,
              limiteMin: Number(s.min.replace(",", ".")),
              limiteMax: Number(s.max.replace(",", ".")),
              codigo: (s.codigo.trim() || `${t.prefixo}-${salva.codigo}`).toUpperCase(),
            }),
          }));
        } catch (err: any) {
          falhas.push(`${t.label}: ${err.message}`);
        }
      }
      if (falhas.length) {
        setErro(`A sala foi salva, mas alguns sensores falharam:\n${falhas.join("\n")}`);
        setSalvando(false);
        return;
      }
      onSaved(salva, novos, modo === "nova");
    } catch (err: any) {
      setErro(err.message);
      setSalvando(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !salvando && onClose()}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>{modo === "nova" ? "Nova sala" : `Editar ${sala?.nome}`}</h2>
            <p>{modo === "nova" ? "Cadastre o ambiente e os sensores que o dispositivo vai enviar." : "Altere os dados da sala ou adicione sensores."}</p>
          </div>
          <button className="more-btn" onClick={onClose} aria-label="Fechar"><X /></button>
        </div>
        <form onSubmit={salvar}>
          <div className="form-row">
            <label>Nome da sala<input autoFocus value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Ex.: Linha de Produção B" /></label>
            <label>Setor<input value={f.setor} onChange={(e) => setF({ ...f, setor: e.target.value })} placeholder="Ex.: Produção" /></label>
          </div>
          <label>Localização<input value={f.localizacao} onChange={(e) => setF({ ...f, localizacao: e.target.value })} placeholder="Ex.: Galpão 02 • Térreo" /></label>

          <button type="button" className="link-toggle" onClick={() => setAvancado(!avancado)}>
            {avancado ? "Ocultar" : "Mostrar"} opções avançadas (código, tag NFC, modelo)
          </button>
          {avancado && (
            <div className="form-row three">
              <label>Código<input value={f.codigo} disabled={modo === "editar"} onChange={(e) => setF({ ...f, codigo: e.target.value })} placeholder="Automático (IND-00X)" /></label>
              <label>Tag NFC<input value={f.nfcTagId} onChange={(e) => setF({ ...f, nfcTagId: e.target.value })} placeholder="Automático (NFC-código)" /></label>
              <label>Dispositivo<input value={f.dispositivoModelo} onChange={(e) => setF({ ...f, dispositivoModelo: e.target.value })} /></label>
            </div>
          )}

          <div className="sensor-picker">
            <div className="sensor-picker-head"><b>Sensores da sala</b><small>Limites fora da faixa geram alerta.</small></div>
            {TIPOS.map((t) => {
              const ja = existentes.has(t.tipo);
              const s = sens[t.tipo];
              return (
                <div key={t.tipo} className={`sp-row ${s.ativo || ja ? "on" : ""}`}>
                  <label className="sp-check">
                    <input type="checkbox" checked={ja || s.ativo} disabled={ja} onChange={(e) => setSens({ ...sens, [t.tipo]: { ...s, ativo: e.target.checked } })} />
                    <t.icon size={16} /> <span>{t.label}</span>
                    {ja && <em className="you-tag">já cadastrado</em>}
                  </label>
                  {!ja && s.ativo && (
                    <div className="sp-limits">
                      <label>Mín.<input inputMode="decimal" value={s.min} onChange={(e) => setSens({ ...sens, [t.tipo]: { ...s, min: e.target.value } })} /></label>
                      <label>Máx.<input inputMode="decimal" value={s.max} onChange={(e) => setSens({ ...sens, [t.tipo]: { ...s, max: e.target.value } })} /></label>
                      <span className="sp-unit">{t.unidade}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {erro && <div className="error-box" style={{ marginTop: 14, whiteSpace: "pre-line" }}>{erro}</div>}
          <div className="modal-actions">
            <button type="button" className="ghost-btn" onClick={onClose} disabled={salvando}>Cancelar</button>
            <button className="primary-btn" disabled={salvando}>
              {salvando ? "Salvando…" : modo === "nova" ? `Cadastrar sala${paraCriar.length ? ` e ${paraCriar.length} sensor${paraCriar.length === 1 ? "" : "es"}` : ""}` : "Salvar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- como ligar o ESP32

function ConexaoModal({ sala, sensores, onClose }: { sala: Sala; sensores: Sensor[]; onClose: () => void }) {
  const [copiado, setCopiado] = useState("");
  const url = `${BASE}/readings`;
  const exemplo = sensores[0]?.codigo || `TEMP-${sala.codigo}`;

  const curl = `curl -X POST "${url}" \\\n  -H "Content-Type: application/json" \\\n  -H "x-api-key: SUA_DEVICE_API_KEY" \\\n  -d '{"sensorId":"${exemplo}","valor":24.5}'`;

  const arduino = `#include <WiFi.h>
#include <HTTPClient.h>

const char* WIFI_SSID = "SUA_REDE";
const char* WIFI_SENHA = "SENHA_DA_REDE";
const char* API = "${url}";
const char* API_KEY = "SUA_DEVICE_API_KEY";   // DEVICE_API_KEY do Render

void enviar(const char* sensor, float valor) {
  HTTPClient http;
  http.begin(API);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", API_KEY);
  String corpo = String("{\\"sensorId\\":\\"") + sensor + "\\",\\"valor\\":" + String(valor, 2) + "}";
  int code = http.POST(corpo);
  Serial.printf("%s = %.2f -> HTTP %d\\n", sensor, valor, code);
  http.end();
}

void setup() {
  Serial.begin(115200);
  WiFi.begin(WIFI_SSID, WIFI_SENHA);
  while (WiFi.status() != WL_CONNECTED) delay(500);
}

void loop() {
${(sensores.length ? sensores : TIPOS.map((t) => ({ codigo: `${t.prefixo}-${sala.codigo}`, tipo: t.tipo } as Sensor)))
  .map((s) => `  enviar("${s.codigo}", lerSensor_${s.tipo}());   // troque pela leitura real`).join("\n")}
  delay(30000);   // a cada 30 s
}`;

  function copiar(txt: string, qual: string) {
    navigator.clipboard?.writeText(txt);
    setCopiado(qual);
    setTimeout(() => setCopiado(""), 2000);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>Conectar dispositivo · {sala.nome}</h2>
            <p>O ESP32 envia cada leitura para a API. Assim que a primeira chegar, a sala fica online.</p>
          </div>
          <button className="more-btn" onClick={onClose} aria-label="Fechar"><X /></button>
        </div>

        <div className="conn-grid">
          <div><small>Código da sala</small><b>{sala.codigo}</b></div>
          <div><small><Nfc size={11} /> Tag NFC</small><b>{sala.nfcTagId || `NFC-${sala.codigo}`}</b></div>
          <div className="full"><small>Endereço para enviar as leituras (POST)</small><b className="mono">{url}</b></div>
        </div>

        <div className="conn-sensors">
          <small>Códigos dos sensores (use no campo <code>sensorId</code>)</small>
          {sensores.length ? sensores.map((s) => {
            const t = infoTipo(s.tipo);
            return (
              <div key={s.id}>
                <span>{t?.label ?? s.tipo}</span>
                <b className="mono">{s.codigo || s.id}</b>
                <em>{s.limiteMin}–{s.limiteMax} {t?.unidade}</em>
              </div>
            );
          }) : <p className="muted-line">Esta sala ainda não tem sensores. Edite a sala para adicionar.</p>}
        </div>

        <div className="code-block">
          <div className="code-head"><span>Teste rápido pelo Terminal</span><button type="button" onClick={() => copiar(curl, "curl")}>{copiado === "curl" ? <><Check size={13} /> Copiado</> : <><Copy size={13} /> Copiar</>}</button></div>
          <pre>{curl}</pre>
        </div>
        <div className="code-block">
          <div className="code-head"><span>Código para o ESP32 (Arduino)</span><button type="button" onClick={() => copiar(arduino, "ino")}>{copiado === "ino" ? <><Check size={13} /> Copiado</> : <><Copy size={13} /> Copiar</>}</button></div>
          <pre>{arduino}</pre>
        </div>
        <p className="muted-line">Troque <b>SUA_DEVICE_API_KEY</b> pela variável <b>DEVICE_API_KEY</b> do Render. Ela é a mesma usada pela câmera.</p>

        <div className="modal-actions"><button className="primary-btn" onClick={onClose}>Pronto</button></div>
      </div>
    </div>
  );
}
