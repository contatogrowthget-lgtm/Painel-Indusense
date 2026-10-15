"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, CloudDownload, Droplets, Flame, Plus, RefreshCw, Search, Thermometer, Trash2, Wind, X } from "lucide-react";
import { call } from "./alerts-shared";

/** Páginas de dados ligadas à API: Dispositivos (salas), Sensores e Histórico. */

type Sala = { id: string; codigo: string; nome: string; setor: string; localizacao?: string | null; dispositivoModelo?: string | null; ativo: boolean };
type Sensor = {
  id: string; codigo?: string | null; nome: string; tipo: string; salaId: string; salaCodigo?: string | null; salaNome?: string | null;
  unidade?: string; status: string; valorAtual: number; limiteMin: number; limiteMax: number; ultimaLeitura?: string; online?: boolean; ativo: boolean;
};
type Leitura = { id: string; sensorId: string; sensorNome?: string; sensorCodigo?: string | null; tipo: string; unidade?: string; valor: number; dataHora: string; status: string };

const TIPOS: Record<string, { nome: string; un: string; cor: string; icone: any }> = {
  temperatura: { nome: "Temperatura", un: "°C", cor: "#ff8a4c", icone: Thermometer },
  umidade: { nome: "Umidade", un: "%", cor: "#38bdf8", icone: Droplets },
  qualidade_ar: { nome: "Qualidade do ar", un: "índice", cor: "#2dd4bf", icone: Wind },
  gas: { nome: "Gases", un: "ppm", cor: "#fbbf24", icone: Flame },
};
const tipoInfo = (t: string) => TIPOS[t] ?? { nome: t, un: "", cor: "#94a3b8", icone: Thermometer };
const fmt = (v: number, d = 1) => v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: d });
const perfil = () => {
  try { return JSON.parse(localStorage.getItem("indusense_user") || "{}").perfil as string | undefined; } catch { return undefined; }
};
const quando = (iso?: string) => {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "agora";
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return new Date(iso).toLocaleDateString("pt-BR");
};

function Badge({ status, online = true }: { status: string; online?: boolean }) {
  const s = !online ? "offline" : status;
  const [cls, txt] = s === "critico" ? ["critical", "Crítico"] : s === "atencao" ? ["warning", "Atenção"] : s === "offline" ? ["offline", "Offline"] : ["success", "Normal"];
  return <span className={"status-badge " + cls}><i /> {txt}</span>;
}

function Aviso({ texto, tipo }: { texto: string; tipo: "ok" | "erro" }) {
  return <div className={"users-toast" + (tipo === "erro" ? " erro" : "")}>{texto}</div>;
}

