"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import UsersPage from "../components/UsersPage";
import MonitoringPage from "../components/MonitoringPage";
import AlertsPage from "../components/AlertsPage";
import SettingsPage, { Avatar, useSavedUser } from "../components/SettingsPage";
import { api, type Alert as ApiAlert, type Sala, type Sensor, type User } from "../../lib/api";
import {
  Activity, AirVent, AlertTriangle, Bell, ChevronDown, CircleHelp, CloudDownload, Database,
  Gauge, LayoutDashboard, LogOut, Menu, Monitor, Moon, MoreHorizontal, Plus, Search, Settings,
  ShieldAlert, SlidersHorizontal, Thermometer, UserCog, Users, Waves, X, CheckCircle2, Wifi, WifiOff
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, LineChart, Line
} from "recharts";

const trend = [
  {time:"08h", temp:24, hum:54, air:38, gas:18},{time:"09h",temp:25,hum:56,air:41,gas:22},
  {time:"10h",temp:26,hum:58,air:44,gas:20},{time:"11h",temp:27,hum:57,air:49,gas:26},
  {time:"12h",temp:28,hum:61,air:55,gas:31},{time:"13h",temp:27,hum:59,air:47,gas:24},
  {time:"14h",temp:26,hum:57,air:43,gas:19}
];

type Device = {
  id:string; name:string; location:string; status:"online"|"offline";
  temp:number; hum:number; air:number; gas:number; last:string;
  sala?: Sala;
};

const initialDevices: Device[] = [];

const alerts: Array<{type:string,device:string,sensor:string,value:string,expected:string,level:string,status:string,time:string,id?:string}> = [];

function sensorValue(sensors: Sensor[], type: string) {
  return sensors.find(s => s.tipo === type)?.valorAtual ?? 0;
}

function deviceFromSala(sala: Sala, sensors: Sensor[]): Device {
  const salaSensors = sensors.filter(s => s.salaId === sala.id);
  const get = (type:string) => salaSensors.find(s => s.tipo === type);
  const temp=get("temperatura"), hum=get("umidade"), air=get("qualidade_ar"), gas=get("gas");
  const hasOffline = salaSensors.some(s => s.status === "offline");
  return {
    id: sala.codigo,
    name: sala.nome,
    location: [sala.setor, sala.localizacao].filter(Boolean).join(" • "),
    status: sala.ativo && !hasOffline ? "online" : "offline",
    temp: temp?.valorAtual ?? 0,
    hum: hum?.valorAtual ?? 0,
    air: air?.valorAtual ?? 0,
    gas: gas?.valorAtual ?? 0,
    last: [temp,hum,air,gas].filter(Boolean).map(s => s?.ultimaLeitura).filter(Boolean)[0]
      ? new Date([temp,hum,air,gas].filter(Boolean).map(s => s?.ultimaLeitura).filter(Boolean)[0] as string).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})
      : "Sem leitura",
    sala
  };
}

/** Número de alertas ativos, avisado pelo AlertWatcher/AlertsPage. */
function useAlertCount() {
  const [n,setN]=useState(0);
  useEffect(()=>{
    try { setN(Number(localStorage.getItem("indusense_alertas_ativos")||0)); } catch {}
    const on=(e:Event)=>setN(Number((e as CustomEvent).detail)||0);
    window.addEventListener("indusense:alerts",on);
    return ()=>window.removeEventListener("indusense:alerts",on);
  },[]);
  return n;
}

function StatusBadge({status}:{status:string}) {
  const cls = status.toLowerCase().includes("crít") ? "critical" : status.toLowerCase().includes("aten") ? "warning" : status.toLowerCase().includes("off") ? "offline" : "success";
  return <span className={"status-badge "+cls}><i/> {status}</span>;
}

