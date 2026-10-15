"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Peças de gráfico em SVG usadas na Visão geral e na página da sala. */

export const fmt = (v: number | null | undefined, d = 1) =>
  v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
export const media = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/** Preenche buracos (intervalos sem leitura) interpolando entre os vizinhos. */
export function preencher(xs: (number | null)[]): number[] | null {
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
export function curva(p: [number, number][]) {
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

/** Número que "rola" até o valor. */
export function Contador({ valor, casas = 1 }: { valor: number | null; casas?: number }) {
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

export function Spark({ valores, cor, altura = 64, id }: { valores: number[] | null; cor: string; altura?: number; id: string }) {
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

export function Anel({ fracao, cor, tamanho = 132, espessura = 12, children, faixa, id }: {
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

export function Linha({ atual, anterior = [], rotulos, cor, limite, limiteMin, un, altura = 280 }: {
  atual: (number | null)[]; anterior?: (number | null)[]; rotulos: string[]; cor: string; limite?: number; limiteMin?: number; un: string; altura?: number;
}) {
  const W = 900, H = altura, PAD = { l: 44, r: 16, t: 18, b: 30 };
  const caixa = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const uid = useRef("l" + Math.random().toString(36).slice(2, 7)).current;
  const a = preencher(atual), b = preencher(anterior);
  if (!a) return <div className="nx-vazio">Sem leituras neste período. Ligue o ESP32 e aguarde alguns minutos.</div>;
  const todos = [...a, ...(b ?? []), ...(limite != null ? [limite] : []), ...(limiteMin != null && limiteMin > 0 ? [limiteMin] : [])];
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
          <linearGradient id={`${uid}-area`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={cor} stopOpacity=".38" />
            <stop offset=".7" stopColor={cor} stopOpacity=".06" />
            <stop offset="1" stopColor={cor} stopOpacity="0" />
          </linearGradient>
          <filter id={`${uid}-glow`} x="-5%" y="-30%" width="110%" height="160%">
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
        {limiteMin != null && limiteMin > min && limiteMin < max && (
          <g>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(limiteMin)} y2={y(limiteMin)} stroke="#38bdf8" strokeOpacity=".6" strokeDasharray="6 6" />
            <text x={W - PAD.r} y={y(limiteMin) + 15} textAnchor="end" className="nx-axis">mínimo {fmt(limiteMin, 0)}</text>
          </g>
        )}
        {pb && <path d={curva(pb)} fill="none" stroke="#8796a6" strokeOpacity=".6" strokeWidth="2" strokeDasharray="5 6" />}
        <path d={`${linha} L${x(a.length - 1)},${H - PAD.b} L${x(0)},${H - PAD.b} Z`} fill={`url(#${uid}-area)`} className="nx-fade" />
        <path d={linha} fill="none" stroke={cor} strokeWidth="3" filter={`url(#${uid}-glow)`} className="nx-draw" pathLength={1} />
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

