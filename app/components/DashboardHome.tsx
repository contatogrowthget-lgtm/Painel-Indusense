"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { CalendarDays, CloudDownload, RefreshCw } from "lucide-react";
import {
  Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { call, type ApiAlerta } from "./alerts-shared";
import { qualidadeAr } from "./air";

/**
 * Visão geral com dados reais (GET /dashboard/summary, /sensors e /alerts).
 * Cada cartão compara o período atual com o anterior, com barras em 3D.
 */

type Ponto = { time: string; timestamp: string; temp: number | null; hum: number | null; air: number | null; gas: number | null };
type Metrica = { valor: number; unidade: string; status: string; sensores: number; variacaoPercentual?: number | null } | null;
type Summary = {
  atualizadoEm: string;
  metricas: Record<"temperatura" | "umidade" | "qualidade_ar" | "gas", Metrica>;
  dispositivos: { total: number; online: number; offline: number; lista: { id: string; uuid?: string; name: string; location: string; status: string; last?: string }[] };
  alertas: { ativos: number; criticos: number; atencao: number; naoLidos: number };
  epi?: { pessoasDetectadas?: number; camerasOnline?: number; camerasTotal?: number; abertas?: number } | null;
  tendencia: { bucketSegundos: number; pontos: Ponto[] };
};
type SensorApi = { id: string; codigo?: string | null; nome: string; tipo: string; salaId: string; status: string; ativo: boolean; online?: boolean; limiteMax: number };

const RANGES = [
  { id: "6h", label: "Últimas 6 horas", ms: 6 * 3600e3, maior: "24h" },
  { id: "24h", label: "Últimas 24 horas", ms: 24 * 3600e3, maior: "7d" },
  { id: "7d", label: "Últimos 7 dias", ms: 7 * 86400e3, maior: "30d" },
  { id: "30d", label: "Últimos 30 dias", ms: 30 * 86400e3, maior: null },
] as const;

// cores do painel
const C = {
  navy: "#0c304c",
  azul: "#1e88e5",
  ciano: "#13b8bd",
  verde: "#16a67a",
  amarelo: "#e4a51b",
  coral: "#ef6b4a",
  vermelho: "#e14c55",
  cinza: "#b8c4cf",
};

const fmt = (v: number | null | undefined, d = 1) =>
  v == null || Number.isNaN(v) ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const media = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/* ------------------------------------------------------------------ barra 3D */
function sombra(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * f)));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

function Bar3D(props: any) {
  const { x, width, cor, profundidade = 7 } = props;
  let { y, height } = props;
  if (!height || !width || Number.isNaN(y)) return null;
  if (height < 0) { y += height; height = -height; }
  const d = Math.min(profundidade, width * 0.45);
  const id = `g3d-${cor.slice(1)}`;
  return (
    <g>
      {/* lateral */}
      <polygon points={`${x + width},${y} ${x + width + d},${y - d} ${x + width + d},${y + height - d} ${x + width},${y + height}`} fill={sombra(cor, 0.62)} />
      {/* frente */}
      <rect x={x} y={y} width={width} height={height} fill={`url(#${id})`} rx={1.5} />
      {/* topo */}
      <polygon points={`${x},${y} ${x + d},${y - d} ${x + width + d},${y - d} ${x + width},${y}`} fill={sombra(cor, 1.28)} />
    </g>
  );
}

/** Gradientes usados pelas barras 3D e pelas áreas (um por cor). */
function Gradientes() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        {Object.values(C).map((c) => (
          <linearGradient key={c} id={`g3d-${c.slice(1)}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={sombra(c, 1.15)} />
            <stop offset="100%" stopColor={sombra(c, 0.82)} />
          </linearGradient>
        ))}
        {Object.values(C).map((c) => (
          <linearGradient key={"a" + c} id={`area-${c.slice(1)}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c} stopOpacity={0.32} />
            <stop offset="100%" stopColor={c} stopOpacity={0} />
          </linearGradient>
        ))}
        <filter id="brilho" x="-10%" y="-30%" width="120%" height="160%">
          <feDropShadow dx="0" dy="5" stdDeviation="4" floodOpacity="0.22" />
        </filter>
      </defs>
    </svg>
  );
}

/* ------------------------------------------------------------------ cartão */
function Delta({ v, inverso = false }: { v: number | null; inverso?: boolean }) {
  if (v == null || !Number.isFinite(v)) return null;
  const bom = inverso ? v <= 0 : v >= 0;
  return <span className={"dash-delta " + (bom ? "up" : "down")}>{v > 0 ? "+" : ""}{fmt(v)}%</span>;
}

