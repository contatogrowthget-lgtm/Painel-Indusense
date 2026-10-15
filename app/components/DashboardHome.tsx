"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AirVent, Bell, ShieldAlert, Thermometer, Waves, Wifi } from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { call } from "./alerts-shared";
import { qualidadeAr } from "./air";

/** Visão geral ligada à API (GET /dashboard/summary): números, tendência e dispositivos reais. */

type Metrica = { valor: number; unidade: string; status: string; sensores: number; variacaoPercentual?: number | null } | null;
type Summary = {
  atualizadoEm: string;
  metricas: Record<"temperatura" | "umidade" | "qualidade_ar" | "gas", Metrica>;
  dispositivos: { total: number; online: number; offline: number; lista: { id: string; name: string; location: string; status: string; last?: string }[] };
  alertas: { ativos: number; criticos: number; atencao: number; naoLidos: number };
  tendencia: { pontos: Array<Record<string, any>> };
};

const RANGES = [
  { id: "6h", label: "Últimas 6 h" },
  { id: "24h", label: "Últimas 24 h" },
  { id: "7d", label: "7 dias" },
  { id: "30d", label: "30 dias" },
];

const kindOf = (st?: string) => (st === "critico" ? "critical" : st === "atencao" ? "warning" : "good") as "good" | "warning" | "critical";
const statusTxt = (st?: string) => (st === "critico" ? "Crítico" : st === "atencao" ? "Atenção" : "Normal");
const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)).replace(".", ",");

function Card({ title, value, unit, foot, kind, icon: Icon, fill }: {
  title: string; value: string; unit?: string; foot: ReactNode; kind: "good" | "warning" | "critical"; icon: any; fill: number;
}) {
  return (
    <div className="metric-card">
      <div className="metric-head"><span>{title}</span><div className={"metric-icon " + kind}><Icon size={20} /></div></div>
      <div className="metric-value">{value}{unit && <small>{unit}</small>}</div>
      <div className="metric-footer">{foot}</div>
      <div className="mini-line"><span style={{ width: `${Math.max(4, Math.min(100, fill))}%` }} /></div>
    </div>
  );
}

