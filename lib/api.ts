export type Perfil = "ADMIN" | "OPERADOR" | "VISUALIZADOR";

export type User = {
  id: string;
  nome: string;
  email: string;
  cargo?: string | null;
  empresa?: string | null;
  perfil?: Perfil | string;
  role?: string;
  ativo?: boolean;
  status?: string;
  ultimoAcesso?: string | null;
  createdAt?: string;
};

export type Sala = {
  id: string;
  codigo: string;
  nome: string;
  setor: string;
  localizacao?: string | null;
  nfcTagId?: string;
  dispositivoModelo?: string;
  ativo: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type Sensor = {
  id: string;
  codigo?: string | null;
  nome: string;
  tipo: "temperatura" | "umidade" | "qualidade_ar" | "gas" | string;
  salaId: string;
  limiteMin: number;
  limiteMax: number;
  valorAtual: number;
  status: "normal" | "atencao" | "critico" | "offline" | string;
  ultimaLeitura?: string | null;
  ativo: boolean;
};

export type Reading = {
  id: string;
  sensorId: string;
  valor: number;
  status: string;
  dataHora: string;
};

export type Alert = {
  id: string;
  sensorId: string;
  tipo: string;
  valorMedido: number;
  limite: number;
  severidade: string;
  mensagem?: string | null;
  lido: boolean;
  lidoEm?: string | null;
  resolvido: boolean;
  resolvidoEm?: string | null;
  resolvidoPorId?: string | null;
  dataHora: string;
  sensor?: Sensor;
};

export type Camera = {
  id: string;
  codigo?: string | null;
  salaId: string;
  salaCodigo?: string | null;
  salaNome?: string | null;
  nome: string;
  online: boolean;
  estado: "online" | "offline" | string;
  pessoas: number;
  epiConformidade: number;
  ocorrencia?: string | null;
  /** Vídeo ao vivo (MJPEG) do sistema de câmera, ex.: http://localhost:8000/video_feed */
  streamUrl?: string | null;
  ultimoContato?: string | null;
  ultimoContatoRelativo?: string | null;
  name: string;
  state: string;
  people: number;
  epi: number;
  issue: string;
};

export type EpiOcorrencia = {
  id: string;
  cameraId: string;
  cameraCodigo?: string | null;
  cameraNome: string;
  salaId: string;
  salaCodigo?: string | null;
  salaNome?: string | null;
  pessoa: number;
  faltando: string[];
  faltandoRotulos: string[];
  mensagem: string;
  temFoto: boolean;
  fotoUrl?: string | null;
  dataHora: string;
  tempoRelativo: string;
  lido: boolean;
  resolvido: boolean;
  resolvidoEm?: string | null;
};

export type EventoArea = {
  id: string;
  origem?: "sensor" | "epi" | string;
  severidade: string;
  titulo: string;
  detalhe: string;
  dataHora: string;
  tempoRelativo: string;
};

export type Monitoramento = {
  status: "online" | "offline" | string;
  risco: string;
  riscoDescricao: string;
  pessoasDetectadas: number;
  epiConformidade: number | null;
  cameras: Camera[];
  ocorrenciasEpi?: EpiOcorrencia[];
  ocorrenciasEpiAbertas?: number;
  eventosRecentes: EventoArea[];
  alertasAtivos: any[];
};

export type AuthResponse = {
  token: string;
  accessToken?: string;
  tokenType?: string;
  expiresIn?: string;
  user: User;
};

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "https://indusense-api.onrender.com/v1").replace(/\/+$/, "");
const TOKEN_KEY = "indusense_token";
const USER_KEY = "indusense_user";

function unwrap<T>(value: any): T {
  if (value && typeof value === "object" && Array.isArray(value.data)) return value.data as T;
  if (value && typeof value === "object" && value.data && typeof value.data === "object") return value.data as T;
  return value as T;
}