function Legenda({ itens }: { itens: { cor: string; nome: string; tracejado?: boolean }[] }) {
  return (
    <div className="dash-legend">
      {itens.map((i) => (
        <span key={i.nome}><i style={{ background: i.cor }} className={i.tracejado ? "dashed" : ""} />{i.nome}</span>
      ))}
    </div>
  );
}

function Cartao({ titulo, valor, unidade, delta, legenda, children, rodape }: {
  titulo: string; valor: ReactNode; unidade?: string; delta?: ReactNode;
  legenda?: ReactNode; children: ReactNode; rodape?: [string, string];
}) {
  return (
    <section className="dash-card">
      <div className="dash-card-head">
        <div>
          <span className="dash-title">{titulo}</span>
          <div className="dash-value">{valor}{unidade && <small>{unidade}</small>}{delta}</div>
        </div>
        {legenda}
      </div>
      <div className="dash-chart">{children}</div>
      {rodape && <div className="dash-foot"><span>{rodape[0]}</span><span>{rodape[1]}</span></div>}
    </section>
  );
}

const eixo = { fontSize: 11, fill: "#8a99a6" };
const dica = {
  contentStyle: { borderRadius: 12, border: "1px solid #e4eaf0", boxShadow: "0 10px 30px rgba(16,45,70,.12)", fontSize: 12 },
  labelStyle: { fontWeight: 700, color: "#142332" },
  cursor: { fill: "rgba(19,184,189,.06)" },
};

