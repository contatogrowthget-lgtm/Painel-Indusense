"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Activity, ArrowUpRight, Bell, CalendarDays, Camera, CloudDownload, Droplets, Flame, RefreshCw, ShieldCheck,
  Thermometer, TriangleAlert, Wifi, Wind,
} from "lucide-react";
import { call, type ApiAlerta } from "./alerts-shared";

/**
 * Visão geral (tema escuro, grade "bento"), 100% com dados da API:
 *   GET /dashboard/summary?range=24h|7d|…  ·  GET /sensors  ·  GET /alerts
 * Gráficos desenhados em SVG próprio (sem biblioteca) para ficarem leves e animados.
 */

/* ============================================================== tipos */
type Ponto = { time: string; timestamp: string; temp: number | null; hum: number | null; air: number | null; gas: number | null };
type Metrica = { valor: number; unidade: string; status: string; sensores: number; variacaoPercentual?: number | null } | null;
type Sala = { id: string; uuid?: string; name: string; location: string; status: string; temp: number; hum: number; air: number; gas: number; last?: string };
type Summary = {
  atualizadoEm: string;
  metricas: Record<"temperatura" | "umidade" | "qualidade_ar" | "gas", Metrica>;
  dispositivos: { total: number; online: number; offline: number; lista: Sala[] };
  alertas: { ativos: number; criticos: number; atencao: number; naoLidos: number };
  epi?: { ocorrenciasHoje?: number; abertas?: number; camerasTotal?: number; camerasOnline?: number; pessoasDetectadas?: number; conformidadeMedia?: number | null } | null;
  tendencia: { bucketSegundos: number; pontos: Ponto[] };
};
type SensorApi = { id: string; codigo?: string | null; tipo: string; status: string; ativo: boolean; online?: boolean; limiteMin: number; limiteMax: number };
type Chave = "temp" | "hum" | "air" | "gas";
type Slot = { t: number; temp: number | null; hum: number | null; air: number | null; gas: number | null };

const RANGES = [
  { id: "6h", label: "Últimas 6 h", ms: 6 * 3600e3, anterior: "24h" },
  { id: "24h", label: "Hoje (24 h)", ms: 24 * 3600e3, anterior: "7d" },
  { id: "7d", label: "Últimos 7 dias", ms: 7 * 86400e3, anterior: "30d" },
  { id: "30d", label: "Últimos 30 dias", ms: 30 * 86400e3, anterior: null },
] as const;
type RangeId = (typeof RANGES)[number]["id"];

const GRANDEZA: Record<Chave, { nome: string; un: string; cor: string; tipo: string; limite: number; icone: any }> = {
  temp: { nome: "Temperatura", un: "°C", cor: "#ff8a4c", tipo: "temperatura", limite: 30, icone: Thermometer },
  hum: { nome: "Umidade", un: "%", cor: "#38bdf8", tipo: "umidade", limite: 75, icone: Droplets },
  air: { nome: "Qualidade do ar", un: "", cor: "#2dd4bf", tipo: "qualidade_ar", limite: 60, icone: Wind },
  gas: { nome: "Gases", un: "ppm", cor: "#fbbf24", tipo: "gas", limite: 40, icone: Flame },
};
const CHAVES = Object.keys(GRANDEZA) as Chave[];
const COR_STATUS: Record<string, string> = { normal: "#2dd4bf", atencao: "#fbbf24", critico: "#fb5a6e", offline: "#64748b" };

/* ============================================================== utilidades */
const fmt = (v: number | null | undefined, d = 1) =>
  v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const media = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const pct = (a: number | null, b: number | null) => (a == null || b == null || b === 0 ? null : ((a - b) / Math.abs(b)) * 100);

/** Preenche buracos (intervalos sem leitura) interpolando entre os vizinhos. */
function preencher(xs: (number | null)[]): number[] | null {
  const idx = xs.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0);
  if (!idx.length) return null;
  return xs.map((v, i) => {
    if (v != null) return v;
    let antes = -1;
    for (const j of idx) if (j < i) antes = j;
    const depois = idx.find((j) => j > i);
    if (antes < 0) return xs[depois!] as number;
    if (depois == null) return xs[antes] as number;
    const t = (i - antes) / (depois - antes);
    return (xs[antes] as number) * (1 - t) + (xs[depois] as number) * t;
  });
}

