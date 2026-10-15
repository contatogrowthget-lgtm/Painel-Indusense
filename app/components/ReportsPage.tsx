"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, CloudDownload, FileText, RefreshCw } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { call, TIPO_LABEL, UNIDADE, type ApiAlerta } from "./alerts-shared";

/** Relatório gerado com os dados reais da API: leituras, alertas e disponibilidade do período. */

type Sala = { id: string; codigo: string; nome: string; setor?: string };
type Sensor = { id: string; codigo?: string | null; nome: string; tipo: string; salaId: string; limiteMin: number; limiteMax: number; status: string; ativo: boolean };
type Leitura = { sensorId: string; valor: number; dataHora: string; status: string };

const PERIODOS = [
  { id: "24h", label: "Últimas 24 horas", ms: 24 * 3600e3, bucket: 3600e3 },
  { id: "7d", label: "Últimos 7 dias", ms: 7 * 24 * 3600e3, bucket: 6 * 3600e3 },
  { id: "30d", label: "Últimos 30 dias", ms: 30 * 24 * 3600e3, bucket: 24 * 3600e3 },
];
const ORDEM = ["temperatura", "umidade", "qualidade_ar", "gas"];
const num = (v: number, d = 1) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const dataHora = (s: string) => new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const sev = (s: string) => (s === "critico" ? "Crítico" : s === "atencao" ? "Atenção" : s === "offline" ? "Offline" : s);
const sevCls = (s: string) => (s === "critico" ? "critical" : s === "atencao" ? "warning" : "offline");

type Stat = { sensor: Sensor; sala?: Sala; n: number; min: number; max: number; media: number; fora: number; ultimo?: Leitura; disp: number };

