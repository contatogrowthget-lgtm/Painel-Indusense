"use client";

import { useMemo, useState } from "react";
import { Droplets, Flame, Thermometer, Wind } from "lucide-react";
import { Anel, Linha, Spark, fmt, media, preencher } from "./nx-charts";

/** Gráficos da sala: um cartão por grandeza (clicável) + gráfico grande da escolhida. */

type Chave = "temp" | "hum" | "air" | "gas";
type SensorLim = { tipo: string; limiteMin: number; limiteMax: number; valorAtual?: number; status?: string; online?: boolean };

const G: Record<Chave, { nome: string; un: string; cor: string; tipo: string; icone: any; casas: number; padrao: [number, number] }> = {
  temp: { nome: "Temperatura", un: "°C", cor: "#ff8a4c", tipo: "temperatura", icone: Thermometer, casas: 1, padrao: [18, 30] },
  hum: { nome: "Umidade", un: "%", cor: "#38bdf8", tipo: "umidade", icone: Droplets, casas: 0, padrao: [30, 75] },
  air: { nome: "Qualidade do ar", un: "", cor: "#2dd4bf", tipo: "qualidade_ar", icone: Wind, casas: 0, padrao: [0, 60] },
  gas: { nome: "Gases", un: "ppm", cor: "#fbbf24", tipo: "gas", icone: Flame, casas: 0, padrao: [0, 40] },
};
const CHAVES = Object.keys(G) as Chave[];
const RANGES = [["6h", "6 h"], ["24h", "24 h"], ["7d", "7 dias"], ["30d", "30 dias"]] as const;

const qualidade = (v: number | null, lim: number) =>
  v == null ? "Sem sinal" : v <= lim ? "Boa" : v <= lim * 1.15 ? "Moderada" : "Ruim";

export default function RoomCharts({ pontos, range, setRange, sensores }: {
  pontos: any[]; range: string; setRange: (r: string) => void; sensores: SensorLim[];
}) {
  const [sel, setSel] = useState<Chave>("temp");

  const lim = (k: Chave): [number, number] => {
    const s = sensores.find((x) => x.tipo === G[k].tipo);
    return s ? [s.limiteMin, s.limiteMax] : G[k].padrao;
  };

  const rotulos = useMemo(() => pontos.map((p) => {
    if (p.timestamp) {
      const d = new Date(p.timestamp);
      return range === "7d" || range === "30d"
        ? d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + (range === "7d" ? ` ${String(d.getHours()).padStart(2, "0")}h` : "")
        : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    }
    return p.time ?? "";
  }), [pontos, range]);

  const dados = useMemo(() => {
    const out = {} as Record<Chave, { serie: (number | null)[]; ultimo: number | null; min: number | null; max: number | null; med: number | null; dentro: number | null }>;
    for (const k of CHAVES) {
      const serie = pontos.map((p) => (p[k] == null ? null : Number(p[k])));
      const vals = serie.filter((v): v is number => v != null);
      const [lo, hi] = lim(k);
      out[k] = {
        serie,
        ultimo: vals.length ? vals[vals.length - 1] : null,
        min: vals.length ? Math.min(...vals) : null,
        max: vals.length ? Math.max(...vals) : null,
        med: media(vals),
        dentro: vals.length ? vals.filter((v) => v >= lo && v <= hi).length / vals.length : null,
      };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pontos, sensores]);

  const S = G[sel];
  const D = dados[sel];
  const [lo, hi] = lim(sel);
  const atualSensor = sensores.find((x) => x.tipo === S.tipo);
  const agora = atualSensor?.online !== false && atualSensor?.valorAtual != null ? atualSensor.valorAtual : D.ultimo;
  const valorTxt = (k: Chave, v: number | null) => (k === "air" ? qualidade(v, lim(k)[1]) : fmt(v, G[k].casas));

  return (
    <section className="room-panel rc">
      <div className="rc-head">
        <div>
          <h2>Acompanhamento ambiental</h2>
          <p>Toque numa grandeza para ver o gráfico dela. Passe o mouse no gráfico para ver cada leitura.</p>
        </div>
        <div className="rc-range">
          {RANGES.map(([id, nome]) => (
            <button key={id} className={range === id ? "on" : ""} onClick={() => setRange(id)}>{nome}</button>
          ))}
        </div>
      </div>

      <div className="rc-tiles">
        {CHAVES.map((k, i) => {
          const I = G[k].icone;
          const d = dados[k];
          const s = sensores.find((x) => x.tipo === G[k].tipo);
          const v = s?.online !== false && s?.valorAtual != null ? s.valorAtual : d.ultimo;
          const fora = v != null && (v > lim(k)[1] || v < lim(k)[0]);
          return (
            <button key={k} className={"rc-tile" + (sel === k ? " on" : "") + (fora ? " fora" : "")} style={{ ["--c" as any]: G[k].cor, animationDelay: `${i * 60}ms` }} onClick={() => setSel(k)}>
              <div className="rc-tile-top">
                <span className="rc-ic"><I size={16} /></span>
                <small>{G[k].nome}</small>
                {fora && <em>fora do limite</em>}
              </div>
              <div className="rc-tile-val">
                {valorTxt(k, v)}<small>{k === "air" ? (v != null ? ` · ${fmt(v, 0)}` : "") : ` ${G[k].un}`}</small>
              </div>
              <Spark id={`rc-${k}`} valores={preencher(d.serie)} cor={G[k].cor} altura={38} />
            </button>
          );
        })}
      </div>

      <div className="rc-main">
        <div className="rc-chart">
          <div className="rc-chart-head" style={{ ["--c" as any]: S.cor }}>
            <b>{S.nome}</b>
            <span><i className="lin" />Leituras</span>
            <span><i className="max" />Máximo {fmt(hi, 0)}{S.un && ` ${S.un}`}</span>
            {lo > 0 && <span><i className="min" />Mínimo {fmt(lo, 0)}{S.un && ` ${S.un}`}</span>}
          </div>
          <Linha key={sel + range} atual={D.serie} rotulos={rotulos} cor={S.cor} limite={hi} limiteMin={lo > 0 ? lo : undefined} un={S.un} altura={300} />
        </div>
        <aside className="rc-side" style={{ ["--c" as any]: S.cor }}>
          <Anel id={`rc-anel-${sel}`} fracao={D.dentro ?? 0} cor={D.dentro == null ? "#3b4652" : D.dentro >= 0.95 ? "#34d399" : D.dentro >= 0.8 ? "#fbbf24" : "#fb5a6e"} tamanho={128} espessura={11}>
            <b>{D.dentro == null ? "—" : `${fmt(D.dentro * 100, 0)}%`}</b>
            <small>dentro do limite</small>
          </Anel>
          <div className="rc-stats">
            <div><small>Agora</small><b style={{ color: S.cor }}>{valorTxt(sel, agora)}</b></div>
            <div><small>Média</small><b>{fmt(D.med, S.casas)}</b></div>
            <div><small>Mínima</small><b>{fmt(D.min, S.casas)}</b></div>
            <div><small>Máxima</small><b>{fmt(D.max, S.casas)}</b></div>
          </div>
        </aside>
      </div>
    </section>
  );
}