function Sidebar({page,setPage,collapsed,setCollapsed,onLogout}:{page:string,setPage:(p:string)=>void,collapsed:boolean,setCollapsed:(v:boolean)=>void,onLogout:()=>void}) {
  const me = useSavedUser();
  const alertas = useAlertCount();
  const items = [
    ["Dashboard",LayoutDashboard],["Monitoramento",Monitor],["Dispositivos IoT",Wifi],["Sensores",Gauge],
    ["Alertas",Bell],["Histórico",Database],["Relatórios",CloudDownload],["Usuários",Users],["Configurações",Settings]
  ] as const;
  return <aside className={"sidebar "+(collapsed?"collapsed":"")}>
    <div className="side-top">
      <div className="brand-mark"><Activity size={24}/><span>Indu<span>Sense</span></span></div>
      <button className="collapse-btn" onClick={()=>setCollapsed(!collapsed)}><Menu size={20}/></button>
    </div>
    <div className="side-label">MENU PRINCIPAL</div>
    <nav>{items.map(([label,Icon])=><button key={label} className={page===label?"active":""} onClick={()=>setPage(label)} title={label}><Icon size={19}/><span>{label}</span>{label==="Alertas"&&alertas>0&&<em>{alertas>99?"99+":alertas}</em>}</button>)}</nav>
    <div className="side-bottom">
      <button className="user-mini" onClick={()=>setPage("Configurações")} title="Meu perfil"><Avatar user={me} size={36} className="avatar"/><div className="user-mini-text"><b>{me?.nome || "Usuário"}</b><small>{me?.email || ""}</small></div></button>
      <button className="logout-btn" onClick={onLogout}><LogOut size={18}/><span>Sair</span></button>
    </div>
  </aside>
}

function Topbar({page,setPage}:{page:string,setPage:(p:string)=>void}) {
  const me = useSavedUser();
  const alertas = useAlertCount();
  return <header className="topbar">
    <button className="mobile-menu" onClick={()=>setPage(page)}><Menu size={21}/></button>
    <div className="crumb"><span>InduSense</span><b>/</b><strong>{page}</strong></div>
    <div className="top-actions">
      <div className="live"><span/> Sistema operacional</div>
      <button className="round-btn" title="Ajuda"><CircleHelp size={19}/></button>
      <button className="round-btn" title="Notificações" onClick={()=>setPage("Alertas")}><Bell size={19}/>{alertas>0&&<i>{alertas>99?"99+":alertas}</i>}</button>
      <button className="top-avatar-btn" onClick={()=>setPage("Configurações")} title="Meu perfil"><Avatar user={me} size={36}/></button>
    </div>
  </header>
}

function MetricCard({title,value,unit,delta,kind,icon:Icon}:{title:string,value:string,unit:string,delta:string,kind:"good"|"warning"|"critical",icon:any}) {
  return <div className="metric-card">
    <div className="metric-head"><span>{title}</span><div className={"metric-icon "+kind}><Icon size={20}/></div></div>
    <div className="metric-value">{value}<small>{unit}</small></div>
    <div className="metric-footer"><span className={"delta "+(kind==="good"?"positive":"negative")}>{delta}</span><span>vs. período anterior</span></div>
    <div className="mini-line"><span style={{width: kind==="critical"?"72%":"55%"}}/></div>
  </div>
}

