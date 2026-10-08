 "use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { api, type Sensor, type Reading, type Camera as ApiCamera, type Monitoramento, type EventoArea } from "../../../../lib/api";
import { epiLabel, itemCompliance, vision, visionOrigin, type VisionStatus } from "../../../../lib/vision";
import LiveStream from "../../../components/LiveStream";
import CameraFullscreen from "../../../components/CameraFullscreen";
import {
  Activity, AirVent, ArrowLeft, Camera, CheckCircle2, Clock3, Download,
  HardHat, ShieldAlert, Thermometer, Users, Waves, Wifi, WifiOff,
  AlertTriangle, Eye, Maximize2, MoreHorizontal, RefreshCw
} from "lucide-react";
import {
  AreaChart, Area, LineChart, Line, CartesianGrid, ResponsiveContainer,
  Tooltip, XAxis, YAxis, ReferenceLine
} from "recharts";

const rooms: Record<string, any> = {
  "IND-001": {name:"Linha de Produção A", location:"Setor A • Galpão 01", status:"online", temp:26.4, hum:57, air:43, gas:21, people:18, risk:"Baixo"},
  "IND-002": {name:"Caldeira Central", location:"Setor B • Caldeiras", status:"online", temp:29.1, hum:61, air:67, gas:48, people:11, risk:"Alto"},
  "IND-003": {name:"Almoxarifado", location:"Setor C • Estoque", status:"offline", temp:23.8, hum:52, air:34, gas:12, people:0, risk:"Indisponível"},
  "IND-004": {name:"Sala Elétrica", location:"Setor D • Energia", status:"online", temp:27.2, hum:55, air:39, gas:17, people:6, risk:"Baixo"}
};

const history = [
  {time:"08:00",temp:24.2,hum:53,air:35,gas:14},{time:"09:00",temp:25.0,hum:55,air:38,gas:18},
  {time:"10:00",temp:26.4,hum:57,air:43,gas:21},{time:"11:00",temp:27.1,hum:58,air:47,gas:25},
  {time:"12:00",temp:28.0,hum:61,air:55,gas:31},{time:"13:00",temp:28.7,hum:62,air:61,gas:38},
  {time:"14:00",temp:29.1,hum:61,air:67,gas:48}
];


function Metric({title,value,unit,icon:Icon,status}:{title:string,value:string,unit:string,icon:any,status:"ok"|"warn"|"critical"}) {
  return <div className="room-metric">
    <div className={"room-metric-icon "+status}><Icon size={19}/></div>
    <div><small>{title}</small><strong>{value}<em>{unit}</em></strong></div>
    <span className={"metric-status-dot "+status}/>
  </div>
}

/** Câmeras ligadas ao sistema de visão (enviam dados ou têm vídeo). As de demonstração ficam de fora. */
function camerasReais(cams: ApiCamera[]) {
  const reais = cams.filter((c) => c.streamUrl || c.ultimoContato);
  return reais.length ? reais : cams;
}

const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

function EventIcon({ e }: { e: EventoArea }) {
  if (e.origem === "epi") return <span className="event-icon yellow"><HardHat size={16}/></span>;
  if (e.severidade === "critico") return <span className="event-icon red"><ShieldAlert size={16}/></span>;
  if (e.severidade === "offline") return <span className="event-icon gray"><WifiOff size={16}/></span>;
  if (e.severidade === "normal") return <span className="event-icon green"><CheckCircle2 size={16}/></span>;
  return <span className="event-icon blue"><AirVent size={16}/></span>;
}