/* ------------------------------------------------------------------ página */
export default function DashboardHome() {
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("24h");
  const [d, setD] = useState<Summary | null>(null);
  const [anterior, setAnterior] = useState<Summary | null>(null);
  const [sensores, setSensores] = useState<SensorApi[]>([]);
  const [alertas, setAlertas] = useState<ApiAlerta[]>([]);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);
  const R = RANGES.find((r) => r.id === range)!;

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [s, maior, ss, al] = await Promise.all([
        call<Summary>(`/dashboard/summary?range=${R.id}`),
        R.maior ? call<Summary>(`/dashboard/summary?range=${R.maior}`).catch(() => null) : Promise.resolve(null),
        call<SensorApi[]>("/sensors").catch(() => [] as SensorApi[]),
        call<ApiAlerta[]>("/alerts?limit=1000").catch(() => [] as ApiAlerta[]),
      ]);
      setD(s);
      setAnterior(maior);
      setSensores(ss.filter((x) => x.ativo !== false));
      setAlertas(al);
      setErro("");
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, [R.id, R.maior]);

  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 30_000);
    return () => clearInterval(t);
  }, [carregar]);

  /** Série contínua (um ponto por intervalo, mesmo sem leitura) + período anterior alinhado. */
  const serie = useMemo(() => {
    if (!d) return [];
    const bucket = (d.tendencia.bucketSegundos || 3600) * 1000;
    const fim = new Date(d.atualizadoEm).getTime();
    const ini = Math.floor((fim - R.ms) / bucket) * bucket + bucket;
    const porTs = new Map<number, Ponto>(d.tendencia.pontos.map((p): [number, Ponto] => [Math.floor(new Date(p.timestamp).getTime() / bucket) * bucket, p]));
    const longo = R.ms > 36 * 3600e3;
    const slots: Record<string, any>[] = [];
    for (let t = ini; t <= fim; t += bucket) {
      const p = porTs.get(t);
      const dt = new Date(t);
      slots.push({
        t,
        time: longo ? dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + (R.id === "7d" ? ` ${String(dt.getHours()).padStart(2, "0")}h` : "")
          : dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
        temp: p?.temp ?? null, hum: p?.hum ?? null, air: p?.air ?? null, gas: p?.gas ?? null,
        tempAnt: null, humAnt: null, gasAnt: null, airAnt: null,
        aTemp: 0, aHum: 0, aAr: 0, aGas: 0,
      });
    }
    // período anterior (vem da série maior, deslocada em R)
    if (anterior) {
      for (const p of anterior.tendencia.pontos) {
        const ts = new Date(p.timestamp).getTime() + R.ms;
        if (ts < ini - bucket || ts > fim) continue;
        const i = Math.max(0, Math.min(slots.length - 1, Math.round((ts - ini) / bucket)));
        slots[i].tempAnt = p.temp; slots[i].humAnt = p.hum; slots[i].gasAnt = p.gas; slots[i].airAnt = p.air;
      }
    }
    // alertas por intervalo e por tipo
    for (const a of alertas) {
      const ts = new Date(a.dataHora).getTime();
      if (ts < ini - bucket || ts > fim || a.severidade === "offline") continue;
      const i = Math.max(0, Math.min(slots.length - 1, Math.floor((ts - ini) / bucket) + 1));
      const k = a.tipo === "temperatura" ? "aTemp" : a.tipo === "umidade" ? "aHum" : a.tipo === "qualidade_ar" ? "aAr" : "aGas";
      slots[i][k] += 1;
    }
    // qualidade do ar: barra para cima = índice dentro do limite; para baixo = excesso
    const limAr = sensores.find((s) => s.tipo === "qualidade_ar")?.limiteMax ?? 60;
    for (const s of slots) {
      s.arOk = s.air == null ? null : Math.min(s.air, limAr);
      s.arExc = s.air == null || s.air <= limAr ? null : -(s.air - limAr);
    }
    return slots;
  }, [d, anterior, alertas, sensores, R]);

  const m = d?.metricas;
  const comp = (k: "temp" | "hum" | "gas" | "air") => {
    const atual = media(serie.map((s) => s[k]));
    const ant = media(serie.map((s) => s[k + "Ant"]));
    return { atual, delta: atual != null && ant ? ((atual - ant) / Math.abs(ant)) * 100 : null };
  };
  const temp = comp("temp"), hum = comp("hum"), gas = comp("gas"), ar = comp("air");
  const qa = qualidadeAr(m?.qualidade_ar?.status, !!m?.qualidade_ar);
  const temAnterior = serie.some((s) => s.tempAnt != null || s.humAnt != null || s.gasAnt != null);

  const alertasPeriodo = serie.reduce((n, s) => n + s.aTemp + s.aHum + s.aAr + s.aGas, 0);

  // status dos sensores agora
  const contagem = {
    normal: sensores.filter((s) => s.online !== false && s.status === "normal").length,
    atencao: sensores.filter((s) => s.online !== false && s.status === "atencao").length,
    critico: sensores.filter((s) => s.online !== false && s.status === "critico").length,
    offline: sensores.filter((s) => s.online === false || s.status === "offline").length,
  };
  const totalSens = Math.max(1, sensores.length);
  const onlineSens = sensores.length - contagem.offline;

  const ticks = serie.length ? [serie[0].time, serie[serie.length - 1].time] : [];
  const rodape: [string, string] | undefined = ticks.length ? [ticks[0], "agora"] : undefined;

  function exportar() {
    const linhas = [["inicio_intervalo", "temperatura_c", "umidade_pct", "qualidade_ar_indice", "gas_ppm", "alertas"]];
    for (const s of serie) linhas.push([new Date(s.t).toISOString(), s.temp ?? "", s.hum ?? "", s.air ?? "", s.gas ?? "", String(s.aTemp + s.aHum + s.aAr + s.aGas)]);
    const csv = "﻿" + linhas.map((l) => l.join(";")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `indusense-visao-geral-${range}.csv`;
    a.click();
  }

  const xAxis = <XAxis dataKey="time" tick={eixo} tickLine={false} axisLine={false} minTickGap={28} interval="preserveStartEnd" />;
  const grade = <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#e8eef3" />;

  return (
    <div className="page-content dash">
      <Gradientes />
      <div className="dash-top">
        <div>
          <span className="eyebrow dark">MONITORAMENTO EM TEMPO REAL</span>
          <h1>Visão geral</h1>
          <p>{d ? `Atualizado às ${new Date(d.atualizadoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} · ${onlineSens} de ${sensores.length} sensores online` : "Carregando dados da API…"}</p>
        </div>
        <div className="dash-actions">
          <label className="dash-range">
            <CalendarDays size={15} />
            <select value={range} onChange={(e) => setRange(e.target.value as any)}>
              {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </label>
          <button className="dash-btn" onClick={carregar} title="Atualizar"><RefreshCw size={15} className={carregando ? "spin" : ""} /></button>
          <button className="dash-btn" onClick={exportar} disabled={!serie.length}><CloudDownload size={15} /> Exportar</button>
        </div>
      </div>

      {erro && !d && <div className="error-box">{erro}</div>}

      <div className="dash-grid">
        {/* Temperatura: barras 3D + período anterior */}
        <Cartao
          titulo="Temperatura média"
          valor={fmt(m?.temperatura?.valor ?? temp.atual)}
          unidade="°C"
          delta={<Delta v={temp.delta} inverso />}
          legenda={<Legenda itens={[{ cor: C.coral, nome: "Atual" }, ...(temAnterior ? [{ cor: C.cinza, nome: "Anterior", tracejado: true }] : [])]} />}
          rodape={rodape}
        >
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={serie} margin={{ top: 14, right: 10, left: -18, bottom: 0 }}>
              {grade}{xAxis}
              <YAxis tick={eixo} tickLine={false} axisLine={false} domain={["dataMin - 2", "dataMax + 2"]} allowDecimals={false} />
              <Tooltip {...dica} formatter={(v: any, n: any) => [`${fmt(v)} °C`, n]} />
              <Bar dataKey="temp" name="Atual" shape={(p: any) => <Bar3D {...p} cor={C.coral} />} maxBarSize={26} isAnimationActive animationDuration={900} />
              {temAnterior && <Line dataKey="tempAnt" name="Anterior" stroke={C.cinza} strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls type="monotone" />}
            </ComposedChart>
          </ResponsiveContainer>
        </Cartao>

        {/* Umidade: linha atual x anterior */}
        <Cartao
          titulo="Umidade relativa"
          valor={fmt(m?.umidade?.valor ?? hum.atual)}
          unidade="%"
          delta={<Delta v={hum.delta} />}
          legenda={<Legenda itens={[{ cor: C.azul, nome: "Atual" }, ...(temAnterior ? [{ cor: C.cinza, nome: "Anterior" }] : [])]} />}
          rodape={rodape}
        >
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={serie} margin={{ top: 14, right: 10, left: -18, bottom: 0 }}>
              {grade}{xAxis}
              <YAxis tick={eixo} tickLine={false} axisLine={false} domain={[0, 100]} />
              <Tooltip {...dica} formatter={(v: any, n: any) => [`${fmt(v)} %`, n]} />
              <ReferenceLine y={75} stroke={C.amarelo} strokeDasharray="4 4" />
              {temAnterior && <Line dataKey="humAnt" name="Anterior" stroke={C.cinza} strokeWidth={2} dot={false} connectNulls type="monotone" />}
              <Area dataKey="hum" name="Atual" stroke={C.azul} strokeWidth={3} fill={`url(#area-${C.azul.slice(1)})`} connectNulls type="monotone" filter="url(#brilho)" activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }} />
            </ComposedChart>
          </ResponsiveContainer>
        </Cartao>

        {/* Qualidade do ar: dentro do limite x excesso */}
        <Cartao
          titulo="Qualidade do ar"
          valor={<span className={"dash-quality " + qa.cls}>{qa.texto}</span>}
          unidade={m?.qualidade_ar ? `índice ${Math.round(m.qualidade_ar.valor)}` : undefined}
          delta={<Delta v={ar.delta} inverso />}
          legenda={<Legenda itens={[{ cor: C.ciano, nome: "Dentro do limite" }, { cor: C.vermelho, nome: "Excesso" }]} />}
          rodape={rodape}
        >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={serie} stackOffset="sign" margin={{ top: 14, right: 10, left: -18, bottom: 0 }}>
              {grade}{xAxis}
              <YAxis tick={eixo} tickLine={false} axisLine={false} />
              <Tooltip {...dica} formatter={(v: any, n: any) => [fmt(Math.abs(v), 0), n]} />
              <ReferenceLine y={0} stroke="#cfd8e0" />
              <Bar dataKey="arOk" name="Índice" stackId="ar" shape={(p: any) => <Bar3D {...p} cor={C.ciano} />} maxBarSize={24} />
              <Bar dataKey="arExc" name="Acima do limite" stackId="ar" shape={(p: any) => <Bar3D {...p} cor={C.vermelho} profundidade={5} />} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </Cartao>

        {/* Gases: linha atual x anterior com limite */}
        <Cartao
          titulo="Gases (MQ-2)"
          valor={fmt(m?.gas?.valor ?? gas.atual, 0)}
          unidade="ppm"
          delta={<Delta v={gas.delta} inverso />}
          legenda={<Legenda itens={[{ cor: C.amarelo, nome: "Atual" }, ...(temAnterior ? [{ cor: C.cinza, nome: "Anterior" }] : []), { cor: C.vermelho, nome: "Limite", tracejado: true }]} />}
          rodape={rodape}
        >
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={serie} margin={{ top: 14, right: 10, left: -18, bottom: 0 }}>
              {grade}{xAxis}
              <YAxis tick={eixo} tickLine={false} axisLine={false} />
              <Tooltip {...dica} formatter={(v: any, n: any) => [`${fmt(v, 0)} ppm`, n]} />
              <ReferenceLine y={sensores.find((s) => s.tipo === "gas")?.limiteMax ?? 40} stroke={C.vermelho} strokeDasharray="5 5" />
              {temAnterior && <Line dataKey="gasAnt" name="Anterior" stroke={C.cinza} strokeWidth={2} dot={false} connectNulls type="monotone" />}
              <Area dataKey="gas" name="Atual" stroke={C.amarelo} strokeWidth={3} fill={`url(#area-${C.amarelo.slice(1)})`} connectNulls type="monotone" filter="url(#brilho)" activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }} />
            </ComposedChart>
          </ResponsiveContainer>
        </Cartao>

        {/* Alertas por tipo */}
        <Cartao
          titulo="Alertas no período"
          valor={String(alertasPeriodo)}
          delta={d && d.alertas.criticos > 0 ? <span className="dash-delta down">{d.alertas.criticos} crítico{d.alertas.criticos === 1 ? "" : "s"} agora</span> : <span className="dash-delta up">{d?.alertas.ativos ?? 0} ativo{d?.alertas.ativos === 1 ? "" : "s"}</span>}
          legenda={<Legenda itens={[{ cor: C.coral, nome: "Temperatura" }, { cor: C.azul, nome: "Umidade" }, { cor: C.ciano, nome: "Ar" }, { cor: C.amarelo, nome: "Gás" }]} />}
          rodape={rodape}
        >
          {alertasPeriodo === 0 ? (
            <div className="dash-empty"><b>Nenhum alerta no período</b><span>Todos os sensores ficaram dentro dos limites.</span></div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={serie} margin={{ top: 14, right: 10, left: -18, bottom: 0 }}>
                {grade}{xAxis}
                <YAxis tick={eixo} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip {...dica} />
                <Bar dataKey="aTemp" name="Temperatura" stackId="al" shape={(p: any) => <Bar3D {...p} cor={C.coral} />} maxBarSize={24} />
                <Bar dataKey="aHum" name="Umidade" stackId="al" shape={(p: any) => <Bar3D {...p} cor={C.azul} />} maxBarSize={24} />
                <Bar dataKey="aAr" name="Qualidade do ar" stackId="al" shape={(p: any) => <Bar3D {...p} cor={C.ciano} />} maxBarSize={24} />
                <Bar dataKey="aGas" name="Gás" stackId="al" shape={(p: any) => <Bar3D {...p} cor={C.amarelo} />} maxBarSize={24} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Cartao>

        {/* Situação dos sensores e salas */}
        <section className="dash-card">
          <div className="dash-card-head">
            <div>
              <span className="dash-title">Sensores online</span>
              <div className="dash-value">{onlineSens}<small>/ {sensores.length}</small>
                {contagem.offline > 0 ? <span className="dash-delta down">{contagem.offline} sem sinal</span> : <span className="dash-delta up">todos ativos</span>}
              </div>
            </div>
          </div>
          <div className="dash-seg">
            {([
              ["normal", C.verde], ["atencao", C.amarelo], ["critico", C.vermelho], ["offline", "#d5dde4"],
            ] as const).map(([k, cor]) => contagem[k] > 0 && (
              <i key={k} style={{ flexGrow: contagem[k] / totalSens, background: cor }} title={`${contagem[k]} ${k}`} />
            ))}
          </div>
          <div className="dash-seg-legend">
            <span><i style={{ background: C.verde }} />Normal {contagem.normal}</span>
            <span><i style={{ background: C.amarelo }} />Atenção {contagem.atencao}</span>
            <span><i style={{ background: C.vermelho }} />Crítico {contagem.critico}</span>
            <span><i style={{ background: "#d5dde4" }} />Offline {contagem.offline}</span>
          </div>
          <span className="dash-sub">Salas monitoradas</span>
          <div className="dash-list">
            {(d?.dispositivos.lista ?? []).map((x) => (
              <div key={x.id}>
                <span className={"dash-dot " + (x.status === "online" ? "on" : "off")} />
                <p><b>{x.name}</b><small>{x.id} · {x.location}</small></p>
                <em>{x.status === "online" ? (x.last ?? "online") : "offline"}</em>
              </div>
            ))}
            {d?.epi && (d.epi.camerasTotal ?? 0) > 0 && (
              <div>
                <span className={"dash-dot " + ((d.epi.camerasOnline ?? 0) > 0 ? "on" : "off")} />
                <p><b>Câmeras de EPI</b><small>{d.epi.camerasOnline ?? 0} de {d.epi.camerasTotal} online · {d.epi.pessoasDetectadas ?? 0} pessoa(s) agora</small></p>
                <em>{d.epi.abertas ?? 0} ocorrência(s)</em>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
