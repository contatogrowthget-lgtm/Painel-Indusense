"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AirVent, AlarmClock, CheckCircle2, ShieldAlert, Thermometer, Waves } from "lucide-react";
import { anunciarAtivos, call, duracao, fmtNum, tituloAlerta, unidade, type ApiAlerta } from "./alerts-shared";

/**
 * Fica ligado em todas as telas do painel. A cada 15 s busca os alertas abertos e,
 * quando algum valor sai do limite, mostra um aviso grande na tela:
 *   "OK, estou ciente"   -> marca como lido; só volta se piorar ou se acontecer de novo
 *   "Me lembre em 15 min" -> some agora e reaparece em 15 min se ainda estiver fora
 * Quando a leitura volta ao normal, a API resolve o alerta sozinha e o aviso fecha.
 */

const SNOOZE_KEY = "indusense_alert_snooze";
const SEEN_KEY = "indusense_alert_seen";
const SONECA_MIN = 15;
const POLL_MS = 15_000;

function ler<T>(k: string, padrao: T): T {
  try { return JSON.parse(localStorage.getItem(k) || "null") ?? padrao; } catch { return padrao; }
}
function gravar(k: string, v: unknown) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ }
}
const chave = (a: ApiAlerta) => `${a.id}:${a.severidade}`;

function bipe(critico: boolean) {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx();
    (critico ? [0, 0.25, 0.5] : [0, 0.3]).forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.value = critico ? 960 : 740;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.2);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.22);
    });
  } catch { /* navegador bloqueou o som até o primeiro clique */ }
}

const ICONE: Record<string, any> = { temperatura: Thermometer, umidade: Waves, qualidade_ar: AirVent, gas: ShieldAlert };