function CameraFeed({ camera, paused, onExpand }: { camera: ApiCamera; paused: boolean; onExpand: () => void }) {
  const [videoOk, setVideoOk] = useState(true);
  const live = camera.online && !!camera.streamUrl && videoOk;
  return <div className={"camera-feed" + (camera.streamUrl ? " has-stream" : "")}>
    {camera.online && camera.streamUrl && !paused && (
      <LiveStream src={camera.streamUrl} alt={`Vídeo ao vivo da ${camera.nome}`} className="camera-stream" onState={setVideoOk}/>
    )}
    {paused && <div className="camera-offline"><Maximize2 size={26}/><b>Aberta em tela cheia</b></div>}
    {!paused && (!camera.online || (camera.streamUrl && !videoOk)) && (
      <div className="camera-offline"><WifiOff size={28}/><b>Câmera sem sinal</b>
        <span>{camera.ultimoContatoRelativo ? `Última comunicação: ${camera.ultimoContatoRelativo.toLowerCase()}` : camera.issue}</span></div>
    )}
    {!paused && camera.online && !camera.streamUrl && (
      <div className="camera-offline"><Camera size={26}/><b>Sem vídeo ao vivo</b><span>Câmera de demonstração, sem sistema de visão ligado.</span></div>
    )}
    {!paused && <>
      <div className="feed-overlay top">{live ? <span><i/> AO VIVO</span> : <span className="muted">SEM VÍDEO</span>}<b>{camera.nome}</b></div>
      <div className="feed-overlay bottom">
        <span>{camera.online ? `${camera.pessoas} ${camera.pessoas === 1 ? "pessoa detectada" : "pessoas detectadas"}` : "Sem conexão"}</span>
        {camera.streamUrl && <button onClick={onExpand} title="Abrir em tela cheia" aria-label="Abrir em tela cheia"><Maximize2 size={15}/></button>}
      </div>
    </>}
  </div>;
}