/** Curva suave (Catmull-Rom → Bézier). */
function curva(p: [number, number][]) {
  if (!p.length) return "";
  let d = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

/** Série contínua de um resumo (um ponto por intervalo, mesmo sem leitura). */
function serieDe(s: Summary | null, ms: number): Slot[] {
  if (!s) return [];
  const bucket = (s.tendencia.bucketSegundos || 3600) * 1000;
  const fim = new Date(s.atualizadoEm).getTime();
  const ini = Math.floor((fim - ms) / bucket) * bucket + bucket;
  const mapa = new Map<number, Ponto>(
    s.tendencia.pontos.map((p): [number, Ponto] => [Math.floor(new Date(p.timestamp).getTime() / bucket) * bucket, p]),
  );
  const out: Slot[] = [];
  for (let t = ini; t <= fim; t += bucket) {
    const p = mapa.get(t);
    out.push({ t, temp: p?.temp ?? null, hum: p?.hum ?? null, air: p?.air ?? null, gas: p?.gas ?? null });
  }
  return out;
}

const qualidade = (v: number | null, lim: number) =>
  v == null ? { txt: "Sem sinal", cls: "off" } : v <= lim ? { txt: "Boa", cls: "ok" } : v <= lim * 1.15 ? { txt: "Moderada", cls: "warn" } : { txt: "Ruim", cls: "bad" };

/** Número que "rola" até o valor. */
function Contador({ valor, casas = 1 }: { valor: number | null; casas?: number }) {
  const [v, setV] = useState(0);
  const de = useRef(0);
  useEffect(() => {
    if (valor == null) return;
    const ini = de.current, alvo = valor, t0 = performance.now();
    let raf = 0;
    const passo = (t: number) => {
      const k = Math.min(1, (t - t0) / 900);
      const e = 1 - Math.pow(1 - k, 3);
      setV(ini + (alvo - ini) * e);
      if (k < 1) raf = requestAnimationFrame(passo);
      else de.current = alvo;
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, [valor]);
  return <>{valor == null ? "—" : fmt(v, casas)}</>;
}

/* ============================================================== peças visuais */
function Spark({ valores, cor, altura = 64, id }: { valores: number[] | null; cor: string; altura?: number; id: string }) {
  const W = 300, H = altura;
  if (!valores || valores.length < 2) return <div className="nx-spark-vazio" style={{ height: altura }}>sem leituras ainda</div>;
  const min = Math.min(...valores), max = Math.max(...valores), amp = max - min || 1;
  const pts = valores.map((v, i): [number, number] => [(i / (valores.length - 1)) * W, H - 6 - ((v - min) / amp) * (H - 14)]);
  const linha = curva(pts);
  return (
    <svg className="nx-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: altura }}>
      <defs>
        <linearGradient id={`sp-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={cor} stopOpacity=".35" />
          <stop offset="1" stopColor={cor} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${linha} L${W},${H} L0,${H} Z`} fill={`url(#sp-${id})`} className="nx-fade" />
      <path d={linha} fill="none" stroke={cor} strokeWidth="2.2" vectorEffect="non-scaling-stroke" className="nx-draw" pathLength={1} />
    </svg>
  );
}

function Anel({ fracao, cor, tamanho = 132, espessura = 12, children, faixa, id }: {
  fracao: number; cor: string; tamanho?: number; espessura?: number; children?: ReactNode; faixa?: [number, number]; id: string;
}) {
  const r = (tamanho - espessura) / 2, c = 2 * Math.PI * r, meio = tamanho / 2;
  const f = Math.max(0, Math.min(1, fracao || 0));
  const giro = `rotate(-90 ${meio} ${meio})`;
  return (
    <div className="nx-ring" style={{ width: tamanho, height: tamanho }}>
      <svg width={tamanho} height={tamanho} viewBox={`0 0 ${tamanho} ${tamanho}`}>
        <defs>
          <linearGradient id={`rg-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={cor} />
            <stop offset="1" stopColor={cor} stopOpacity=".5" />
          </linearGradient>
          <filter id={`rb-${id}`} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="4" /></filter>
        </defs>
        <circle cx={meio} cy={meio} r={r} fill="none" stroke="#1b232d" strokeWidth={espessura} />
        {faixa && (
          <circle cx={meio} cy={meio} r={r} fill="none" stroke="#ffffff14" strokeWidth={espessura}
            strokeDasharray={`${(faixa[1] - faixa[0]) * c} ${c}`} strokeDashoffset={-faixa[0] * c} transform={giro} />
        )}
        <circle cx={meio} cy={meio} r={r} fill="none" stroke={cor} strokeOpacity=".45" strokeWidth={espessura}
          strokeDasharray={`${f * c} ${c}`} transform={giro} filter={`url(#rb-${id})`} className="nx-ring-arc" />
        <circle cx={meio} cy={meio} r={r} fill="none" stroke={`url(#rg-${id})`} strokeWidth={espessura} strokeLinecap="round"
          strokeDasharray={`${f * c} ${c}`} transform={giro} className="nx-ring-arc" />
      </svg>
      <div className="nx-ring-mid">{children}</div>
    </div>
  );
}

/** Objeto 3D (fita de luz girando) com a cor do status geral. */
function Orbe({ cor, rapido }: { cor: string; rapido?: boolean }) {
  const aneis = Array.from({ length: 26 }, (_, i) => i);
  return (
    <div className={"nx-orb" + (rapido ? " fast" : "")} style={{ ["--orb" as any]: cor }}>
      <div className="nx-orb-glow" />
      <div className="nx-orb-3d">
        <svg viewBox="0 0 200 200">
          <defs>
            <linearGradient id="orbg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ffffff" stopOpacity=".95" />
              <stop offset=".35" stopColor={cor} />
              <stop offset="1" stopColor={cor} stopOpacity=".05" />
            </linearGradient>
          </defs>
          {aneis.map((i) => (
            <ellipse key={i} cx="100" cy="100" rx={78 - (i % 3) * 3} ry={30 + (i % 4) * 2} fill="none" stroke="url(#orbg)"
              strokeWidth={i % 5 === 0 ? 1.8 : 0.9} strokeOpacity={0.25 + (i % 6) * 0.11} transform={`rotate(${i * 6.9} 100 100)`} />
          ))}
        </svg>
      </div>
      <div className="nx-orb-3d b">
        <svg viewBox="0 0 200 200">
          {aneis.slice(0, 12).map((i) => (
            <ellipse key={i} cx="100" cy="100" rx="64" ry="20" fill="none" stroke={cor} strokeOpacity={0.18 + (i % 4) * 0.08}
              strokeWidth=".8" transform={`rotate(${i * 15} 100 100)`} />
          ))}
        </svg>
      </div>
      <div className="nx-orb-core" />
    </div>
  );
}

function Card({ classe = "", titulo, sub, acoes, children, onAbrir, onAlertas }: {
  classe?: string; titulo: string; sub?: string; acoes?: ReactNode; children: ReactNode; onAbrir?: () => void; onAlertas?: () => void;
}) {
  return (
    <section className={"nx-card " + classe}>
      <header className="nx-card-head">
        <div>
          {sub && <span className="nx-sub">{sub}</span>}
          <h3>{titulo}</h3>
        </div>
        <div className="nx-card-btns">
          {acoes}
          {onAlertas && <button title="Ver alertas" onClick={onAlertas}><Bell size={14} /></button>}
          {onAbrir && <button title="Abrir" onClick={onAbrir}><ArrowUpRight size={14} /></button>}
        </div>
      </header>
      {children}
    </section>
  );
}

function Variacao({ v, ruimSeSobe = false, sufixo = "vs ontem" }: { v: number | null; ruimSeSobe?: boolean; sufixo?: string }) {
  if (v == null || !Number.isFinite(v)) return <span className="nx-var neutro">sem comparação ainda</span>;
  const ruim = ruimSeSobe ? v > 0.5 : v < -0.5;
  return (
    <span className={"nx-var " + (Math.abs(v) <= 0.5 ? "neutro" : ruim ? "ruim" : "bom")}>
      {v > 0 ? "↗" : v < 0 ? "↘" : "→"} {fmt(Math.abs(v))}% <em>{sufixo}</em>
    </span>
  );
}

/* ============================================================== gráfico principal */
function Linha({ atual, anterior, rotulos, cor, limite, un }: {
  atual: (number | null)[]; anterior: (number | null)[]; rotulos: string[]; cor: string; limite?: number; un: string;
}) {
  const W = 900, H = 280, PAD = { l: 44, r: 16, t: 18, b: 30 };
  const caixa = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const a = preencher(atual), b = preencher(anterior);
  if (!a) return <div className="nx-vazio">Sem leituras neste período. Ligue o ESP32 e aguarde alguns minutos.</div>;
  const todos = [...a, ...(b ?? []), ...(limite != null ? [limite] : [])];
  let min = Math.min(...todos), max = Math.max(...todos);
  const folga = (max - min) * 0.15 || 2;
  min -= folga;
  max += folga;
  const x = (i: number) => PAD.l + (i / Math.max(1, a.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - min) / (max - min)) * (H - PAD.t - PAD.b);
  const pa = a.map((v, i): [number, number] => [x(i), y(v)]);
  const pb = b ? b.map((v, i): [number, number] => [x(i), y(v)]) : null;
  const linha = curva(pa);
  const grade = Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4);
  const passo = Math.max(1, Math.ceil(rotulos.length / 7));

  function mover(e: { clientX: number }) {
    const r = caixa.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (a!.length - 1));
    setHover(Math.max(0, Math.min(a!.length - 1, i)));
  }

  return (
    <div className="nx-line" ref={caixa} onMouseMove={mover} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`}>
        <defs>
          <linearGradient id="ln-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={cor} stopOpacity=".38" />
            <stop offset=".7" stopColor={cor} stopOpacity=".06" />
            <stop offset="1" stopColor={cor} stopOpacity="0" />
          </linearGradient>
          <filter id="ln-glow" x="-5%" y="-30%" width="110%" height="160%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {grade.map((g, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(g)} y2={y(g)} stroke="#ffffff0f" strokeDasharray="3 6" />
            <text x={PAD.l - 10} y={y(g) + 4} textAnchor="end" className="nx-axis">{fmt(g, 0)}</text>
          </g>
        ))}
        {rotulos.map((r, i) => (i % passo === 0 || i === rotulos.length - 1) && (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="nx-axis">{r}</text>
        ))}
        {limite != null && limite > min && limite < max && (
          <g>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(limite)} y2={y(limite)} stroke="#fb5a6e" strokeOpacity=".75" strokeDasharray="6 6" />
            <text x={W - PAD.r} y={y(limite) - 7} textAnchor="end" className="nx-axis lim">limite {fmt(limite, 0)}</text>
          </g>
        )}
        {pb && <path d={curva(pb)} fill="none" stroke="#8796a6" strokeOpacity=".6" strokeWidth="2" strokeDasharray="5 6" />}
        <path d={`${linha} L${x(a.length - 1)},${H - PAD.b} L${x(0)},${H - PAD.b} Z`} fill="url(#ln-area)" className="nx-fade" />
        <path d={linha} fill="none" stroke={cor} strokeWidth="3" filter="url(#ln-glow)" className="nx-draw" pathLength={1} />
        <circle cx={pa[pa.length - 1][0]} cy={pa[pa.length - 1][1]} r="10" fill={cor} className="nx-ping" />
        <circle cx={pa[pa.length - 1][0]} cy={pa[pa.length - 1][1]} r="5" fill={cor} />
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="#ffffff33" />
            {b && <circle cx={x(hover)} cy={y(b[hover])} r="4" fill="#8796a6" />}
            <circle cx={x(hover)} cy={y(a[hover])} r="6" fill="#0b1016" stroke={cor} strokeWidth="3" />
          </g>
        )}
      </svg>
      {hover != null && (
        <div className="nx-tip" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(a[hover]) / H) * 100}%` }}>
          <b>{fmt(atual[hover] ?? a[hover])} {un}</b>
          {b && <span>anterior {fmt(anterior[hover] ?? b[hover])} {un}</span>}
          <em>{rotulos[hover]}{atual[hover] == null ? " · estimado" : ""}</em>
        </div>
      )}
    </div>
  );
}

