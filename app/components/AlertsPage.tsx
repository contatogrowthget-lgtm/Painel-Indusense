"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BellOff, CheckCircle2, RefreshCw, Search, Zap } from "lucide-react";
import { anunciarAtivos, call, duracao, fmtNum, tituloAlerta, unidade, type ApiAlerta } from "./alerts-shared";

/** Central de alertas ligada à API: ativos / resolvidos, resolver, atualização automática. */

type Aba = "ativos" | "resolvidos" | "todos";

function dataHora(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function AlertsPage({ onVerSala }: { onVerSala?: (salaCodigo: string) => void }) {
  const podeResolver = useMemo(() => {
    try { return ["ADMIN", "OPERADOR"].includes(JSON.parse(localStorage.getItem("indusense_user") || "{}").perfil); } catch { return false; }
  }, []);

  const [lista, setLista] = useState<ApiAlerta[] | null>(null);
  const [erro, setErro] = useState("");
  const [aba, setAba] = useState<Aba>("ativos");
  const [sev, setSev] = useState<"todas" | "critico" | "atencao">("todas");
  const [busca, setBusca] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  const carregar = useCallback(async () => {
    try {
      const l = await call<ApiAlerta[]>("/alerts?limit=300");
      setLista(l);
      setErro("");
      anunciarAtivos(l.filter((a) => !a.resolvido && a.severidade !== "offline").length);
    } catch (e: any) {
      setErro(e.message);
    }
  }, []);

  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 15_000);
    return () => clearInterval(t);
  }, [carregar]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 3800);
    return () => clearTimeout(t);
  }, [aviso]);

  async function resolver(a: ApiAlerta) {
    setOcupado(a.id);
    try {
      const r = await call<ApiAlerta>(`/alerts/${a.id}/resolve`, { method: "PATCH", body: "{}" });
      setLista((l) => (l || []).map((x) => (x.id === a.id ? { ...x, ...r, resolvido: true } : x)));
      setAviso({ tipo: "ok", texto: "Alerta marcado como resolvido. Se o valor continuar fora do limite, um novo alerta será aberto." });
      carregar();
    } catch (e: any) {
      setAviso({ tipo: "erro", texto: e.message });
    } finally {
      setOcupado(null);
    }
  }

  async function marcarTodosLidos() {
    try {
      await call("/alerts/read-all", { method: "PATCH", body: "{}" });
      setLista((l) => (l || []).map((x) => ({ ...x, lido: true })));
      setAviso({ tipo: "ok", texto: "Todos os alertas foram marcados como lidos." });
    } catch (e: any) {
      setAviso({ tipo: "erro", texto: e.message });
    }
  }

  const todos = lista || [];
  const ativos = todos.filter((a) => !a.resolvido);
  const resumo = {
    ativos: ativos.length,
    criticos: ativos.filter((a) => a.severidade === "critico").length,
    atencao: ativos.filter((a) => a.severidade === "atencao").length,
    hoje: todos.filter((a) => new Date(a.dataHora).toDateString() === new Date().toDateString()).length,
  };

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return todos
      .filter((a) => (aba === "ativos" ? !a.resolvido : aba === "resolvidos" ? a.resolvido : true))
      .filter((a) => sev === "todas" || a.severidade === sev)
      .filter((a) => !q || [a.salaNome, a.salaCodigo, a.sensorNome, a.sensorCodigo, a.tipo].some((v) => (v || "").toLowerCase().includes(q)))
      .sort((x, y) => Number(x.resolvido) - Number(y.resolvido)
        || (x.severidade === "critico" ? 0 : 1) - (y.severidade === "critico" ? 0 : 1)
        || +new Date(y.dataHora) - +new Date(x.dataHora));
  }, [todos, aba, sev, busca]);

  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <span className="eyebrow dark">SEGURANÇA</span>
          <h1>Central de alertas</h1>
          <p>Os alertas são encerrados sozinhos quando a leitura volta ao normal.</p>
        </div>
        <div className="heading-actions">
          <button className="ghost-btn" onClick={carregar} title="Atualizar"><RefreshCw size={15} /></button>
          {ativos.some((a) => !a.lido) && <button className="ghost-btn" onClick={marcarTodosLidos}><BellOff size={15} /> Marcar todos como lidos</button>}
        </div>
      </div>

      <div className="al-kpis">
        <div className={resumo.ativos ? "bad" : "ok"}><b>{resumo.ativos}</b><span>ativos agora</span></div>
        <div className="bad"><b>{resumo.criticos}</b><span>críticos</span></div>
        <div className="warn"><b>{resumo.atencao}</b><span>em atenção</span></div>
        <div><b>{resumo.hoje}</b><span>registrados hoje</span></div>
      </div>

      <section className="panel table-panel">
        <div className="filter-tabs al-filters">
          {(["ativos", "resolvidos", "todos"] as Aba[]).map((t) => (
            <button key={t} className={aba === t ? "selected" : ""} onClick={() => setAba(t)}>
              {t === "ativos" ? `Ativos (${ativos.length})` : t === "resolvidos" ? "Resolvidos" : "Todos"}
            </button>
          ))}
          <span className="al-sep" />
          {(["todas", "critico", "atencao"] as const).map((s) => (
            <button key={s} className={sev === s ? "selected" : ""} onClick={() => setSev(s)}>
              {s === "todas" ? "Toda severidade" : s === "critico" ? "Crítico" : "Atenção"}
            </button>
          ))}
          <label className="search-box al-search">
            <Search size={14} />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar sala ou sensor" />
          </label>
        </div>

        {erro && !lista ? (
          <div className="settings-error"><b>Não foi possível carregar os alertas</b><span>{erro}</span><button className="ghost-btn" onClick={carregar}>Tentar de novo</button></div>
        ) : !lista ? (
          <p className="users-empty">Carregando alertas…</p>
        ) : visiveis.length === 0 ? (
          <div className="al-empty">
            <CheckCircle2 size={30} />
            <b>{aba === "ativos" ? "Nenhum alerta ativo" : "Nada por aqui"}</b>
            <span>{aba === "ativos" ? "Todos os sensores estão dentro dos limites." : "Nenhum alerta com esse filtro."}</span>
          </div>
        ) : (
          <ul className="al-list">
            {visiveis.map((a) => {
              const un = unidade(a);
              const ativo = !a.resolvido;
              return (
                <li key={a.id} className={`al-item ${ativo ? `sev-${a.severidade}` : "resolved"} ${ativo && !a.lido ? "unread" : ""}`}>
                  <span className="al-bar" />
                  <div className="al-main">
                    <div className="al-title">
                      <b>{tituloAlerta(a)}</b>
                      {ativo ? (
                        <span className={`status-badge ${a.severidade === "critico" ? "critical" : "warning"}`}><i /> {a.severidade === "critico" ? "Crítico" : "Atenção"}</span>
                      ) : (
                        <span className="status-badge success">
                          <i /> {a.resolvidoAutomaticamente ? <>Normalizado <Zap size={10} /></> : "Resolvido"}
                        </span>
                      )}
                      {ativo && !a.lido && <em className="al-new">novo</em>}
                    </div>
                    <small>
                      {a.salaNome ?? "Sala"}{a.salaCodigo ? ` (${a.salaCodigo})` : ""} · {a.sensorNome} · desde {dataHora(a.dataHora)}
                      {ativo ? ` · há ${duracao(a.dataHora)}` : a.resolvidoEm ? ` · durou ${duracao(a.dataHora, a.resolvidoEm)}${a.resolvidoAutomaticamente ? ", voltou ao normal sozinho" : ""}` : ""}
                    </small>
                  </div>
                  <div className="al-values">
                    <div><small>{ativo ? "Valor" : "Pior valor"}</small><b className={ativo ? "hot" : ""}>{fmtNum(a.valorMedido)} {un}</b></div>
                    <div><small>Limite</small><b>{fmtNum(a.limite)} {un}</b></div>
                  </div>
                  <div className="al-actions">
                    {onVerSala && a.salaCodigo && <button className="ghost-btn" onClick={() => onVerSala(a.salaCodigo!)}>Ver sala</button>}
                    {ativo && podeResolver && (
                      <button className="resolve-btn" disabled={ocupado === a.id} onClick={() => resolver(a)}>
                        <CheckCircle2 size={14} /> {ocupado === a.id ? "Resolvendo…" : "Resolver"}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {aviso && <div className={`users-toast ${aviso.tipo === "erro" ? "toast-error" : ""}`}>{aviso.texto}</div>}
    </div>
  );
}