export default function ReportsPage() {
  const [periodo, setPeriodo] = useState("24h");
  const [salaSel, setSalaSel] = useState("todas");
  const [salas, setSalas] = useState<Sala[]>([]);
  const [sensores, setSensores] = useState<Sensor[]>([]);
  const [leituras, setLeituras] = useState<Record<string, Leitura[]>>({});
  const [alertas, setAlertas] = useState<ApiAlerta[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [geradoEm, setGeradoEm] = useState<Date | null>(null);

  const P = PERIODOS.find((p) => p.id === periodo)!;

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro("");
    try {
      const [sl, ss, al] = await Promise.all([
        call<Sala[]>("/salas"),
        call<Sensor[]>("/sensors"),
        call<ApiAlerta[]>("/alerts?limit=1000"),
      ]);
      setSalas(sl);
      setSensores(ss);
      setAlertas(al);
      const inicio = new Date(Date.now() - P.ms).toISOString();
      const pares = await Promise.all(
        ss.filter((s) => s.ativo).map(async (s) => {
          try {
            return [s.id, await call<Leitura[]>(`/readings?sensorId=${s.id}&inicio=${encodeURIComponent(inicio)}&limit=5000`)] as const;
          } catch {
            return [s.id, [] as Leitura[]] as const;
          }
        }),
      );
      setLeituras(Object.fromEntries(pares));
      setGeradoEm(new Date());
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, [P.ms]);

  useEffect(() => { carregar(); }, [carregar]);

  const desde = geradoEm ? geradoEm.getTime() - P.ms : 0;
  const salaObj = salas.find((s) => s.id === salaSel);
  const sensoresSel = useMemo(
    () => sensores.filter((s) => s.ativo && (salaSel === "todas" || s.salaId === salaSel))
      .sort((a, b) => ORDEM.indexOf(a.tipo) - ORDEM.indexOf(b.tipo)),
    [sensores, salaSel],
  );

  const stats: Stat[] = useMemo(() => sensoresSel.map((s) => {
    const ls = leituras[s.id] ?? [];
    const vals = ls.map((l) => l.valor);
    const buckets = new Set(ls.map((l) => Math.floor(new Date(l.dataHora).getTime() / P.bucket)));
    const esperado = Math.max(1, Math.round(P.ms / P.bucket));
    return {
      sensor: s,
      sala: salas.find((x) => x.id === s.salaId),
      n: ls.length,
      min: vals.length ? Math.min(...vals) : 0,
      max: vals.length ? Math.max(...vals) : 0,
      media: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0,
      fora: ls.filter((l) => l.valor < s.limiteMin || l.valor > s.limiteMax).length,
      ultimo: ls[0],
      disp: Math.min(100, (buckets.size / esperado) * 100),
    };
  }), [sensoresSel, leituras, salas, P]);

  const alertasSel = useMemo(
    () => alertas.filter((a) => new Date(a.dataHora).getTime() >= desde && (salaSel === "todas" || a.salaId === salaSel))
      .sort((a, b) => b.dataHora.localeCompare(a.dataHora)),
    [alertas, desde, salaSel],
  );

  // Série do gráfico: média de cada tipo por intervalo.
  const serie = useMemo(() => {
    if (!geradoEm) return [];
    const ini = Math.floor(desde / P.bucket);
    const fim = Math.floor(geradoEm.getTime() / P.bucket);
    const acc: Record<number, Record<string, [number, number]>> = {};
    for (const s of sensoresSel) for (const l of leituras[s.id] ?? []) {
      const b = Math.floor(new Date(l.dataHora).getTime() / P.bucket);
      ((acc[b] ??= {})[s.tipo] ??= [0, 0]);
      acc[b][s.tipo][0] += l.valor;
      acc[b][s.tipo][1] += 1;
    }
    const out = [];
    for (let b = ini; b <= fim; b++) {
      const d = new Date(b * P.bucket);
      const row: Record<string, any> = {
        time: periodo === "24h" ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + (periodo === "7d" ? " " + d.getHours() + "h" : ""),
      };
      for (const t of ORDEM) {
        const v = acc[b]?.[t];
        row[t] = v ? Math.round((v[0] / v[1]) * 10) / 10 : null;
      }
      out.push(row);
    }
    return out;
  }, [sensoresSel, leituras, desde, geradoEm, P, periodo]);

  const porTipo = (t: string) => {
    const ss = stats.filter((s) => s.sensor.tipo === t && s.n > 0);
    if (!ss.length) return null;
    const n = ss.reduce((a, s) => a + s.n, 0);
    return { media: ss.reduce((a, s) => a + s.media * s.n, 0) / n, fora: ss.reduce((a, s) => a + s.fora, 0), n, sensor: ss[0].sensor };
  };
  const temp = porTipo("temperatura"), umid = porTipo("umidade"), ar = porTipo("qualidade_ar"), gas = porTipo("gas");
  const totalLeit = stats.reduce((a, s) => a + s.n, 0);
  const totalFora = stats.reduce((a, s) => a + s.fora, 0);
  const disp = stats.length ? stats.reduce((a, s) => a + s.disp, 0) / stats.length : 0;
  const criticos = alertasSel.filter((a) => a.severidade === "critico").length;
  const abertos = alertasSel.filter((a) => !a.resolvido).length;
  const arTxt = ar ? (ar.media > ar.sensor.limiteMax ? "Ruim" : ar.media > ar.sensor.limiteMax * 0.8 ? "Moderada" : "Boa") : null;

  const resumo = useMemo(() => {
    if (!totalLeit) return "Nenhuma leitura foi registrada no período selecionado. Verifique se os dispositivos estão ligados e enviando dados para a API.";
    const partes: string[] = [];
    const pct = (totalFora / totalLeit) * 100;
    partes.push(pct === 0
      ? `Todas as ${totalLeit.toLocaleString("pt-BR")} leituras ficaram dentro dos limites configurados.`
      : `${num(100 - pct)}% das ${totalLeit.toLocaleString("pt-BR")} leituras ficaram dentro dos limites; ${totalFora.toLocaleString("pt-BR")} ficaram fora.`);
    if (temp) partes.push(`Temperatura média de ${num(temp.media)} °C.`);
    if (umid) partes.push(`Umidade média de ${num(umid.media)}%.`);
    if (arTxt) partes.push(`Qualidade do ar ${arTxt.toLowerCase()} (índice médio ${num(ar!.media, 0)}).`);
    if (gas) partes.push(`Gases com média de ${num(gas.media)} ppm${gas.fora ? `, com ${gas.fora} leitura(s) acima do limite` : ", sem ultrapassar o limite"}.`);
    partes.push(alertasSel.length
      ? `Foram gerados ${alertasSel.length} alerta(s), ${criticos} crítico(s); ${abertos} ainda em aberto.`
      : "Nenhum alerta foi gerado no período.");
    partes.push(`Disponibilidade média dos sensores: ${num(disp)}%.`);
    return partes.join(" ");
  }, [totalLeit, totalFora, temp, umid, ar, arTxt, gas, alertasSel.length, criticos, abertos, disp]);

  function exportarCsv() {
    const linhas = [["data_hora", "sala", "sensor", "tipo", "valor", "unidade", "status"]];
    for (const s of stats) for (const l of [...(leituras[s.sensor.id] ?? [])].reverse())
      linhas.push([l.dataHora, s.sala?.codigo ?? "", s.sensor.codigo ?? s.sensor.nome, s.sensor.tipo, String(l.valor), UNIDADE[s.sensor.tipo] ?? "", l.status]);
    const csv = "﻿" + linhas.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `indusense-leituras-${salaObj?.codigo ?? "todas"}-${periodo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const linhaSel = (t: string) => sensoresSel.some((s) => s.tipo === t);

  return (
    <div className="page-content">
      <div className="page-heading">
        <div><span className="eyebrow dark">ANÁLISE</span><h1>Relatórios</h1><p>Relatório gerado com as leituras e alertas reais do período.</p></div>
        <div className="report-actions">
          <select className="period-select" value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
            {PERIODOS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <select className="period-select" value={salaSel} onChange={(e) => setSalaSel(e.target.value)}>
            <option value="todas">Todas as salas</option>
            {salas.map((s) => <option key={s.id} value={s.id}>{s.codigo} · {s.nome}</option>)}
          </select>
          <button className="ghost-btn" onClick={carregar} disabled={carregando}><RefreshCw size={16} className={carregando ? "spin" : ""} /> Atualizar</button>
          <button className="ghost-btn" onClick={exportarCsv} disabled={!totalLeit}><CloudDownload size={16} /> CSV</button>
          <button className="primary-btn" onClick={() => window.print()} disabled={carregando}><FileText size={17} /> Gerar PDF</button>
        </div>
      </div>

      {erro && <div className="error-box">{erro}</div>}

      <section className="report-preview" id="report">
        <div className="report-head">
          <div className="brand-mark"><Activity size={24} /><span>Indu<span>Sense</span></span></div>
          <span>RELATÓRIO • {(geradoEm ?? new Date()).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase()}</span>
        </div>
        <h2>Relatório de Monitoramento Industrial</h2>
        <p>
          Período: {geradoEm ? `${new Date(desde).toLocaleString("pt-BR")} a ${geradoEm.toLocaleString("pt-BR")}` : P.label}
          {" • "}{salaObj ? `${salaObj.codigo} — ${salaObj.nome}` : "Todas as salas"} • {sensoresSel.length} sensor(es)
        </p>

        {carregando ? <p className="chart-empty">Gerando relatório com os dados da API…</p> : (<>
          <div className="report-kpis">
            <div><small>Temperatura média</small><b>{temp ? `${num(temp.media)} °C` : "—"}</b></div>
            <div><small>Umidade média</small><b>{umid ? `${num(umid.media)}%` : "—"}</b></div>
            <div><small>Qualidade do ar</small><b className={arTxt === "Ruim" ? "txt-red" : arTxt === "Moderada" ? "txt-yellow" : arTxt ? "txt-green" : ""}>{arTxt ?? "—"}</b></div>
            <div><small>Gases (média)</small><b>{gas ? `${num(gas.media)} ppm` : "—"}</b></div>
            <div><small>Alertas no período</small><b>{alertasSel.length}{criticos ? <em className="txt-red"> · {criticos} crít.</em> : null}</b></div>
            <div><small>Disponibilidade</small><b>{stats.length ? `${num(disp)}%` : "—"}</b></div>
          </div>

          <h3>Resumo executivo</h3>
          <p>{resumo}</p>

          <h3>Evolução no período</h3>
          <div className="report-chart">
            {totalLeit === 0 ? <p className="chart-empty">Sem leituras neste período.</p> : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={serie}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="time" minTickGap={24} /><YAxis /><Tooltip />
                  {linhaSel("temperatura") && <Line connectNulls isAnimationActive={false} dataKey="temperatura" name="Temperatura °C" stroke="#ef6b4a" strokeWidth={2.5} dot={false} />}
                  {linhaSel("umidade") && <Line connectNulls isAnimationActive={false} dataKey="umidade" name="Umidade %" stroke="#1e88e5" strokeWidth={2.5} dot={false} />}
                  {linhaSel("qualidade_ar") && <Line connectNulls isAnimationActive={false} dataKey="qualidade_ar" name="Qualidade do ar (índice)" stroke="#14b8a6" strokeWidth={2.5} dot={false} />}
                  {linhaSel("gas") && <Line connectNulls isAnimationActive={false} dataKey="gas" name="Gases ppm" stroke="#f59e0b" strokeWidth={2.5} dot={false} />}
                  {linhaSel("gas") && <ReferenceLine y={40} stroke="#ef4444" strokeDasharray="5 5" />}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          <h3>Sensores</h3>
          <div className="table-scroll">
            <table className="report-table">
              <thead><tr><th>Sala</th><th>Sensor</th><th>Tipo</th><th>Leituras</th><th>Mín.</th><th>Média</th><th>Máx.</th><th>Limite</th><th>Fora do limite</th><th>Disponib.</th><th>Situação</th></tr></thead>
              <tbody>
                {stats.length === 0 && <tr><td colSpan={11}>Nenhum sensor ativo.</td></tr>}
                {stats.map((s) => {
                  const u = UNIDADE[s.sensor.tipo] ?? "";
                  const isAr = s.sensor.tipo === "qualidade_ar";
                  const sit = s.n === 0 ? { t: "Sem dados", c: "offline" }
                    : isAr ? (s.media > s.sensor.limiteMax ? { t: "Ruim", c: "critical" } : s.media > s.sensor.limiteMax * 0.8 ? { t: "Moderada", c: "warning" } : { t: "Boa", c: "success" })
                    : s.fora === 0 ? { t: "Normal", c: "success" } : s.fora / s.n > 0.1 ? { t: "Crítico", c: "critical" } : { t: "Atenção", c: "warning" };
                  return (
                    <tr key={s.sensor.id}>
                      <td>{s.sala?.codigo ?? "—"}</td>
                      <td><b>{s.sensor.codigo ?? s.sensor.nome}</b></td>
                      <td>{TIPO_LABEL[s.sensor.tipo] ?? s.sensor.tipo}</td>
                      <td>{s.n.toLocaleString("pt-BR")}</td>
                      <td>{s.n ? `${num(s.min)} ${u}` : "—"}</td>
                      <td><b>{s.n ? `${num(s.media)} ${u}` : "—"}</b></td>
                      <td>{s.n ? `${num(s.max)} ${u}` : "—"}</td>
                      <td>{num(s.sensor.limiteMin, 0)}–{num(s.sensor.limiteMax, 0)} {u}</td>
                      <td>{s.n ? `${s.fora} (${num((s.fora / s.n) * 100)}%)` : "—"}</td>
                      <td>{num(s.disp, 0)}%</td>
                      <td><span className={"status-badge " + sit.c}><i /> {sit.t}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <h3>Alertas do período ({alertasSel.length})</h3>
          <div className="table-scroll">
            <table className="report-table">
              <thead><tr><th>Data</th><th>Sala</th><th>Sensor</th><th>Tipo</th><th>Medido</th><th>Limite</th><th>Severidade</th><th>Situação</th></tr></thead>
              <tbody>
                {alertasSel.length === 0 && <tr><td colSpan={8}>Nenhum alerta no período. 👍</td></tr>}
                {alertasSel.slice(0, 200).map((a) => (
                  <tr key={a.id}>
                    <td>{dataHora(a.dataHora)}</td>
                    <td>{a.salaCodigo ?? "—"}</td>
                    <td>{a.sensorCodigo ?? a.sensorNome}</td>
                    <td>{TIPO_LABEL[a.tipo] ?? a.tipo}</td>
                    <td><b>{num(a.valorMedido)} {a.unidade ?? UNIDADE[a.tipo] ?? ""}</b></td>
                    <td>{num(a.limite)} {a.unidade ?? UNIDADE[a.tipo] ?? ""}</td>
                    <td><span className={"status-badge " + sevCls(a.severidade)}><i /> {sev(a.severidade)}</span></td>
                    <td>{a.resolvido ? (a.resolvidoAutomaticamente ? "Normalizou sozinho" : "Resolvido") : "Em aberto"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {alertasSel.length > 200 && <p className="report-note">Mostrando os 200 alertas mais recentes.</p>}
          <p className="report-note">Gerado em {geradoEm?.toLocaleString("pt-BR")} pelo painel InduSense · limites de cada sensor conforme cadastro.</p>
        </>)}
      </section>
    </div>
  );
}