/* ================================================================ SENSORES */
export function SensorsPage() {
  const [sensores, setSensores] = useState<Sensor[] | null>(null);
  const [salas, setSalas] = useState<Sala[]>([]);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [tipo, setTipo] = useState("todos");
  const [editar, setEditar] = useState<Sensor | null>(null);
  const [novo, setNovo] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; tipo: "ok" | "erro" } | null>(null);
  const p = useMemo(perfil, []);
  const podeEditar = p === "ADMIN" || p === "OPERADOR";
  const admin = p === "ADMIN";

  const carregar = useCallback(async () => {
    try {
      const [ss, sl] = await Promise.all([call<Sensor[]>("/sensors"), call<Sala[]>("/salas").catch(() => [] as Sala[])]);
      setSensores(ss.filter((s) => s.ativo !== false));
      setSalas(sl);
      setErro("");
    } catch (e: any) { setErro(e.message); }
  }, []);
  useEffect(() => { carregar(); const t = setInterval(carregar, 20_000); return () => clearInterval(t); }, [carregar]);
  useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), 3500); return () => clearTimeout(t); }, [aviso]);

  const lista = (sensores ?? []).filter((s) =>
    (tipo === "todos" || s.tipo === tipo) &&
    (!busca.trim() || [s.nome, s.codigo, s.salaNome, s.salaCodigo].some((v) => (v || "").toLowerCase().includes(busca.toLowerCase()))));

  async function salvar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editar) return;
    const f = new FormData(e.currentTarget);
    const limiteMin = Number(String(f.get("min")).replace(",", "."));
    const limiteMax = Number(String(f.get("max")).replace(",", "."));
    if (!Number.isFinite(limiteMin) || !Number.isFinite(limiteMax) || limiteMin > limiteMax) {
      setAviso({ texto: "Confira os limites: o mínimo precisa ser menor que o máximo.", tipo: "erro" });
      return;
    }
    try {
      await call(`/sensors/${editar.id}`, { method: "PATCH", body: JSON.stringify({ nome: String(f.get("nome") || editar.nome), limiteMin, limiteMax }) });
      setEditar(null);
      setAviso({ texto: "Limites salvos. Os alertas já usam os novos valores.", tipo: "ok" });
      carregar();
    } catch (er: any) { setAviso({ texto: er.message, tipo: "erro" }); }
  }

  async function criar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await call("/sensors", {
        method: "POST",
        body: JSON.stringify({
          nome: String(f.get("nome")), codigo: String(f.get("codigo") || "") || undefined, tipo: String(f.get("tipo")),
          salaId: String(f.get("sala")), limiteMin: Number(f.get("min")), limiteMax: Number(f.get("max")),
        }),
      });
      setNovo(false);
      setAviso({ texto: "Sensor cadastrado. Use o mesmo código no ESP32.", tipo: "ok" });
      carregar();
    } catch (er: any) { setAviso({ texto: er.message, tipo: "erro" }); }
  }

  async function desativar(s: Sensor) {
    if (!confirm(`Desativar ${s.codigo ?? s.nome}? Ele some do painel e do app.`)) return;
    try {
      await call(`/sensors/${s.id}`, { method: "PATCH", body: JSON.stringify({ ativo: false }) });
      setEditar(null);
      setAviso({ texto: "Sensor desativado.", tipo: "ok" });
      carregar();
    } catch (er: any) { setAviso({ texto: er.message, tipo: "erro" }); }
  }

  return (
    <div className="page-content">
      <div className="page-heading">
        <div><span className="eyebrow dark">SENSORES</span><h1>Gerenciamento de sensores</h1><p>{sensores ? `${sensores.length} sensores ativos · ${sensores.filter((s) => s.online).length} enviando dados agora` : "Carregando…"}</p></div>
        <div className="heading-actions">
          <button className="ghost-btn" onClick={carregar} title="Atualizar"><RefreshCw size={15} /></button>
          {admin && <button className="primary-btn" onClick={() => setNovo(true)}><Plus size={17} /> Adicionar sensor</button>}
        </div>
      </div>

      <div className="dp-toolbar">
        <label className="search-box"><Search size={16} /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por código, nome ou sala" /></label>
        <div className="filter-tabs dp-tabs">
          {["todos", ...Object.keys(TIPOS)].map((t) => (
            <button key={t} className={tipo === t ? "selected" : ""} onClick={() => setTipo(t)}>{t === "todos" ? "Todos" : TIPOS[t].nome}</button>
          ))}
        </div>
      </div>

      {erro && !sensores && <div className="error-box">{erro}</div>}
      {sensores && lista.length === 0 && <div className="panel dp-empty">Nenhum sensor encontrado.</div>}

      <div className="sensor-grid">
        {lista.map((s, i) => {
          const T = tipoInfo(s.tipo);
          const I = T.icone;
          const faixa = s.limiteMax - s.limiteMin || 1;
          const pos = Math.max(0, Math.min(100, ((s.valorAtual - s.limiteMin) / faixa) * 100));
          const ar = s.tipo === "qualidade_ar";
          return (
            <div className="panel sensor-card" key={s.id} style={{ animationDelay: `${i * 50}ms`, ["--c" as any]: T.cor }}>
              <div className="sensor-card-top">
                <span className="sensor-symbol dp-sym"><I size={18} /></span>
                <Badge status={s.status} online={s.online !== false} />
              </div>
              <small>{s.codigo ?? "sem código"} • {s.salaCodigo ?? "—"} · {s.salaNome ?? ""}</small>
              <h3>{T.nome}</h3>
              <div className="big-sensor">
                {s.online === false ? "—" : ar ? (s.valorAtual <= s.limiteMax ? "Boa" : s.valorAtual <= s.limiteMax * 1.15 ? "Moderada" : "Ruim") : fmt(s.valorAtual)}
                <small>{s.online === false ? "sem sinal" : ar ? ` · ${fmt(s.valorAtual, 0)}` : ` ${T.un}`}</small>
              </div>
              <div className="dp-range"><span style={{ left: `${pos}%` }} /></div>
              <div className="limits"><span>Mínimo <b>{fmt(s.limiteMin)} {T.un}</b></span><span>Última leitura <b>{quando(s.ultimaLeitura)}</b></span><span>Máximo <b>{fmt(s.limiteMax)} {T.un}</b></span></div>
              <button className="ghost-btn full" onClick={() => setEditar(s)} disabled={!podeEditar} title={podeEditar ? "" : "Só operador ou administrador"}>Configurar parâmetros</button>
            </div>
          );
        })}
      </div>

      {editar && (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && setEditar(null)}>
          <div className="modal">
            <div className="modal-head"><div><h2>{editar.codigo ?? editar.nome}</h2><p>{tipoInfo(editar.tipo).nome} · {editar.salaNome ?? editar.salaCodigo}</p></div><button className="more-btn" onClick={() => setEditar(null)}><X /></button></div>
            <form onSubmit={salvar}>
              <label>Nome<input name="nome" defaultValue={editar.nome} /></label>
              <div className="dp-two">
                <label>Limite mínimo ({tipoInfo(editar.tipo).un})<input name="min" defaultValue={editar.limiteMin} inputMode="decimal" /></label>
                <label>Limite máximo ({tipoInfo(editar.tipo).un})<input name="max" defaultValue={editar.limiteMax} inputMode="decimal" /></label>
              </div>
              <p className="dp-hint">Fora desta faixa o sistema gera alerta de atenção; passando 15% do limite, alerta crítico.</p>
              <div className="modal-actions">
                {admin && <button type="button" className="ghost-btn dp-danger" onClick={() => desativar(editar)}><Trash2 size={15} /> Desativar</button>}
                <span style={{ flex: 1 }} />
                <button type="button" className="ghost-btn" onClick={() => setEditar(null)}>Cancelar</button>
                <button className="primary-btn">Salvar limites</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {novo && (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && setNovo(false)}>
          <div className="modal">
            <div className="modal-head"><div><h2>Novo sensor</h2><p>O código precisa ser o mesmo enviado pelo ESP32.</p></div><button className="more-btn" onClick={() => setNovo(false)}><X /></button></div>
            <form onSubmit={criar}>
              <div className="dp-two">
                <label>Código<input name="codigo" placeholder="Ex.: DHT-03" /></label>
                <label>Tipo<select name="tipo" defaultValue="temperatura">{Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v.nome}</option>)}</select></label>
              </div>
              <label>Nome<input name="nome" required placeholder="Ex.: Temperatura — Linha B" /></label>
              <label>Sala<select name="sala" required>{salas.map((s) => <option key={s.id} value={s.id}>{s.codigo} · {s.nome}</option>)}</select></label>
              <div className="dp-two">
                <label>Limite mínimo<input name="min" required inputMode="decimal" defaultValue={0} /></label>
                <label>Limite máximo<input name="max" required inputMode="decimal" defaultValue={40} /></label>
              </div>
              <div className="modal-actions"><button type="button" className="ghost-btn" onClick={() => setNovo(false)}>Cancelar</button><button className="primary-btn">Cadastrar</button></div>
            </form>
          </div>
        </div>
      )}
      {aviso && <Aviso {...aviso} />}
    </div>
  );
}