function DashboardHome({devices}:{devices:Device[]}) {
  const alertas = useAlertCount();
  const online = devices.filter(d=>d.status==="online").length;
  return <div className="page-content">
    <div className="page-heading">
      <div><span className="eyebrow dark">MONITORAMENTO EM TEMPO REAL</span><h1>Visão Geral do Ambiente Industrial</h1><p>Monitoramento em tempo real dos dispositivos InduSense.</p></div>
      <select className="period-select"><option>Agora</option><option>Hoje</option><option>Últimas 24h</option><option>7 dias</option><option>30 dias</option></select>
    </div>
    <div className="metrics-grid">
      <MetricCard title="Temperatura" value={devices.length ? devices[0].temp.toFixed(1).replace(".",",") : "—"} unit="°C" delta="API" kind="good" icon={Thermometer}/>
      <MetricCard title="Umidade" value={devices.length ? String(Math.round(devices[0].hum)) : "—"} unit="%" delta="API" kind="good" icon={Waves}/>
      <MetricCard title="Qualidade do ar" value={devices.length ? String(Math.round(devices[0].air)) : "—"} unit=" AQI" delta="API" kind="good" icon={AirVent}/>
      <MetricCard title="Gases" value={devices.length ? String(Math.round(devices[0].gas)) : "—"} unit=" ppm" delta="API" kind="warning" icon={ShieldAlert}/>
      <MetricCard title="Dispositivos online" value={String(online)} unit={"/ "+devices.length} delta="+1" kind="good" icon={Wifi}/>
      <MetricCard title="Alertas ativos" value={String(alertas)} unit="" delta={alertas?"agora":"ok"} kind={alertas?"critical":"good"} icon={Bell}/>
    </div>
    <div className="dashboard-grid">
      <section className="panel chart-panel large">
        <div className="panel-title"><div><h3>Temperatura e umidade</h3><p>Evolução das últimas horas</p></div><button className="ghost-btn">Últimas 24h <ChevronDown size={15}/></button></div>
        <ResponsiveContainer width="100%" height={285}><LineChart data={trend}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="time"/><YAxis/><Tooltip/><Line type="monotone" dataKey="temp" strokeWidth={3} dot={false} name="Temperatura °C"/><Line type="monotone" dataKey="hum" strokeWidth={3} dot={false} name="Umidade %"/></LineChart></ResponsiveContainer>
      </section>
      <section className="panel status-panel">
        <div className="panel-title"><div><h3>Status dos dispositivos</h3><p>Conectividade atual</p></div><button className="more-btn"><MoreHorizontal/></button></div>
        <div className="device-status-list">{devices.map(d=><div className="device-row" key={d.id}><span className={"device-dot "+d.status}/><div><b>{d.name}</b><small>{d.id} • {d.location}</small></div><StatusBadge status={d.status==="online"?"Online":"Offline"}/></div>)}</div>
      </section>
      <section className="panel chart-panel">
        <div className="panel-title"><div><h3>Qualidade do ar</h3><p>Índice AQI</p></div><span className="pill green">Normal</span></div>
        <ResponsiveContainer width="100%" height={230}><AreaChart data={trend}><defs><linearGradient id="airfill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopOpacity={0.3}/><stop offset="95%" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="time"/><YAxis/><Tooltip/><Area type="monotone" dataKey="air" strokeWidth={3} fill="url(#airfill)" name="AQI"/></AreaChart></ResponsiveContainer>
      </section>
      <section className="panel chart-panel">
        <div className="panel-title"><div><h3>Níveis de gases</h3><p>Concentração detectada</p></div><span className="pill yellow">Atenção</span></div>
        <ResponsiveContainer width="100%" height={230}><BarChart data={trend}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="time"/><YAxis/><Tooltip/><Bar dataKey="gas" name="ppm" radius={[5,5,0,0]}/></BarChart></ResponsiveContainer>
      </section>
    </div>
  </div>
}

function Devices({devices,setDevices}:{devices:Device[],setDevices:React.Dispatch<React.SetStateAction<Device[]>>}) {
  const [open,setOpen]=useState(false);
  const [form,setForm]=useState({name:"",location:""});
  async function add(e:React.FormEvent){
    e.preventDefault();
    if(!form.name||!form.location)return;
    try {
      const codigo="IND-"+Date.now().toString().slice(-6);
      const sala=await api.createSala({codigo,nome:form.name,setor:form.location,localizacao:form.location,nfcTagId:`${codigo}-NFC`,dispositivoModelo:"ESP32 DevKit"});
      setDevices(d=>[...d,deviceFromSala(sala,[])]);
      setForm({name:"",location:""}); setOpen(false);
    } catch(err) { alert(err instanceof Error ? err.message : "Não foi possível cadastrar o dispositivo."); }
  }
  return <div className="page-content"><div className="page-heading"><div><span className="eyebrow dark">GERENCIAMENTO</span><h1>Dispositivos IoT</h1><p>Cadastre e acompanhe os dispositivos da planta.</p></div><button className="primary-btn" onClick={()=>setOpen(true)}><Plus size={17}/> Cadastrar dispositivo</button></div>
    <section className="panel table-panel"><div className="table-toolbar"><div className="search-box"><Search size={17}/><input placeholder="Buscar dispositivo..."/></div><button className="ghost-btn"><SlidersHorizontal size={16}/> Filtros</button></div>
      <div className="table-scroll"><table><thead><tr><th>Dispositivo</th><th>Modelo</th><th>Localização</th><th>Status</th><th>Última comunicação</th><th>Sensores</th><th>Ações</th></tr></thead><tbody>{devices.map(d=><tr key={d.id}><td><b>{d.name}</b><small>{d.id}</small></td><td>ESP32 DevKit</td><td>{d.location}</td><td><StatusBadge status={d.status==="online"?"Online":"Offline"}/></td><td>{d.last}</td><td>4</td><td><button className="more-btn"><MoreHorizontal/></button></td></tr>)}</tbody></table></div>
    </section>
    {open&&<div className="modal-backdrop"><div className="modal"><div className="modal-head"><div><h2>Novo dispositivo</h2><p>Cadastre um equipamento IoT.</p></div><button className="more-btn" onClick={()=>setOpen(false)}><X/></button></div><form onSubmit={add}><label>Nome<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Ex.: Linha de Produção B"/></label><label>Localização<input value={form.location} onChange={e=>setForm({...form,location:e.target.value})} placeholder="Ex.: Setor A • Galpão 02"/></label><div className="modal-actions"><button type="button" className="ghost-btn" onClick={()=>setOpen(false)}>Cancelar</button><button className="primary-btn">Cadastrar</button></div></form></div></div>}
  </div>
}

function Sensors() {
  const sensors = [
    ["DHT-01","Temperatura","IND-001","26,4","°C","18","30","Normal"],
    ["DHT-02","Umidade","IND-001","57","%","30","75","Normal"],
    ["AQ-02","Qualidade do ar","IND-002","67","AQI","0","60","Atenção"],
    ["MQ-02","Gases","IND-002","48","ppm","0","40","Crítico"]
  ];
  return <div className="page-content"><div className="page-heading"><div><span className="eyebrow dark">SENSORES</span><h1>Gerenciamento de sensores</h1><p>Parâmetros e limites de segurança.</p></div><button className="primary-btn"><Plus size={17}/> Adicionar sensor</button></div>
    <div className="sensor-grid">{sensors.map(s=><div className="panel sensor-card" key={s[0]}><div className="sensor-card-top"><span className="sensor-symbol"><Gauge/></span><StatusBadge status={s[7]}/></div><small>{s[0]} • {s[2]}</small><h3>{s[1]}</h3><div className="big-sensor">{s[3]} <small>{s[4]}</small></div><div className="limits"><span>Mínimo <b>{s[5]} {s[4]}</b></span><span>Máximo <b>{s[6]} {s[4]}</b></span></div><button className="ghost-btn full">Configurar parâmetros</button></div>)}</div>
  </div>
}

function History() {
  return <div className="page-content"><div className="page-heading"><div><span className="eyebrow dark">DADOS</span><h1>Histórico</h1><p>Consulte medições armazenadas e acompanhe tendências.</p></div><button className="ghost-btn"><CloudDownload size={16}/> Exportar CSV</button></div><section className="panel table-panel"><div className="table-toolbar"><div className="search-box"><Search size={17}/><input placeholder="Buscar por dispositivo ou sensor..."/></div><select className="small-select"><option>Todos os períodos</option><option>Hoje</option><option>7 dias</option><option>30 dias</option></select></div><div className="table-scroll"><table><thead><tr><th>Data</th><th>Dispositivo</th><th>Sensor</th><th>Valor</th><th>Unidade</th><th>Status</th></tr></thead><tbody>{["25/08/2026 10:42","25/08/2026 10:41","25/08/2026 10:40","25/08/2026 10:39","25/08/2026 10:38"].map((d,i)=><tr key={d}><td>{d}</td><td>IND-00{i%3+1}</td><td>{["DHT-01","AQ-02","MQ-02"][i%3]}</td><td><b>{[26.4,43,21,67,57][i]}</b></td><td>{["°C","AQI","ppm","AQI","%"][i]}</td><td><StatusBadge status={i===3?"Atenção":"Normal"}/></td></tr>)}</tbody></table></div></section></div>
}

function Reports() {
  return <div className="page-content"><div className="page-heading"><div><span className="eyebrow dark">ANÁLISE</span><h1>Relatórios</h1><p>Gere relatórios operacionais e ambientais em PDF.</p></div><button className="primary-btn" onClick={()=>window.print()}><CloudDownload size={17}/> Gerar PDF</button></div><section className="report-preview" id="report"><div className="report-head"><div className="brand-mark"><Activity size={24}/><span>Indu<span>Sense</span></span></div><span>RELATÓRIO • 25 AGO 2026</span></div><h2>Relatório de Monitoramento Industrial</h2><p>Período analisado: 25/08/2026 • Planta principal • Todos os dispositivos</p><div className="report-kpis"><div><small>Temperatura média</small><b>26,7 °C</b></div><div><small>Umidade média</small><b>57,8%</b></div><div><small>Alertas</small><b>3</b></div><div><small>Disponibilidade</small><b>99,2%</b></div></div><h3>Resumo executivo</h3><p>O ambiente encontra-se majoritariamente dentro dos parâmetros de segurança. Foi identificado um ponto de atenção na qualidade do ar e um alerta crítico relacionado ao nível de gases no dispositivo IND-002.</p><div className="report-chart"><ResponsiveContainer width="100%" height={250}><LineChart data={trend}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="time"/><YAxis/><Tooltip/><Line dataKey="temp" name="Temperatura °C" strokeWidth={3}/><Line dataKey="air" name="AQI" strokeWidth={3}/></LineChart></ResponsiveContainer></div></section></div>
}

export default function DashboardPage() {
  const router = useRouter();
  const [page,setPage]=useState("Dashboard");
  const [collapsed,setCollapsed]=useState(false);
  const [devices,setDevices]=useState<Device[]>(initialDevices);

  const [apiLoading,setApiLoading]=useState(true);
  const [apiError,setApiError]=useState("");
  const [apiAlerts,setApiAlerts]=useState<ApiAlert[]>([]);

  useEffect(()=>{
    let active=true;
    (async()=>{
      if(!api.isAuthenticated()){ window.location.href="/login"; return; }
      try {
        const me=await api.me();
        if(!me?.ativo) throw new Error("Este usuário está desativado.");
        const [salas,sensors,alertsFromApi]=await Promise.all([api.salas(),api.sensors(),api.alerts()]);
        if(!active) return;
        setDevices(salas.map(s=>deviceFromSala(s,sensors)));
        setApiAlerts(alertsFromApi);
        setApiError("");
      } catch(err) {
        if(active) setApiError(err instanceof Error ? err.message : "Falha ao carregar os dados da API.");
      } finally { if(active) setApiLoading(false); }
    })();
    return ()=>{active=false};
  },[]);

  async function logout(){
    try { await api.logout(); } finally { window.location.href="/login"; }
  }

  const content = useMemo(()=>{
    if(page==="Dashboard") return <DashboardHome devices={devices}/>;
    if(page==="Monitoramento") return <MonitoringPage/>;
    if(page==="Dispositivos IoT") return <Devices devices={devices} setDevices={setDevices}/>;
    if(page==="Sensores") return <Sensors/>;
    if(page==="Alertas") return <AlertsPage onVerSala={(c)=>router.push(`/dashboard/monitoramento/${encodeURIComponent(c)}`)}/>;
    if(page==="Histórico") return <History/>;
    if(page==="Relatórios") return <Reports/>;
    if(page==="Usuários") return <UsersPage/>;
    return <SettingsPage onGoUsers={()=>setPage("Usuários")}/>;
  },[page,devices,router]);

  return <div className="app-shell"><Sidebar page={page} setPage={setPage} collapsed={collapsed} setCollapsed={setCollapsed} onLogout={logout}/><main className={"main "+(collapsed?"expanded":"")}><Topbar page={page} setPage={setPage}/>{apiLoading && <div className="page-content"><div className="panel" style={{padding:20}}>Carregando dados da API...</div></div>}{apiError && <div className="page-content"><div className="error-box">{apiError}</div></div>}{!apiLoading && content}</main></div>
}