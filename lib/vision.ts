/**
 * Leitura direta do sistema de câmera (pasta indusense, Python).
 * O endereço vem do streamUrl da câmera na API: http://HOST:8000/video_feed -> http://HOST:8000
 */

export type VisionItem = { present: boolean | null; conf: number | null };

export type VisionPerson = {
  id: number;
  status: "CONFORME" | "NAO_CONFORME" | "INCONCLUSIVO" | "ANALISANDO" | string;
  items: Record<string, VisionItem>;
  missing: string[];
  others: { name: string }[];
  seen_for: number;
};

export type VisionStatus = {
  model_ready: boolean;
  model_id: string;
  camera: { online: boolean; fps: number; width: number; height: number; error?: string | null; reconnects: number; source: string };
  detector: { latency_ms: number | null; error: string | null };
  required_ppe: string[];
  people_count: number;
  summary: { conforme: number; nao_conforme: number; inconclusivo: number; analisando: number };
  people: VisionPerson[];
  events_today: number;
  last_event_id: number;
};

export type VisionEvent = {
  id: number;
  person_id: number;
  datetime: string;
  missing: string[];
  snapshot: string | null;
};

export const EPI_LABELS: Record<string, string> = {
  capacete: "Capacete",
  oculos: "Óculos",
  colete: "Colete",
  luvas: "Luvas",
  botas: "Botas",
  mascara: "Máscara",
  protetor_auricular: "Protetor auricular",
};

export const epiLabel = (k: string) => EPI_LABELS[k] ?? k;

export function visionOrigin(streamUrl?: string | null): string | null {
  if (!streamUrl) return null;
  try { return new URL(streamUrl).origin; } catch { return null; }
}

async function getJson<T>(url: string, timeoutMs = 4000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

export const vision = {
  status: (origin: string) => getJson<VisionStatus>(`${origin}/status`),
  events: async (origin: string, limit = 30) =>
    (await getJson<{ events: VisionEvent[] }>(`${origin}/events?limit=${limit}`)).events,
};

/** % de pessoas avaliadas que estão usando cada EPI exigido. */
export function itemCompliance(st: VisionStatus | null) {
  if (!st) return [];
  return st.required_ppe.map((k) => {
    const judged = st.people.filter((p) => p.items[k] && p.items[k].present !== null);
    const ok = judged.filter((p) => p.items[k].present === true).length;
    return { key: k, label: epiLabel(k), pct: judged.length ? Math.round((ok / judged.length) * 100) : null };
  });
}