export default function DashboardHome() {
  const [range, setRange] = useState("24h");
  const [d, setD] = useState<Summary | null>(null);
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    try {
      setD(await call<Summary>(`/dashboard/summary?range=${range}`));
      setErro("");
    } catch (e: any) {
      setErro(e.message);
    }
  }, [range]);

  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 30_000);
    return () => clearInterval(t);
  }, [carregar]);

  const m = d?.metricas;
  const pontos = d?.tendencia?.pontos ?? [];
  const varTxt = (x: Metrica) =>
    x?.variacaoPercentual == null ? <span>{x ? `${x.sensores} sensor${x.sensores === 1 ? "" : "es"} online` : "sem sensor online"}</span>
      : <><span className={"delta " + (x.variacaoPercentual >= 0 ? "negative" : "positive")}>{x.variacaoPercentual > 0 ? "+" : ""}{x.variacaoPercentual}%</span><span>na última hora</span></>;
  const pos = (x: Metrica, min: number, max: number) => (x ? ((x.valor - min) / (max - min)) * 100 : 0);
  const ar = qualidadeAr(m?.qualidade_ar?.status, !!m?.qualidade_ar);

  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <span className="eyebrow dark">MONITORAMENTO EM TEMPO REAL</span>
          <h1>Visão Geral do Ambiente Industrial</h1>
          <p>{d ? `Atualizado às ${new Date(d.atualizadoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} · média dos sensores online` : "Carregando dados da API…"}</p>
        </div>
        <select className="period-select" value={range} onChange={(e) => setRange(e.target.value)}>
          {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </div>

      {erro && !d && <div className="error-box">{erro}</div>}

      <div className="metrics-grid">
        <Card title="Temperatura" value={m?.temperatura ? fmt(m.temperatura.valor) : "—"} unit={m?.temperatura ? "°C" : ""}
          kind={kindOf(m?.temperatura?.status)} icon={Thermometer} foot={varTxt(m?.temperatura ?? null)} fill={pos(m?.temperatura ?? null, 0, 45)} />
        <Card title="Umidade" value={m?.umidade ? fmt(m.umidade.valor) : "—"} unit={m?.umidade ? "%" : ""}
          kind={kindOf(m?.umidade?.status)} icon={Waves} foot={varTxt(m?.umidade ?? null)} fill={m?.umidade?.valor ?? 0} />
        <Card title="Qualidade do ar" value={ar.texto} unit={m?.qualidade_ar ? ` · ${Math.round(m.qualidade_ar.valor)}` : ""}
          kind={ar.cls === "critical" ? "critical" : ar.cls === "warn" ? "warning" : "good"} icon={AirVent}
          foot={<span>{m?.qualidade_ar ? "índice de qualidade do ar" : "sem sensor online"}</span>} fill={pos(m?.qualidade_ar ?? null, 0, 120)} />
        <Card title="Gases" value={m?.gas ? fmt(m.gas.valor) : "—"} unit={m?.gas ? " ppm" : ""}
          kind={kindOf(m?.gas?.status)} icon={ShieldAlert} foot={varTxt(m?.gas ?? null)} fill={pos(m?.gas ?? null, 0, 80)} />
        <Card title="Dispositivos online" value={d ? String(d.dispositivos.online) : "—"} unit={d ? ` / ${d.dispositivos.total}` : ""}
          kind={d && d.dispositivos.online < d.dispositivos.total ? "warning" : "good"} icon={Wifi}
          foot={<span>{d ? `${d.dispositivos.offline} sem comunicação` : ""}</span>}
          fill={d && d.dispositivos.total ? (d.dispositivos.online / d.dispositivos.total) * 100 : 0} />
        <Card title="Alertas ativos" value={d ? String(d.alertas.ativos) : "—"}
          kind={d?.alertas.criticos ? "critical" : d?.alertas.ativos ? "warning" : "good"} icon={Bell}
          foot={<span>{d ? `${d.alertas.criticos} críticos · ${d.alertas.atencao} atenção` : ""}</span>} fill={d ? Math.min(100, d.alertas.ativos * 20) : 0} />
      </div>

      <div className="dashboard-grid">
        <section className="panel chart-panel large">
          <div className="panel-title"><div><h3>Temperatura e umidade</h3><p>Média de todos os sensores · {RANGES.find((r) => r.id === range)?.label.toLowerCase()}</p></div></div>
          {pontos.length === 0 ? <p className="chart-empty">Sem leituras neste período.</p> : (
            <ResponsiveContainer width="100%" height={285}>
              <LineChart data={pontos}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="time" /><YAxis /><Tooltip />
                <Line connectNulls type="monotone" dataKey="temp" stroke="#ef6b4a" strokeWidth={3} dot={false} name="Temperatura °C" />
                <Line connectNulls type="monotone" dataKey="hum" stroke="#1e88e5" strokeWidth={3} dot={false} name="Umidade %" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </section>

        <section className="panel status-panel">
          <div className="panel-title"><div><h3>Status dos dispositivos</h3><p>Conectividade atual</p></div></div>
          <div className="device-status-list">
            {(d?.dispositivos.lista ?? []).map((x) => (
              <div className="device-row" key={x.id}>
                <span className={"device-dot " + x.status} />
                <div><b>{x.name}</b><small>{x.id} • {x.location}</small></div>
                <span className={"status-badge " + (x.status === "online" ? "success" : "offline")}><i /> {x.status === "online" ? "Online" : "Offline"}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel chart-panel">
          <div className="panel-title">
            <div><h3>Qualidade do ar</h3><p>Índice (até 60 = boa)</p></div>
            <span className={"pill " + (ar.cls === "critical" ? "red" : ar.cls === "warn" ? "yellow" : "green")}>{ar.texto}</span>
          </div>
          {pontos.length === 0 ? <p className="chart-empty">Sem leituras neste período.</p> : (
            <ResponsiveContainer width="100%" height={230}>
              <AreaChart data={pontos}>
                <defs><linearGradient id="airfill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#14b8a6" stopOpacity={0.35} /><stop offset="95%" stopColor="#14b8a6" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="time" /><YAxis /><Tooltip />
                <ReferenceLine y={60} stroke="#ef4444" strokeDasharray="5 5" />
                <Area connectNulls type="monotone" dataKey="air" stroke="#14b8a6" strokeWidth={3} fill="url(#airfill)" name="Índice" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </section>

        <section className="panel chart-panel">
          <div className="panel-title">
            <div><h3>Níveis de gases</h3><p>Concentração (limite 40 ppm)</p></div>
            <span className={"pill " + (m?.gas?.status === "critico" ? "red" : m?.gas?.status === "atencao" ? "yellow" : "green")}>{m?.gas ? statusTxt(m.gas.status) : "Sem sinal"}</span>
          </div>
          {pontos.length === 0 ? <p className="chart-empty">Sem leituras neste período.</p> : (
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={pontos}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="time" /><YAxis /><Tooltip />
                <ReferenceLine y={40} stroke="#ef4444" strokeDasharray="5 5" />
                <Bar dataKey="gas" name="ppm" fill="#f59e0b" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </section>
      </div>
    </div>
  );
}
