/** Qualidade do ar em palavras (igual ao app): pelo status do sensor na API. */
export function qualidadeAr(status?: string | null, online = true): { texto: string; cls: "ok" | "warn" | "critical" | "off" } {
  if (!online || !status || status === "offline") return { texto: "Sem sinal", cls: "off" };
  if (status === "critico") return { texto: "Ruim", cls: "critical" };
  if (status === "atencao") return { texto: "Moderada", cls: "warn" };
  return { texto: "Boa", cls: "ok" };
}

/** Status da API -> classe dos cartões do painel. */
export function clsStatus(status?: string | null): "ok" | "warn" | "critical" {
  return status === "critico" ? "critical" : status === "atencao" ? "warn" : "ok";
}