export default function AlertWatcher() {
  const router = useRouter();
  const onVerSala = (codigo: string) => router.push(`/dashboard/monitoramento/${encodeURIComponent(codigo)}`);
  const [atual, setAtual] = useState<ApiAlerta | null>(null);
  const [fila, setFila] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState("");
  const mostrado = useRef<string | null>(null);
  const abertosAntes = useRef<Map<string, ApiAlerta>>(new Map());

  const verificar = useCallback(async () => {
    if (typeof window === "undefined" || !localStorage.getItem("indusense_token")) return;
    let abertos: ApiAlerta[];
    try {
      abertos = await call<ApiAlerta[]>("/alerts?resolvido=false&limit=100");
    } catch {
      return; // API acordando ou fora: tenta de novo no próximo ciclo
    }
    abertos = abertos.filter((a) => a.severidade === "atencao" || a.severidade === "critico");
    anunciarAtivos(abertos.length);

    // alertas que estavam abertos e sumiram = voltaram ao normal
    const idsAgora = new Set(abertos.map((a) => a.id));
    abertosAntes.current.forEach((a, id) => {
      if (!idsAgora.has(id) && mostrado.current?.startsWith(id)) {
        setAviso(`${a.salaNome ?? "Sala"}: ${tituloAlerta(a).split(" ")[0].toLowerCase()} voltou ao normal.`);
      }
    });
    abertosAntes.current = new Map(abertos.map((a) => [a.id, a]));

    const agora = Date.now();
    const soneca = ler<Record<string, number>>(SNOOZE_KEY, {});
    const vistos = ler<string[]>(SEEN_KEY, []);
    // limpa registros de alertas que já não existem
    gravar(SNOOZE_KEY, Object.fromEntries(Object.entries(soneca).filter(([id, ate]) => idsAgora.has(id) && ate > agora)));
    gravar(SEEN_KEY, vistos.filter((k) => idsAgora.has(k.split(":")[0])));

    const pendentes = abertos
      .filter((a) => !a.lido && !vistos.includes(chave(a)) && !((soneca[a.id] ?? 0) > agora))
      .sort((x, y) => (x.severidade === "critico" ? 0 : 1) - (y.severidade === "critico" ? 0 : 1) || +new Date(y.dataHora) - +new Date(x.dataHora));

    setFila(pendentes.length);
    const proximo = pendentes[0] ?? null;

    if (!proximo) {
      if (mostrado.current) { mostrado.current = null; setAtual(null); }
      return;
    }
    // mantém o que está na tela atualizado; troca só se o atual foi resolvido
    const naTela = mostrado.current ? pendentes.find((a) => chave(a) === mostrado.current) : undefined;
    const exibir = naTela ?? proximo;
    if (mostrado.current !== chave(exibir)) {
      mostrado.current = chave(exibir);
      bipe(exibir.severidade === "critico");
      try {
        const prefs = JSON.parse(localStorage.getItem("indusense_prefs") || "{}");
        if (prefs.notificacoes !== false && typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
          new Notification(`InduSense · ${tituloAlerta(exibir)}`, {
            body: `${exibir.salaNome ?? ""}: ${fmtNum(exibir.valorMedido)} ${unidade(exibir)} (limite ${fmtNum(exibir.limite)} ${unidade(exibir)})`,
          });
        }
      } catch { /* ignore */ }
    }
    setAtual(exibir);
  }, []);

  useEffect(() => {
    verificar();
    const t = setInterval(verificar, POLL_MS);
    const aoVoltar = () => { if (!document.hidden) verificar(); };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", aoVoltar); };
  }, [verificar]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(""), 5000);
    return () => clearTimeout(t);
  }, [aviso]);

  async function ciente() {
    if (!atual) return;
    setOcupado(true);
    gravar(SEEN_KEY, [...ler<string[]>(SEEN_KEY, []), chave(atual)]);
    try { await call(`/alerts/${atual.id}/read`, { method: "PATCH", body: "{}" }); } catch { /* fica salvo neste navegador */ }
    mostrado.current = null;
    setAtual(null);
    setOcupado(false);
    verificar();
  }

  function lembrarDepois() {
    if (!atual) return;
    const s = ler<Record<string, number>>(SNOOZE_KEY, {});
    s[atual.id] = Date.now() + SONECA_MIN * 60_000;
    gravar(SNOOZE_KEY, s);
    mostrado.current = null;
    setAtual(null);
    setAviso(`Certo, eu aviso de novo em ${SONECA_MIN} minutos se continuar fora do limite.`);
    verificar();
  }

  return (
    <>
      {atual && (
        <div className="aw-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="aw-title">
          <div className={`aw-card ${atual.severidade === "critico" ? "crit" : "warn"}`}>
            <div className="aw-stripes" aria-hidden="true" />
            <div className="aw-body">
              <div className="aw-icon">
                {(() => { const I = ICONE[atual.tipo] ?? ShieldAlert; return <I size={34} />; })()}
              </div>
              <span className="aw-level">{atual.severidade === "critico" ? "ALERTA CRÍTICO" : "ATENÇÃO"}</span>
              <h2 id="aw-title">{tituloAlerta(atual)}</h2>
              <p className="aw-where">{atual.salaNome ?? "Sala"}{atual.salaCodigo ? ` · ${atual.salaCodigo}` : ""} · {atual.sensorNome}</p>

              <div className="aw-reading">
                <div>
                  <small>Agora</small>
                  <b>{fmtNum(atual.sensorValorAtual ?? atual.valorMedido)}<em>{unidade(atual)}</em></b>
                </div>
                <div>
                  <small>{atual.valorMedido > atual.limite ? "Máximo permitido" : "Mínimo permitido"}</small>
                  <b>{fmtNum(atual.limite)}<em>{unidade(atual)}</em></b>
                </div>
                <div>
                  <small>Fora do limite há</small>
                  <b className="aw-dur">{duracao(atual.dataHora)}</b>
                </div>
              </div>

              <p className="aw-hint">
                Verifique o ambiente e tome as providências. O alerta é encerrado sozinho quando a leitura voltar ao normal.
              </p>

              <div className="aw-actions">
                <button className="aw-snooze" onClick={lembrarDepois} disabled={ocupado}>
                  <AlarmClock size={18} /> Me lembre em {SONECA_MIN} min
                </button>
                {atual.salaCodigo && (
                  <button className="aw-ghost" onClick={() => { const c = atual.salaCodigo!; lembrarDepois(); onVerSala(c); }}>
                    Ver sala
                  </button>
                )}
                <button className="aw-ok" onClick={ciente} disabled={ocupado} autoFocus>
                  <CheckCircle2 size={18} /> OK, estou ciente
                </button>
              </div>
              {fila > 1 && <p className="aw-more">+{fila - 1} outro{fila - 1 === 1 ? "" : "s"} alerta{fila - 1 === 1 ? "" : "s"} aguardando</p>}
            </div>
          </div>
        </div>
      )}
      {aviso && <div className="users-toast">{aviso}</div>}
    </>
  );
}
