import { api } from "../../lib/api";

/** Partes comuns da tela de Alertas e do aviso grande (AlertWatcher). */

export type ApiAlerta = {
  id: string;
  sensorId: string;
  sensorNome: string;
  sensorCodigo?: string | null;
  salaId: string;
  salaCodigo?: string | null;
  salaNome?: string | null;
  tipo: "temperatura" | "umidade" | "qualidade_ar" | "gas" | string;
  unidade?: string;
  valorMedido: number;
  limite: number;
  limiteMin?: number;
  limiteMax?: number;
  sensorValorAtual?: number;
  severidade: "atencao" | "critico" | "offline" | string;
  mensagem?: string | null;
  dataHora: string;
  lido: boolean;
  resolvido: boolean;
  resolvidoEm?: string | null;
  resolvidoAutomaticamente?: boolean;
};

const BASE = ((api as any).baseUrl as string) || "";
const token = () => (typeof window === "undefined" ? "" : localStorage.getItem("indusense_token") ?? "");

export async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}`, ...(init.headers || {}) },
    });
  } catch {
    throw new Error("Sem conexão com a API. Ela pode estar acordando; tente de novo em alguns segundos.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) throw new Error("Sessão expirada. Saia e entre de novo.");
    if (res.status === 403) throw new Error("Seu perfil não pode resolver alertas. Peça a um operador ou administrador.");
    const msg = body?.message;
    throw new Error(Array.isArray(msg) ? msg[0] : msg || `Erro ${res.status}`);
  }
  return (body?.data ?? body) as T;
}

export const TIPO_LABEL: Record<string, string> = {
  temperatura: "Temperatura",
  umidade: "Umidade",
  qualidade_ar: "Qualidade do ar",
  gas: "Gases",
};

export const UNIDADE: Record<string, string> = { temperatura: "°C", umidade: "%", qualidade_ar: "AQI", gas: "ppm" };

export const unidade = (a: ApiAlerta) => a.unidade || UNIDADE[a.tipo] || "";

/** "Temperatura elevada", "Umidade baixa", "Gases acima do limite"... */
export function tituloAlerta(a: ApiAlerta) {
  const acima = a.valorMedido > a.limite;
  switch (a.tipo) {
    case "temperatura": return acima ? "Temperatura elevada" : "Temperatura baixa";
    case "umidade": return acima ? "Umidade elevada" : "Umidade baixa";
    case "qualidade_ar": return acima ? "Qualidade do ar ruim" : "Qualidade do ar abaixo do esperado";
    case "gas": return acima ? "Gases acima do limite" : "Gases abaixo do esperado";
    default: return `${TIPO_LABEL[a.tipo] ?? a.tipo} fora do limite`;
  }
}

export const fmtNum = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)).replace(".", ",");

export function duracao(desde: string, ate?: string | null) {
  const min = Math.max(0, Math.round(((ate ? new Date(ate).getTime() : Date.now()) - new Date(desde).getTime()) / 60000));
  if (min < 1) return "menos de 1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h${min % 60 ? ` ${min % 60} min` : ""}`;
}

/** Evento global para a barra lateral/topo mostrarem o número de alertas ativos. */
export function anunciarAtivos(n: number) {
  try {
    localStorage.setItem("indusense_alertas_ativos", String(n));
    window.dispatchEvent(new CustomEvent("indusense:alerts", { detail: n }));
  } catch { /* ignore */ }
}
