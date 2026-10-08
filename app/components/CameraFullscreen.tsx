"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera as CameraIcon, Download, Minimize2, Volume2, VolumeX } from "lucide-react";
import type { Camera } from "../../lib/api";
import { epiLabel, vision, visionOrigin, type VisionEvent, type VisionStatus } from "../../lib/vision";
import LiveStream from "./LiveStream";

const STATUS_LABEL: Record<string, string> = {
  CONFORME: "Conforme",
  NAO_CONFORME: "Não conforme",
  INCONCLUSIVO: "Inconclusivo",
  ANALISANDO: "Analisando",
};
const ORDER: Record<string, number> = { NAO_CONFORME: 0, INCONCLUSIVO: 1, ANALISANDO: 2, CONFORME: 3 };

function beep() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.22].forEach((t) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + 0.2);
    });
  } catch { /* navegador bloqueou o som */ }
}

export default function CameraFullscreen({ camera, onClose }: { camera: Camera; onClose: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const origin = visionOrigin(camera.streamUrl);
  const [st, setSt] = useState<VisionStatus | null>(null);
  const [events, setEvents] = useState<VisionEvent[]>([]);
  const [reachable, setReachable] = useState(true);
  const [videoOk, setVideoOk] = useState(true);
  const [clock, setClock] = useState("");
  const [sound, setSound] = useState(false);
  const lastEvent = useRef<number | null>(null);
  const soundRef = useRef(sound);
  soundRef.current = sound;

  // tela cheia do navegador; Esc sai da tela cheia e fecha
  useEffect(() => {
    const el = rootRef.current;
    let entered = false;
    el?.requestFullscreen?.().then(() => { entered = true; }).catch(() => undefined);
    const onChange = () => { if (entered && !document.fullscreenElement) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.fullscreenElement) onClose(); };
    document.addEventListener("fullscreenchange", onChange);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    };
  }, [onClose]);

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("pt-BR"));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const loadEvents = useCallback(async () => {
    if (!origin) return;
    try { setEvents(await vision.events(origin, 30)); } catch { /* mantém a lista anterior */ }
  }, [origin]);

  useEffect(() => {
    if (!origin) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const data = await vision.status(origin);
        if (!alive) return;
        setSt(data);
        setReachable(true);
        if (lastEvent.current === null) {
          lastEvent.current = data.last_event_id;
          loadEvents();
        } else if (data.last_event_id !== lastEvent.current) {
          const isNew = data.last_event_id > lastEvent.current;
          lastEvent.current = data.last_event_id;
          loadEvents();
          if (isNew && soundRef.current) beep();
        }
      } catch {
        if (alive) setReachable(false);
      } finally {
        if (alive) timer = setTimeout(poll, 700);
      }
    };
    poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [origin, loadEvents]);

  const cam = st?.camera;
  const online = reachable && !!cam?.online && videoOk;
  const people = [...(st?.people ?? [])].sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9) || a.id - b.id);
  const alarm = (st?.summary.nao_conforme ?? 0) > 0;

  return (
    <div className="cfs" ref={rootRef} role="dialog" aria-modal="true" aria-label={`Tela cheia: ${camera.nome}`}>
      <header className="cfs-top">
        <div className="cfs-brand">
          <span className="cfs-mark" aria-hidden="true" />
          <div>
            <h2>{camera.nome}</h2>
            <p>{camera.salaNome ?? "Monitoramento de EPI"}</p>
          </div>
        </div>
        <div className="cfs-chips">
          <span className={`cfs-chip ${online ? "ok" : "bad"}`} title={cam?.error ?? ""}>
            {online ? `Câmera online · ${cam?.width}×${cam?.height}` : "Câmera offline"}
          </span>
          <span className={`cfs-chip ${st?.model_ready && !st.detector.error ? "ok" : st ? "warn" : ""}`} title={st?.detector.error ?? ""}>
            {!st ? "Detector" : !st.model_ready ? "Detector parado" : st.detector.error ? "Falha na análise" : "Detecção ativa"}
          </span>
          {st && (
            <span className="cfs-chip plain">
              {cam?.fps.toFixed(0)} fps{st.detector.latency_ms ? ` · ${st.detector.latency_ms} ms` : ""}
            </span>
          )}
          <span className="cfs-clock">{clock}</span>
          <button className="cfs-close" onClick={onClose} title="Sair da tela cheia (Esc)"><Minimize2 size={18} /> Sair</button>
        </div>
      </header>

      <main className="cfs-layout">
        <section className="cfs-stage">
          <div className={`cfs-video ${alarm ? "alarm" : ""}`}>
            {camera.streamUrl ? (
              <LiveStream src={camera.streamUrl} alt={`Vídeo ao vivo da ${camera.nome}`} onState={setVideoOk} />
            ) : null}
            {(!camera.streamUrl || !videoOk) && (
              <div className="cfs-offline">
                <CameraIcon size={30} />
                <strong>{camera.streamUrl ? "Sem sinal da câmera" : "Esta câmera não tem vídeo ao vivo"}</strong>
                <span>
                  {camera.streamUrl
                    ? `Tentando reconectar em ${origin}. O sistema de câmera precisa estar ligado.`
                    : "Ligue o sistema de câmera (iniciar-tudo) para ela enviar o endereço do vídeo."}
                </span>
              </div>
            )}
            {origin && (
              <div className="cfs-tools">
                <a className="cfs-tool" href={`${origin}/snapshot.jpg`} download target="_blank" rel="noreferrer"><Download size={15} /> Foto</a>
              </div>
            )}
          </div>

          <div className="cfs-counts">
            <div><b>{st?.people_count ?? camera.pessoas}</b><span>pessoas na cena</span></div>
            <div className="ok"><b>{st?.summary.conforme ?? "—"}</b><span>conformes</span></div>
            <div className="bad"><b>{st?.summary.nao_conforme ?? "—"}</b><span>não conformes</span></div>
            <div className="warn"><b>{st ? st.summary.inconclusivo + st.summary.analisando : "—"}</b><span>inconclusivos</span></div>
            <div><b>{st?.events_today ?? "—"}</b><span>ocorrências hoje</span></div>
          </div>
          {st && <p className="cfs-required">EPIs exigidos: <span>{st.required_ppe.map(epiLabel).join(", ")}</span></p>}
        </section>

        <aside className="cfs-side">
          <section className="cfs-panel">
            <div className="cfs-panel-head"><h3>Pessoas agora</h3></div>
            <div className="cfs-list">
              {!reachable ? (
                <p className="cfs-empty">Não foi possível ler o sistema de câmera em {origin ?? "—"}. Confira se ele está ligado.</p>
              ) : !st ? (
                <p className="cfs-empty">Conectando…</p>
              ) : !online ? (
                <p className="cfs-empty">Aguardando a câmera voltar.</p>
              ) : people.length === 0 ? (
                <p className="cfs-empty">Ninguém na área monitorada.</p>
              ) : (
                people.map((p) => (
                  <article key={p.id} className={`cfs-person ${p.status.toLowerCase()}`}>
                    <div className="cfs-person-top">
                      <div><b>Pessoa {p.id}</b><small>há {Math.round(p.seen_for)}s na cena</small></div>
                      <span className="cfs-verdict">{STATUS_LABEL[p.status] ?? p.status}</span>
                    </div>
                    <ul>
                      {Object.entries(p.items).map(([k, it]) => {
                        const cls = it.present === true ? "ok" : it.present === false ? "bad" : "warn";
                        const mark = it.present === true
                          ? `✓ ${it.conf != null ? Math.round(it.conf * 100) + "%" : ""}`
                          : it.present === false ? "✗" : `? ${it.conf != null ? Math.round(it.conf * 100) + "%" : ""}`;
                        return <li key={k} className={cls}><span>{epiLabel(k)}</span><em>{mark}</em></li>;
                      })}
                    </ul>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="cfs-panel">
            <div className="cfs-panel-head">
              <h3>Ocorrências</h3>
              <button className={`cfs-toggle ${sound ? "on" : ""}`} onClick={() => { setSound(!sound); if (!sound) beep(); }} aria-pressed={sound}>
                {sound ? <Volume2 size={14} /> : <VolumeX size={14} />} Alerta sonoro {sound ? "ligado" : "desligado"}
              </button>
            </div>
            <ol className="cfs-list cfs-events">
              {events.length === 0 ? (
                <li className="cfs-empty">Nenhuma ocorrência registrada.</li>
              ) : (
                events.map((e, i) => (
                  <li key={e.id} className={i === 0 ? "fresh" : ""}>
                    {e.snapshot && origin ? (
                      <a href={origin + e.snapshot} target="_blank" rel="noreferrer" className="cfs-thumb">
                        <img src={origin + e.snapshot} alt={`Foto da ocorrência ${e.id}`} loading="lazy" />
                      </a>
                    ) : <span className="cfs-thumb" />}
                    <div>
                      <b>Pessoa {e.person_id}</b>
                      <span>{e.missing.length ? `Sem ${e.missing.map(epiLabel).join(", ").toLowerCase()}` : "EPI incompleto"}</span>
                      <time>{e.datetime}</time>
                    </div>
                  </li>
                ))
              )}
            </ol>
          </section>
        </aside>
      </main>
    </div>
  );
}