/* ============================================================== página */
export default function DashboardHome({ onNavigate }: { onNavigate?: (pagina: string) => void }) {
  const router = useRouter();
  const ir = (p: string) => onNavigate?.(p);
  const verSala = (codigo: string) => router.push(`/dashboard/monitoramento/${encodeURIComponent(codigo)}`);

  const [range, setRange] = useState<RangeId>("24h");
  const [grandeza, setGrandeza] = useState<Chave>("temp");
  const [horaSel, setHoraSel] = useState<number | null>(null);
  const [s24, setS24] = useState<Summary | null>(null);
  const [s7, setS7] = useState<Summary | null>(null);
  const [sSel, setSSel] = useState<Summary | null>(null);
  const [sAnt, setSAnt] = useState<Summary | null>(null);
  const [sensores, setSensores] = useState<SensorApi[]>([]);
  const [alertas, setAlertas] = useState<ApiAlerta[]>([]);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);
  const R = RANGES.find((r) => r.id === range)!;

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const pedidos = new Map<string, Promise<Summary | null>>();
      for (const r of ["24h", "7d", R.id, R.anterior]) {
        if (r && !pedidos.has(r)) pedidos.set(r, call<Summary>(`/dashboard/summary?range=${r}`).catch(() => null));
      }
      const [ss, al] = await Promise.all([
        call<SensorApi[]>("/sensors").catch(() => [] as SensorApi[]),
        call<ApiAlerta[]>("/alerts?limit=500").catch(() => [] as ApiAlerta[]),
      ]);
      const r24 = await pedidos.get("24h")!;
      if (!r24) throw new Error("Não foi possível falar com a API. Ela pode estar acordando; tente de novo em alguns segundos.");
      setS24(r24);
      setS7(await pedidos.get("7d")!);
      setSSel(await pedidos.get(R.id)!);
      setSAnt(R.anterior ? await pedidos.get(R.anterior)! : null);
      setSensores(ss.filter((s) => s.ativo !== false));
      setAlertas(al);
      setErro("");
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, [R.id, R.anterior]);

  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 30_000);
    return () => clearInterval(t);
  }, [carregar]);

  /* ---------------- números derivados */
  const m = s24?.metricas;
  const lim = (k: Chave) => sensores.find((s) => s.tipo === GRANDEZA[k].tipo)?.limiteMax ?? GRANDEZA[k].limite;
  const serie24 = useMemo(() => serieDe(s24, 24 * 3600e3), [s24]);
  const serie7 = useMemo(() => serieDe(s7, 7 * 86400e3), [s7]);

  const diaDe = (t: number) => new Date(t).toDateString();
  const hojeStr = new Date().toDateString();
  const ontemStr = new Date(Date.now() - 86400e3).toDateString();
  const doDia = (k: Chave, dia: string) => media(serie7.filter((p) => diaDe(p.t) === dia).map((p) => p[k]));
  const vsOntem = (k: Chave) => pct(doDia(k, hojeStr) ?? media(serie24.map((p) => p[k])), doDia(k, ontemStr));

  const semana = useMemo(() => {
    const dias = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400e3);
      const ds = d.toDateString();
      dias.push({
        rotulo: d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", ""),
        valor: media(serie7.filter((p) => diaDe(p.t) === ds).map((p) => p.gas)),
        hoje: i === 0,
      });
    }
    return dias;
  }, [serie7]);
  const maxSemana = Math.max(lim("gas"), ...semana.map((d) => d.valor ?? 0));

  const on = sensores.filter((s) => s.online !== false && s.status !== "offline");
  const statusGeral = on.some((s) => s.status === "critico") ? "critico" : on.some((s) => s.status === "atencao") ? "atencao" : on.length ? "normal" : "offline";
  const rotuloStatus = { normal: "Tudo dentro dos limites", atencao: "Atenção em algum sensor", critico: "Situação crítica", offline: "Nenhum sensor enviando" }[statusGeral];

  const qa = qualidade(m?.qualidade_ar?.valor ?? null, lim("air"));
  const temp24 = serie24.map((p) => p.temp);
  const tVals = temp24.filter((v): v is number => v != null);
  const tMin = tVals.length ? Math.min(...tVals) : null;
  const tMax = tVals.length ? Math.max(...tVals) : null;

  const umid = m?.umidade?.valor ?? null;
  const limU = sensores.find((s) => s.tipo === "umidade");
  const faixaU: [number, number] = [(limU?.limiteMin ?? 30) / 100, (limU?.limiteMax ?? 75) / 100];
  const umidOk = umid != null && umid >= faixaU[0] * 100 && umid <= faixaU[1] * 100;

  const disp = sensores.length ? on.length / sensores.length : 0;

  const serieSel = useMemo(() => serieDe(sSel, R.ms), [sSel, R.ms]);
  const anteriorAlinhado = useMemo(() => {
    const out: (number | null)[] = serieSel.map(() => null);
    if (!sAnt || !serieSel.length) return out;
    const passo = serieSel.length > 1 ? serieSel[1].t - serieSel[0].t : 3600e3;
    for (const p of sAnt.tendencia.pontos) {
      const ts = new Date(p.timestamp).getTime() + R.ms;
      const i = Math.round((ts - serieSel[0].t) / passo);
      if (i >= 0 && i < out.length) out[i] = p[grandeza];
    }
    return out;
  }, [sAnt, serieSel, grandeza, R.ms]);
  const rotulos = serieSel.map((p) => {
    const d = new Date(p.t);
    return R.ms > 36 * 3600e3
      ? d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
      : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  });
  const mediaSel = media(serieSel.map((p) => p[grandeza]));
  const mediaAnt = media(anteriorAlinhado);

  const recentes = [...alertas]
    .filter((a) => a.severidade !== "offline")
    .sort((a, b) => Number(a.resolvido) - Number(b.resolvido) || +new Date(b.dataHora) - +new Date(a.dataHora))
    .slice(0, 5);
  const nomeTipo = (t: string) => GRANDEZA[CHAVES.find((k) => GRANDEZA[k].tipo === t) ?? "temp"].nome;

  const epi = s24?.epi;
  const conf = epi?.conformidadeMedia ?? null;

  function exportar() {
    const linhas = [["inicio_intervalo", "temperatura_c", "umidade_pct", "qualidade_ar_indice", "gas_ppm"]];
    for (const p of serieSel) linhas.push([new Date(p.t).toISOString(), String(p.temp ?? ""), String(p.hum ?? ""), String(p.air ?? ""), String(p.gas ?? "")]);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + linhas.map((l) => l.join(";")).join("\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `indusense-${range}.csv`;
    a.click();
  }

  const G = GRANDEZA[grandeza];

  return (
    <div className="nx">
      <div className="nx-top">
        <div>
          <div className="nx-crumb"><Activity size={13} /> Painel <b>›</b> Visão geral</div>
          <h1>Visão geral</h1>
          <p>
            {s24
              ? <>Atualizado às {new Date(s24.atualizadoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} · {on.length} de {sensores.length} sensores ao vivo</>
              : "Conectando à API…"}
          </p>
        </div>
        <div className="nx-top-actions">
          <label className="nx-select">
            <CalendarDays size={15} />
            <select value={range} onChange={(e) => setRange(e.target.value as RangeId)}>
              {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </label>
          <button className="nx-btn icon" onClick={carregar} title="Atualizar"><RefreshCw size={15} className={carregando ? "spin" : ""} /></button>
          <button className="nx-btn" onClick={exportar} disabled={!serieSel.length}><CloudDownload size={15} /> Exportar</button>
        </div>
      </div>

      {erro && !s24 && <div className="nx-erro">{erro} <button onClick={carregar}>Tentar de novo</button></div>}
      {!s24 && !erro && (
        <div className="nx-grid">
          {["c6", "c3", "c3", "c4", "c4", "c4"].map((c, i) => <div key={i} className={"nx-card nx-skel " + c} />)}
        </div>
      )}

      {s24 && (
        <div className="nx-grid">
          {/* 1. ambiente agora */}
          <Card classe="c6 hero" sub="Agora" titulo="Ambiente da planta" onAlertas={() => ir("Alertas")} onAbrir={() => ir("Monitoramento")}>
            <div className="nx-hero">
              <div className="nx-hero-info">
                <div className="nx-big"><Contador valor={m?.temperatura?.valor ?? null} /><small>°C</small></div>
                <div className="nx-mini-kpis">
                  <div><small>Umidade</small><b>{fmt(umid, 0)}%</b></div>
                  <div><small>Ar</small><b className={"q-" + qa.cls}>{qa.txt}</b></div>
                  <div><small>Alertas</small><b className={s24.alertas.ativos ? "txt-bad" : ""}>{s24.alertas.ativos}</b></div>
                </div>
                <Variacao v={vsOntem("temp")} ruimSeSobe />
                <div className={"nx-status " + statusGeral}><i />{rotuloStatus}</div>
              </div>
              <Orbe cor={COR_STATUS[statusGeral]} rapido={statusGeral === "critico"} />
            </div>
            <Spark id="hero" valores={preencher(temp24)} cor={GRANDEZA.temp.cor} altura={54} />
          </Card>

          {/* 2. qualidade do ar */}
          <Card classe="c3" sub="Últimas 24 h" titulo="Qualidade do ar" onAbrir={() => ir("Relatórios")}>
            <div className={"nx-quality q-" + qa.cls}>{qa.txt}</div>
            <div className="nx-line2">
              <span>índice <b>{fmt(m?.qualidade_ar?.valor ?? null, 0)}</b> · limite {lim("air")}</span>
            </div>
            <Variacao v={vsOntem("air")} ruimSeSobe />
            <Spark id="ar" valores={preencher(serie24.map((p) => p.air))} cor={GRANDEZA.air.cor} altura={84} />
          </Card>

          {/* 3. gases na semana */}
          <Card classe="c3" sub="Últimos 7 dias" titulo="Gases (MQ-2)" onAlertas={() => ir("Alertas")}>
            <div className="nx-big sm"><Contador valor={m?.gas?.valor ?? null} casas={0} /><small>ppm agora</small></div>
            <Variacao v={vsOntem("gas")} ruimSeSobe />
            <div className="nx-week">
              {semana.map((d, i) => {
                const h = d.valor == null ? 7 : Math.max(12, (d.valor / maxSemana) * 100);
                const alto = d.valor != null && d.valor > lim("gas");
                return (
                  <div key={i} className={"nx-week-col" + (d.hoje ? " hoje" : "") + (alto ? " alto" : "") + (d.valor == null ? " vazio" : "")}>
                    <div className="nx-week-bar">
                      <span style={{ height: `${h}%`, animationDelay: `${i * 70}ms` }} />
                      {d.valor != null && <em>{fmt(d.valor, 0)}</em>}
                    </div>
                    <small>{d.rotulo}</small>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* 4. temperatura hora a hora */}
          <Card classe="c4" sub="Últimas 24 h · passe o mouse nas barras" titulo="Temperatura hora a hora">
            {(() => {
              const n = serie24.length;
              const sel = horaSel != null && horaSel < n ? horaSel : n - 1;
              const p = serie24[sel];
              const frac = n > 1 ? sel / (n - 1) : 1;
              const hora = (t: number) => new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
              return (
                <>
                  <div className="nx-big sm">
                    {horaSel == null ? <Contador valor={m?.temperatura?.valor ?? null} /> : fmt(p?.temp ?? null)}
                    <small>°C {horaSel == null ? "agora" : `às ${p ? hora(p.t) : ""}`}</small>
                  </div>
                  <div className="nx-hours" onMouseLeave={() => setHoraSel(null)}>
                    {serie24.map((q, i) => {
                      const v = q.temp;
                      const h = v == null || tMin == null || tMax == null ? 6 : 18 + ((v - tMin) / (tMax - tMin || 1)) * 82;
                      return (
                        <span key={i} onMouseEnter={() => setHoraSel(i)}
                          className={(v == null ? "vazio" : v > lim("temp") ? "quente" : "") + (i === sel ? " sel" : "")}
                          style={{ height: `${h}%`, animationDelay: `${i * 20}ms` }} />
                      );
                    })}
                  </div>
                  <div className="nx-slider">
                    <div className="nx-slider-fill" style={{ width: `${frac * 100}%` }} />
                    <div className="nx-slider-knob" style={{ left: `${frac * 100}%` }} />
                  </div>
                  <div className="nx-slider-labels">
                    {[0, 0.25, 0.5, 0.75].map((f) => <span key={f}>{n ? hora(serie24[Math.round(f * (n - 1))].t) : ""}</span>)}
                    <span>agora</span>
                  </div>
                </>
              );
            })()}
            <div className="nx-line2"><span>mín <b>{fmt(tMin)}°</b></span><span>máx <b>{fmt(tMax)}°</b></span><span>limite <b>{lim("temp")}°</b></span></div>
          </Card>

          {/* 5. umidade */}
          <Card classe="c4" sub="Faixa ideal" titulo="Umidade relativa">
            <div className="nx-ring-row">
              <Anel id="umid" fracao={(umid ?? 0) / 100} cor={umidOk ? GRANDEZA.hum.cor : "#fbbf24"} faixa={faixaU}>
                <b><Contador valor={umid} casas={0} />%</b>
                <small>{umid == null ? "sem sinal" : umidOk ? "ideal" : "fora da faixa"}</small>
              </Anel>
              <div className="nx-ring-side">
                <b>{fmt(faixaU[0] * 100, 0)}–{fmt(faixaU[1] * 100, 0)}%</b>
                <small>faixa permitida</small>
                <Variacao v={vsOntem("hum")} />
              </div>
            </div>
          </Card>

          {/* 6. sensores ao vivo */}
          <Card classe="c4" sub="Conectividade" titulo="Sensores ao vivo" onAbrir={() => ir("Sensores")}>
            <div className="nx-ring-row">
              <Anel id="disp" fracao={disp} cor={disp >= 1 ? "#2dd4bf" : disp > 0 ? "#fbbf24" : "#fb5a6e"}>
                <b>{fmt(disp * 100, 0)}%</b>
                <small>online</small>
              </Anel>
              <div className="nx-ring-side">
                <b>{on.length} de {sensores.length}</b>
                <small>sensores mandando dados</small>
                <span className={"nx-var " + (sensores.length - on.length ? "ruim" : "bom")}>
                  <Wifi size={12} /> {sensores.length - on.length ? `${sensores.length - on.length} sem sinal` : "todos conectados"}
                </span>
              </div>
            </div>
          </Card>

          {/* 7. linha do tempo */}
          <Card classe="c8" sub={R.label} titulo="Linha do tempo"
            acoes={
              <div className="nx-tabs">
                {CHAVES.map((k) => {
                  const I = GRANDEZA[k].icone;
                  return (
                    <button key={k} className={grandeza === k ? "on" : ""} style={{ ["--c" as any]: GRANDEZA[k].cor }} onClick={() => setGrandeza(k)}>
                      <I size={13} /> <span>{GRANDEZA[k].nome}</span>
                    </button>
                  );
                })}
              </div>
            }>
            <div className="nx-line-head">
              <div className="nx-big sm" style={{ color: G.cor }}>
                {fmt(mediaSel, grandeza === "gas" || grandeza === "air" ? 0 : 1)}<small>{G.un || "índice"} · média</small>
              </div>
              {R.anterior && <Variacao v={pct(mediaSel, mediaAnt)} ruimSeSobe={grandeza !== "hum"} sufixo="vs período anterior" />}
              <div className="nx-legend">
                <span><i style={{ background: G.cor }} />Atual</span>
                {R.anterior && <span><i className="dash" />Anterior</span>}
                <span><i className="lim" />Limite</span>
              </div>
            </div>
            <Linha key={grandeza + range} atual={serieSel.map((p) => p[grandeza])} anterior={anteriorAlinhado} rotulos={rotulos} cor={G.cor} limite={lim(grandeza)} un={G.un} />
          </Card>

          {/* 8. alertas recentes */}
          <Card classe="c4" sub={`${s24.alertas.ativos} ativo(s) · ${s24.alertas.criticos} crítico(s)`} titulo="Alertas recentes" onAbrir={() => ir("Alertas")}>
            <div className="nx-alerts">
              {recentes.length === 0 && (
                <div className="nx-ok"><ShieldCheck size={30} /><b>Nenhum alerta</b><small>Todos os sensores dentro dos limites.</small></div>
              )}
              {recentes.map((a, i) => (
                <button key={a.id} style={{ animationDelay: `${i * 60}ms` }} className={"nx-alert " + (a.resolvido ? "res" : a.severidade)}
                  onClick={() => (a.salaCodigo ? verSala(a.salaCodigo) : ir("Alertas"))}>
                  <span className="nx-alert-ic"><TriangleAlert size={14} /></span>
                  <p>
                    <b>{nomeTipo(a.tipo)} {a.valorMedido > a.limite ? "acima" : "abaixo"} do limite</b>
                    <small>{a.salaNome ?? "Sala"} · {new Date(a.dataHora).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}{a.resolvido ? " · resolvido" : ""}</small>
                  </p>
                  <em>{fmt(a.valorMedido, a.tipo === "gas" || a.tipo === "qualidade_ar" ? 0 : 1)}</em>
                </button>
              ))}
            </div>
          </Card>

          {/* 9. salas */}
          <Card classe="c7" sub={`${s24.dispositivos.online} de ${s24.dispositivos.total} online`} titulo="Salas monitoradas" onAbrir={() => ir("Monitoramento")}>
            <div className="nx-rooms">
              {s24.dispositivos.lista.length === 0 && <div className="nx-ok"><b>Nenhuma sala cadastrada</b></div>}
              {s24.dispositivos.lista.map((s) => (
                <button key={s.id} className="nx-room" onClick={() => verSala(s.id)}>
                  <span className={"nx-dot " + (s.status === "online" ? "on" : "off")} />
                  <p><b>{s.name}</b><small>{s.id} · {s.status === "online" ? s.last ?? "online" : "sem sinal"}</small></p>
                  {s.status === "online" ? (
                    <div className="nx-chips">
                      <span style={{ ["--c" as any]: GRANDEZA.temp.cor }}>{fmt(s.temp)}°</span>
                      <span style={{ ["--c" as any]: GRANDEZA.hum.cor }}>{fmt(s.hum, 0)}%</span>
                      <span style={{ ["--c" as any]: GRANDEZA.air.cor }}>Ar {qualidade(s.air, lim("air")).txt.toLowerCase()}</span>
                      <span style={{ ["--c" as any]: GRANDEZA.gas.cor }}>{fmt(s.gas, 0)} ppm</span>
                    </div>
                  ) : <div className="nx-chips"><span className="off">offline</span></div>}
                  <ArrowUpRight size={15} className="nx-room-go" />
                </button>
              ))}
            </div>
          </Card>

          {/* 10. câmeras e EPI */}
          <Card classe="c5" sub="Visão computacional" titulo="Câmeras e EPI" onAbrir={() => ir("Monitoramento")}>
            {!epi || !(epi.camerasTotal ?? 0) ? (
              <div className="nx-ok"><Camera size={30} /><b>Nenhuma câmera ligada</b><small>Ligue o sistema de câmera para acompanhar o uso de EPI.</small></div>
            ) : (
              <div className="nx-ring-row">
                <Anel id="epi" tamanho={120} fracao={(conf ?? 0) / 100} cor={(conf ?? 0) >= 90 ? "#2dd4bf" : (conf ?? 0) >= 70 ? "#fbbf24" : "#fb5a6e"}>
                  <b>{conf == null ? "—" : `${conf}%`}</b>
                  <small>com EPI</small>
                </Anel>
                <div className="nx-epi">
                  <div><small>Câmeras</small><b>{epi.camerasOnline ?? 0}/{epi.camerasTotal}</b></div>
                  <div><small>Pessoas agora</small><b>{epi.pessoasDetectadas ?? 0}</b></div>
                  <div><small>Ocorrências hoje</small><b>{epi.ocorrenciasHoje ?? 0}</b></div>
                  <div><small>Em aberto</small><b className={(epi.abertas ?? 0) ? "txt-bad" : ""}>{epi.abertas ?? 0}</b></div>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