/* ================================================================ HISTÓRICO */
const PERIODOS = [
  { id: "1h", nome: "Última hora", ms: 3600e3 },
  { id: "24h", nome: "Últimas 24 h", ms: 86400e3 },
  { id: "7d", nome: "7 dias", ms: 7 * 86400e3 },
  { id: "30d", nome: "30 dias", ms: 30 * 86400e3 },
];
const POR_PAGINA = 50;

export function HistoryPage() {
  const [periodo, setPeriodo] = useState("24h");
  const [sensor, setSensor] = useState("todos");
  const [status, setStatus] = useState("todos");
  const [busca, setBusca] = useState("");
  const [sensores, setSensores] = useState<Sensor[]>([]);
  const [leituras, setLeituras] = useState<Leitura[] | null>(null);
  const [erro, setErro] = useState("");
  const [pagina, setPagina] = useState(0);
  const [carregando, setCarregando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const P = PERIODOS.find((p) => p.id === periodo)!;
      const inicio = new Date(Date.now() - P.ms).toISOString();
      const q = new URLSearchParams({ inicio, limit: "5000" });
      if (sensor !== "todos") q.set("sensorId", sensor);
      const [ss, ls] = await Promise.all([
        sensores.length ? Promise.resolve(sensores) : call<Sensor[]>("/sensors"),
        call<Leitura[]>(`/readings?${q}`),
      ]);
      if (!sensores.length) setSensores(ss.filter((s) => s.ativo !== false));
      setLeituras(ls);
      setErro("");
      setPagina(0);
    } catch (e: any) { setErro(e.message); } finally { setCarregando(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo, sensor]);
  useEffect(() => { carregar(); }, [carregar]);

  const sensorDe = (id: string) => sensores.find((s) => s.id === id);
  const filtradas = (leituras ?? []).filter((l) => {
    const s = sensorDe(l.sensorId);
    if (status !== "todos" && (status === "fora" ? l.status === "normal" : l.status !== status)) return false;
    if (!busca.trim()) return true;
    return [l.sensorCodigo, l.sensorNome, s?.codigo, s?.salaNome, s?.salaCodigo].some((v) => (v || "").toLowerCase().includes(busca.toLowerCase()));
  });
  const paginas = Math.max(1, Math.ceil(filtradas.length / POR_PAGINA));
  const vis = filtradas.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA);
  const fora = filtradas.filter((l) => l.status !== "normal").length;

  function exportar() {
    const linhas = [["data_hora", "sala", "sensor", "tipo", "valor", "unidade", "status"]];
    for (const l of filtradas) {
      const s = sensorDe(l.sensorId);
      linhas.push([l.dataHora, s?.salaCodigo ?? "", l.sensorCodigo ?? s?.codigo ?? l.sensorNome ?? "", l.tipo ?? s?.tipo ?? "", String(l.valor), tipoInfo(l.tipo ?? s?.tipo ?? "").un, l.status]);
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + linhas.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `indusense-historico-${periodo}.csv`;
    a.click();
  }

  return (
    <div className="page-content">
      <div className="page-heading">
        <div><span className="eyebrow dark">DADOS</span><h1>Histórico</h1><p>{leituras ? `${filtradas.length.toLocaleString("pt-BR")} leituras · ${fora.toLocaleString("pt-BR")} fora do limite` : "Carregando leituras…"}</p></div>
        <div className="heading-actions">
          <button className="ghost-btn" onClick={carregar} title="Atualizar"><RefreshCw size={15} className={carregando ? "spin" : ""} /></button>
          <button className="primary-btn" onClick={exportar} disabled={!filtradas.length}><CloudDownload size={16} /> Exportar CSV</button>
        </div>
      </div>
      <section className="panel table-panel">
        <div className="table-toolbar dp-hist-tools">
          <label className="search-box"><Search size={16} /><input value={busca} onChange={(e) => { setBusca(e.target.value); setPagina(0); }} placeholder="Buscar por sensor ou sala" /></label>
          <select className="small-select" value={sensor} onChange={(e) => setSensor(e.target.value)}>
            <option value="todos">Todos os sensores</option>
            {sensores.map((s) => <option key={s.id} value={s.id}>{s.codigo ?? s.nome} · {tipoInfo(s.tipo).nome}</option>)}
          </select>
          <select className="small-select" value={status} onChange={(e) => { setStatus(e.target.value); setPagina(0); }}>
            <option value="todos">Todos os status</option>
            <option value="fora">Só fora do limite</option>
            <option value="atencao">Atenção</option>
            <option value="critico">Crítico</option>
          </select>
          <select className="small-select" value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
            {PERIODOS.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </div>
        {erro && <div className="error-box" style={{ margin: 14 }}>{erro}</div>}
        <div className="table-scroll">
          <table>
            <thead><tr><th>Data e hora</th><th>Sala</th><th>Sensor</th><th>Tipo</th><th>Valor</th><th>Limite</th><th>Status</th></tr></thead>
            <tbody>
              {leituras && vis.length === 0 && <tr><td colSpan={7} className="dp-empty-row">Nenhuma leitura neste período. Ligue o ESP32 ou escolha um período maior.</td></tr>}
              {!leituras && <tr><td colSpan={7} className="dp-empty-row">Carregando…</td></tr>}
              {vis.map((l) => {
                const s = sensorDe(l.sensorId);
                const T = tipoInfo(l.tipo ?? s?.tipo ?? "");
                return (
                  <tr key={l.id}>
                    <td>{new Date(l.dataHora).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td>
                    <td>{s?.salaCodigo ?? "—"}<small>{s?.salaNome ?? ""}</small></td>
                    <td><b>{l.sensorCodigo ?? s?.codigo ?? l.sensorNome ?? s?.nome}</b></td>
                    <td><span className="dp-tipo" style={{ ["--c" as any]: T.cor }}>{T.nome}</span></td>
                    <td><b>{fmt(l.valor)}</b> {T.un}</td>
                    <td>{s ? `${fmt(s.limiteMin)}–${fmt(s.limiteMax)}` : "—"}</td>
                    <td><Badge status={l.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {paginas > 1 && (
          <div className="dp-pager">
            <button className="ghost-btn" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>Anterior</button>
            <span>Página {pagina + 1} de {paginas}</span>
            <button className="ghost-btn" disabled={pagina >= paginas - 1} onClick={() => setPagina(pagina + 1)}>Próxima</button>
          </div>
        )}
      </section>
    </div>
  );
}

/* ================================================================ DISPOSITIVOS (salas com ESP32) */
export function DevicesPage() {
  const router = useRouter();
  const [salas, setSalas] = useState<Sala[] | null>(null);
  const [sensores, setSensores] = useState<Sensor[]>([]);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [novo, setNovo] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; tipo: "ok" | "erro" } | null>(null);
  const admin = useMemo(perfil, []) === "ADMIN";

  const carregar = useCallback(async () => {
    try {
      const [sl, ss] = await Promise.all([call<Sala[]>("/salas"), call<Sensor[]>("/sensors").catch(() => [] as Sensor[])]);
      setSalas(sl);
      setSensores(ss.filter((s) => s.ativo !== false));
      setErro("");
    } catch (e: any) { setErro(e.message); }
  }, []);
  useEffect(() => { carregar(); const t = setInterval(carregar, 20_000); return () => clearInterval(t); }, [carregar]);
  useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), 3500); return () => clearTimeout(t); }, [aviso]);

  const linhas = (salas ?? []).map((s) => {
    const ss = sensores.filter((x) => x.salaId === s.id);
    const on = ss.filter((x) => x.online);
    const ultima = ss.map((x) => x.ultimaLeitura).filter(Boolean).sort().pop();
    return { s, ss, on, ultima };
  }).filter(({ s }) => !busca.trim() || [s.nome, s.codigo, s.setor, s.localizacao].some((v) => (v || "").toLowerCase().includes(busca.toLowerCase())));

  async function criar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const codigo = String(f.get("codigo") || "").trim() || undefined;
    try {
      await call("/salas", {
        method: "POST",
        body: JSON.stringify({ codigo, nome: String(f.get("nome")), setor: String(f.get("setor")), localizacao: String(f.get("local") || f.get("setor")), dispositivoModelo: "ESP32 DevKit" }),
      });
      setNovo(false);
      setAviso({ texto: "Dispositivo cadastrado. Agora cadastre os sensores dele em Sensores.", tipo: "ok" });
      carregar();
    } catch (er: any) { setAviso({ texto: er.message, tipo: "erro" }); }
  }

  return (
    <div className="page-content">
      <div className="page-heading">
        <div><span className="eyebrow dark">GERENCIAMENTO</span><h1>Dispositivos IoT</h1><p>{salas ? `${salas.length} dispositivo(s) · ${linhas.filter((l) => l.on.length).length} online` : "Carregando…"}</p></div>
        <div className="heading-actions">
          <button className="ghost-btn" onClick={carregar} title="Atualizar"><RefreshCw size={15} /></button>
          {admin && <button className="primary-btn" onClick={() => setNovo(true)}><Plus size={17} /> Cadastrar dispositivo</button>}
        </div>
      </div>
      <section className="panel table-panel">
        <div className="table-toolbar"><label className="search-box"><Search size={16} /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar dispositivo, código ou setor" /></label></div>
        {erro && <div className="error-box" style={{ margin: 14 }}>{erro}</div>}
        <div className="table-scroll">
          <table>
            <thead><tr><th>Dispositivo</th><th>Modelo</th><th>Localização</th><th>Status</th><th>Última comunicação</th><th>Sensores</th><th></th></tr></thead>
            <tbody>
              {salas && linhas.length === 0 && <tr><td colSpan={7} className="dp-empty-row">Nenhum dispositivo encontrado.</td></tr>}
              {linhas.map(({ s, ss, on, ultima }) => (
                <tr key={s.id} className="dp-click" onClick={() => router.push(`/dashboard/monitoramento/${encodeURIComponent(s.codigo)}`)}>
                  <td><b>{s.nome}</b><small>{s.codigo}</small></td>
                  <td>{s.dispositivoModelo || "ESP32 DevKit"}</td>
                  <td>{[s.setor, s.localizacao].filter(Boolean).join(" • ")}</td>
                  <td><Badge status={on.length ? "normal" : "offline"} online={on.length > 0} /></td>
                  <td>{quando(ultima)}</td>
                  <td>
                    <div className="dp-sens">
                      {ss.map((x) => <span key={x.id} title={`${x.codigo ?? x.nome} · ${x.online ? "online" : "offline"}`} style={{ ["--c" as any]: x.online ? tipoInfo(x.tipo).cor : "#3b4652" }} />)}
                      <em>{on.length}/{ss.length}</em>
                    </div>
                  </td>
                  <td><ArrowUpRight size={16} className="dp-go" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {novo && (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && setNovo(false)}>
          <div className="modal">
            <div className="modal-head"><div><h2>Novo dispositivo</h2><p>Cada ESP32 representa uma sala/área monitorada.</p></div><button className="more-btn" onClick={() => setNovo(false)}><X /></button></div>
            <form onSubmit={criar}>
              <div className="dp-two">
                <label>Código<input name="codigo" placeholder="Ex.: IND-002" /></label>
                <label>Setor<input name="setor" required placeholder="Ex.: Setor B" /></label>
              </div>
              <label>Nome<input name="nome" required placeholder="Ex.: Linha de Produção B" /></label>
              <label>Localização<input name="local" placeholder="Ex.: Galpão 02" /></label>
              <div className="modal-actions"><button type="button" className="ghost-btn" onClick={() => setNovo(false)}>Cancelar</button><button className="primary-btn">Cadastrar</button></div>
            </form>
          </div>
        </div>
      )}
      {aviso && <Aviso {...aviso} />}
    </div>
  );
}