export default function RoomDetails() {
  const router=useRouter();
  const params=useParams<{id:string}>();
  const [range,setRange]=useState("24h");
  const [cameraId,setCameraId]=useState<string|null>(null);
  const [mon,setMon]=useState<Monitoramento|null>(null);
  const [live,setLive]=useState<VisionStatus|null>(null);
  const [liveError,setLiveError]=useState("");
  const [fullscreen,setFullscreen]=useState(false);
  const [tick,setTick]=useState(0);
  const [monError,setMonError]=useState("");
  const [room,setRoom]=useState<any>(null);
  const [roomSensors,setRoomSensors]=useState<Sensor[]>([]);
  const [roomHistory,setRoomHistory]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  useEffect(()=>{
    let active=true;
    (async()=>{
      try {
        const sala=await api.sala(params.id);
        const sensors=await api.salaSensors(sala.id);
        if(!active)return;
        setRoomSensors(sensors);
        const get=(tipo:string)=>sensors.find(s=>s.tipo===tipo);
        const t=get("temperatura"), h=get("umidade"), a=get("qualidade_ar"), g=get("gas");
        setRoom({
          name:sala.nome, location:[sala.setor,sala.localizacao].filter(Boolean).join(" • "),
          status:sala.ativo && !sensors.some(x=>x.status==="offline")?"online":"offline",
          temp:t?.valorAtual??0, hum:h?.valorAtual??0, air:a?.valorAtual??0, gas:g?.valorAtual??0,
          people:0, risk:[a?.status,g?.status].some(x=>x==="critico")?"Alto":"Baixo"
        });
        const readings=await Promise.all(sensors.map(x=>api.sensorReadings(x.id).catch(()=>[] as Reading[])));
        const byTime=new Map<string,any>();
        readings.flat().forEach(r=>{
          const d=new Date(r.dataHora), key=d.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
          const sensor=sensors.find(x=>x.id===r.sensorId); if(!sensor)return;
          const row=byTime.get(key)||{time:key};
          if(sensor.tipo==="temperatura")row.temp=r.valor;
          if(sensor.tipo==="umidade")row.hum=r.valor;
          if(sensor.tipo==="qualidade_ar")row.air=r.valor;
          if(sensor.tipo==="gas")row.gas=r.valor;
          byTime.set(key,row);
        });
        setRoomHistory(Array.from(byTime.values()).slice(-24));
      } catch(err) { if(active)setError(err instanceof Error?err.message:"Falha ao carregar a área."); }
      finally { if(active)setLoading(false); }
    })();
    return ()=>{active=false};
  },[params.id,tick]);

  // câmeras, EPI e eventos: atualiza a cada 5 s
  useEffect(()=>{
    let alive=true;
    let timer:ReturnType<typeof setTimeout>;
    const load=async()=>{
      try {
        const m=await api.monitoramento(params.id);
        if(alive){setMon(m);setMonError("");}
      } catch(err) {
        // API sem a rota de monitoramento: tenta ao menos a lista de câmeras da sala
        try {
          const cams=await api.salaCameras(params.id);
          if(alive){setMon(m=>({...(m??{status:"online",risco:"",riscoDescricao:"",pessoasDetectadas:0,epiConformidade:null,eventosRecentes:[],alertasAtivos:[]}),cameras:cams} as Monitoramento));setMonError("");}
        } catch {
          if(alive)setMonError(err instanceof Error?err.message:"Falha ao buscar as câmeras na API.");
        }
      }
      finally { if(alive)timer=setTimeout(load,5000); }
    };
    load();
    return ()=>{alive=false;clearTimeout(timer)};
  },[params.id,tick]);

  const cams=useMemo(()=>camerasReais(mon?.cameras??[]),[mon]);
  const camera=cams.find(c=>c.id===cameraId)??cams[0];
  const origin=visionOrigin(camera?.streamUrl);

  // detalhe por EPI vem direto do sistema de câmera
  useEffect(()=>{
    if(!origin){setLive(null);setLiveError("");return;}
    let alive=true;
    let timer:ReturnType<typeof setTimeout>;
    const load=async()=>{
      try { const st=await vision.status(origin); if(alive){setLive(st);setLiveError("");} }
      catch { if(alive){setLive(null);setLiveError(`Sem acesso a ${origin}. O sistema de câmera precisa estar ligado e na versão nova (com CORS liberado para este painel).`);} }
      finally { if(alive)timer=setTimeout(load,1000); }
    };
    load();
    return ()=>{alive=false;clearTimeout(timer)};
  },[origin]);

  const closeFullscreen=useCallback(()=>setFullscreen(false),[]);

  const camsOn=cams.filter(c=>c.online);
  // Com a câmera acessível, tudo vem dela (os mesmos números de localhost:8000).
  // Sem acesso, usa o último resumo que a câmera mandou para a API.
  const liveOn=!!live&&live.camera.online;
  const judged=live?live.summary.conforme+live.summary.nao_conforme:0;
  const score=live
    ? (liveOn&&judged?Math.round(live.summary.conforme/judged*100):null)
    : (camsOn.length?Math.round(camsOn.reduce((a,c)=>a+c.epiConformidade,0)/camsOn.length):null);
  const items=liveOn?itemCompliance(live):[];
  const ncAgora=liveOn?live!.people.filter(p=>p.status==="NAO_CONFORME"):[];
  const abertas=(mon?.ocorrenciasEpi??[]).filter(o=>!o.resolvido);
  const ultima=abertas[0];
  const scoreTexto=score===null
    ? (live&&!liveOn?"Câmera sem sinal":liveOn?(live!.people_count?"Analisando as pessoas":"Ninguém na cena"):"Sem câmeras online")
    : score>=95?"Bom desempenho":score>=80?"Atenção ao uso de EPI":"Conformidade baixa";

  if (loading) return <div className="room-page"><main className="room-content"><div className="panel" style={{padding:24}}>Carregando dados da API...</div></main></div>;
  if (error || !room) return <div className="room-page"><main className="room-content"><div className="error-box">{error || "Área não encontrada."}</div></main></div>;

  const risk=mon?.risco??room.risk;
  const people=liveOn?live!.people_count:(mon?.pessoasDetectadas??room.people);
  const riskClass=risk==="Alto"?"critical":risk==="Indisponível"?"offline":risk==="Médio"?"warn":"good";

  return <div className="room-page">
    <header className="room-topbar">
      <button className="back-btn" onClick={()=>router.push("/dashboard")}><ArrowLeft size={18}/> Voltar ao monitoramento</button>
      <div className="room-actions">
        <span className="room-live"><i/> Atualização ao vivo</span>
        <button className="room-icon-btn" title="Atualizar" onClick={()=>setTick(t=>t+1)}><RefreshCw size={17}/></button>
        <button className="room-icon-btn" title="Exportar"><Download size={17}/></button>
      </div>
    </header>

    <main className="room-content">
      <div className="room-heading">
        <div>
          <div className="room-breadcrumb">MONITORAMENTO / DETALHES DA ÁREA</div>
          <div className="room-title-row">
            <span className={"room-status "+room.status}><i/>{room.status==="online"?"Online":"Offline"}</span>
            <h1>{room.name}</h1>
          </div>
          <p>{room.location} • ID do dispositivo {params.id}</p>
        </div>
        <div className="risk-card"><span>Risco operacional</span><b className={riskClass}>{risk}</b><small>Baseado nos sensores e visão computacional</small></div>
      </div>

      <div className="room-alert">
        <AlertTriangle size={18}/>
        <div><b>{mon?.riscoDescricao??(risk==="Alto"?"Atenção operacional necessária":"Ambiente dentro dos parâmetros")}</b>
        <span>{abertas.length
          ? `${abertas.length} ${abertas.length===1?"ocorrência de EPI aberta":"ocorrências de EPI abertas"} nas últimas 24 h. Última: ${ultima.mensagem.toLowerCase()} às ${hora(ultima.dataHora)}.`
          : risk==="Alto"?"Parâmetros ambientais fora do nível de referência. Verifique a ventilação e a área monitorada.":"Nenhuma condição crítica identificada neste momento."}</span></div>
        {abertas.length>0&&camera?.streamUrl&&<button onClick={()=>setFullscreen(true)}>Ver câmera</button>}
      </div>

      <section className="room-kpis">
        <Metric title="Temperatura" value={String(room.temp).replace(".",",")} unit="°C" icon={Thermometer} status={room.temp>30?"critical":"ok"}/>
        <Metric title="Umidade" value={String(room.hum)} unit="%" icon={Waves} status={room.hum>75?"warn":"ok"}/>
        <Metric title="Qualidade do ar" value={String(room.air)} unit=" AQI" icon={AirVent} status={room.air>60?"critical":room.air>50?"warn":"ok"}/>
        <Metric title="Gases" value={String(room.gas)} unit=" ppm" icon={ShieldAlert} status={room.gas>40?"critical":room.gas>30?"warn":"ok"}/>
        <Metric title="Pessoas detectadas" value={String(people)} unit="" icon={Users} status={abertas.length?"warn":"ok"}/>
      </section>

      <section className="room-panel chart-room">
        <div className="room-panel-head">
          <div><h2>Acompanhamento ambiental</h2><p>Leituras consolidadas dos sensores da área.</p></div>
          <div className="chart-controls">{["6h","24h","7d","30d"].map(x=><button key={x} className={range===x?"active":""} onClick={()=>setRange(x)}>{x}</button>)}</div>
        </div>
        <div className="legend-row"><span><i className="legend-temp"/> Temperatura</span><span><i className="legend-hum"/> Umidade</span><span><i className="legend-air"/> Qualidade do ar</span><span><i className="legend-gas"/> Gases</span></div>
        <div className="room-chart"><ResponsiveContainer width="100%" height={330}><LineChart data={roomHistory.length ? roomHistory : history}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="time"/><YAxis/><Tooltip/><ReferenceLine y={60} strokeDasharray="5 5"/><Line type="monotone" dataKey="temp" strokeWidth={3} dot={false} name="Temperatura °C"/><Line type="monotone" dataKey="hum" strokeWidth={2} dot={false} name="Umidade %"/><Line type="monotone" dataKey="air" strokeWidth={3} dot={false} name="AQI"/><Line type="monotone" dataKey="gas" strokeWidth={2} dot={false} name="Gases ppm"/></LineChart></ResponsiveContainer></div>
      </section>

      <div className="room-lower-grid">
        <section className="room-panel camera-panel">
          <div className="room-panel-head"><div><h2>Monitoramento por câmeras</h2><p>Visão computacional para acompanhamento de uso de EPI.</p></div>{cams.length>0&&<span className={"camera-count"+(camsOn.length?"":" off")}><Camera size={15}/> {camsOn.length}/{cams.length} online</span>}</div>
          {!camera && monError ? (
            <div className="camera-empty"><WifiOff size={26}/><b>Não foi possível buscar as câmeras na API</b><span>{monError}</span></div>
          ) : !camera && !mon ? (
            <div className="camera-empty"><Camera size={26}/><b>Carregando câmeras…</b></div>
          ) : !camera ? (
            <div className="camera-empty"><Camera size={26}/><b>Nenhuma câmera nesta área</b><span>Ligue o sistema de câmera com CENTRAL_SALA_ID={params.id} para ela aparecer aqui.</span></div>
          ) : (
            <div className={"camera-layout"+(cams.length===1?" single":"")}>
              <div className="camera-main">
                <CameraFeed camera={camera} paused={fullscreen} onExpand={()=>setFullscreen(true)}/>
                <div className="camera-info">
                  <div><b>{camera.nome}</b><small>{camera.online?(camera.ocorrencia??"Nenhuma ocorrência no momento"):"Câmera sem conexão"} • {camera.epiConformidade}% EPI OK</small></div>
                  {camera.streamUrl&&<button className="room-icon-btn" title="Abrir em tela cheia" onClick={()=>setFullscreen(true)}><Maximize2 size={17}/></button>}
                </div>
              </div>
              {cams.length>1&&<div className="camera-list">{cams.map(c=><button className={"camera-list-item "+(camera.id===c.id?"selected":"")} key={c.id} onClick={()=>setCameraId(c.id)}><div className="camera-thumb">{c.online?<Camera size={17}/>:<WifiOff size={17}/>}<span className={c.online?"online":"offline"}/></div><div><b>{c.nome}</b><small>{c.online?`${c.pessoas} pessoas • ${c.epiConformidade}% EPI OK`:"Sem conexão"}</small></div><MoreHorizontal size={15}/></button>)}</div>}
            </div>
          )}
        </section>

        <section className="room-panel epi-panel">
          <div className="room-panel-head"><div><h2>Conformidade de EPI</h2><p>{live?`Ao vivo, de ${origin?.replace(/^https?:\/\//,"")}`:"Último resumo enviado pela câmera."}</p></div><HardHat size={20}/></div>
          <div className="epi-score"><div className={"score-ring"+(score!==null&&score<80?" low":"")} style={{"--score":`${(score??0)*3.6}deg`} as React.CSSProperties}><strong>{score===null?"—":`${score}%`}</strong><small>conformidade</small></div><div><b>{scoreTexto}</b><span>Meta operacional: ≥ 95%</span></div></div>
          {liveOn&&<div className="epi-counts">
            <div><b>{live!.people_count}</b><span>na cena</span></div>
            <div className="ok"><b>{live!.summary.conforme}</b><span>conformes</span></div>
            <div className="bad"><b>{live!.summary.nao_conforme}</b><span>não conformes</span></div>
            <div className="warn"><b>{live!.summary.inconclusivo+live!.summary.analisando}</b><span>inconclusivos</span></div>
          </div>}
          <div className="epi-items">
            {items.length ? items.map(it=><div key={it.key}><span>{it.label}</span><b>{it.pct===null?"—":`${it.pct}%`}</b><i><em className={it.pct!==null&&it.pct<80?"low":""} style={{width:`${it.pct??0}%`}}/></i></div>)
              : <p className="epi-note">{liveError||(live&&!liveOn?"A câmera está sem sinal.":"Sem câmera online nesta área.")}</p>}
            {liveOn&&live!.people_count===0&&<p className="epi-note">Ninguém na cena agora.</p>}
          </div>
          {ncAgora.length ? (
            <button className="epi-incident" onClick={()=>camera?.streamUrl&&setFullscreen(true)}>
              <AlertTriangle size={17}/>
              <div><b>{ncAgora.length} {ncAgora.length===1?"pessoa sem EPI agora":"pessoas sem EPI agora"}</b>
                <span>{ncAgora.map(p=>`Pessoa ${p.id}: sem ${p.missing.map(epiLabel).join(", ").toLowerCase()}`).join(" • ")}</span></div>
              <Eye size={16}/>
            </button>
          ) : ultima ? (
            <button className="epi-incident" onClick={()=>camera?.streamUrl&&setFullscreen(true)}>
              <AlertTriangle size={17}/>
              <div><b>{abertas.length} {abertas.length===1?"ocorrência requer":"ocorrências requerem"} atenção</b><span>{ultima.cameraCodigo??ultima.cameraNome}: {ultima.mensagem.toLowerCase()} às {hora(ultima.dataHora)}.</span></div>
              <Eye size={16}/>
            </button>
          ) : (
            <div className="epi-incident ok"><CheckCircle2 size={17}/><div><b>Nenhuma ocorrência aberta</b><span>Últimas 24 horas sem pessoa sem EPI.</span></div></div>
          )}
        </section>
      </div>

      <section className="room-panel timeline-panel">
        <div className="room-panel-head"><div><h2>Eventos recentes da área</h2><p>Ocorrências relevantes para decisão operacional.</p></div><button className="ghost-room-btn">Ver histórico completo</button></div>
        <div className="event-list">
          {(mon?.eventosRecentes??[]).length===0
            ? <p className="epi-note">Nenhum evento nas últimas 24 horas.</p>
            : mon!.eventosRecentes.map(e=><div key={e.origem+e.id}><EventIcon e={e}/><div><b>{e.titulo}</b><small>{e.detalhe}</small></div><time title={e.tempoRelativo}>{hora(e.dataHora)}</time></div>)}
        </div>
      </section>
    </main>
    {fullscreen&&camera&&<CameraFullscreen camera={{...camera,salaNome:camera.salaNome??room.name}} onClose={closeFullscreen}/>}
  </div>
}