async function request<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");

  if (auth && typeof window !== "undefined") {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path.startsWith("/") ? path : `/${path}`}`, {
      ...init,
      headers,
      cache: "no-store",
    });
  } catch {
    throw new Error(`Não foi possível conectar à API em ${API_URL}. Verifique se o backend está rodando.`);
  }

  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }

  if (!response.ok) {
    const raw = body?.message;
    const message = Array.isArray(raw) ? raw[0] : raw;
    throw new Error(message || `Erro ${response.status} ao comunicar com a API.`);
  }

  return unwrap<T>(body);
}

export const api = {
  baseUrl: API_URL,

  async login(email: string, senha: string) {
    const auth = await request<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, senha }),
    }, false);
    if (!auth?.token) throw new Error("A API não retornou um token de autenticação.");
    localStorage.setItem(TOKEN_KEY, auth.token);
    localStorage.setItem(USER_KEY, JSON.stringify(auth.user));
    return auth;
  },

  async register(data: { nome: string; email: string; senha: string; empresa?: string }) {
    const auth = await request<AuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
    }, false);
    if (auth?.token) {
      localStorage.setItem(TOKEN_KEY, auth.token);
      localStorage.setItem(USER_KEY, JSON.stringify(auth.user));
    }
    return auth;
  },

  async me() {
    const user = await request<User>("/auth/me");
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    return user;
  },

  async logout() {
    try { await request("/auth/logout", { method: "POST", body: "{}" }); } finally {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    }
  },

  async salas() { return request<Sala[]>("/salas"); },
  async sala(id: string) { return request<Sala>(`/salas/${encodeURIComponent(id)}`); },
  async salaSensors(id: string) { return request<Sensor[]>(`/salas/${encodeURIComponent(id)}/sensors`); },

  async monitoramento(id: string) { return request<Monitoramento>(`/salas/${encodeURIComponent(id)}/monitoramento`); },
  async salaCameras(id: string) { return request<Camera[]>(`/salas/${encodeURIComponent(id)}/cameras`); },

  async epiOcorrencias(q: { salaId?: string; cameraId?: string; resolvido?: boolean; limit?: number } = {}) {
    const params = new URLSearchParams();
    Object.entries(q).forEach(([k, v]) => { if (v !== undefined) params.set(k, String(v)); });
    const qs = params.toString();
    return request<EpiOcorrencia[]>(`/epi/ocorrencias${qs ? `?${qs}` : ""}`);
  },
  async resolveOcorrencia(id: string) {
    return request<EpiOcorrencia>(`/epi/ocorrencias/${encodeURIComponent(id)}/resolve`, { method: "PATCH", body: "{}" });
  },
  /** A foto exige o token, então vem como blob e vira uma URL local para <img>. */
  async fotoOcorrencia(o: EpiOcorrencia) {
    if (!o.fotoUrl || typeof window === "undefined") return null;
    const host = API_URL.replace(/\/[^/]+$/, "");
    const res = await fetch(host + o.fotoUrl, {
      headers: { Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY) ?? ""}` },
    });
    if (!res.ok) return null;
    return URL.createObjectURL(await res.blob());
  },

  async sensors() { return request<Sensor[]>("/sensors"); },
  async sensor(id: string) { return request<Sensor>(`/sensors/${encodeURIComponent(id)}`); },
  async sensorReadings(id: string) { return request<Reading[]>(`/sensors/${encodeURIComponent(id)}/readings`); },

  async alerts() { return request<Alert[]>("/alerts"); },
  async readAlert(id: string) {
    return request(`/alerts/${encodeURIComponent(id)}/read`, { method: "PATCH", body: "{}" });
  },

  async readings() { return request<Reading[]>("/readings"); },

  async createSala(data: {
    codigo: string; nome: string; setor: string; localizacao?: string; nfcTagId: string; dispositivoModelo?: string;
  }) {
    return request<Sala>("/salas", { method: "POST", body: JSON.stringify(data) });
  },

  async users() { return request<User[]>("/users"); },
  async createUser(data: { nome: string; email: string; senha: string; empresa?: string; perfil?: Perfil }) {
    return request<User>("/users", { method: "POST", body: JSON.stringify(data) });
  },

  getSavedUser(): User | null {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(USER_KEY);
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  },

  isAuthenticated() {
    return typeof window !== "undefined" && !!localStorage.getItem(TOKEN_KEY);
  },
};
