import { ProviderError, type NormalizedTracking, type RawTrackingResponse, type TrackingProvider } from "../provider.ts";
import type { Status } from "../status.ts";

// Agregador fictício "ParcelTrack". O formato dele só existe neste arquivo.
interface RawEvent {
  timestamp: string;
  status_code: string;
  status_text?: string;
}
interface RawResponse {
  tracking_number?: string;
  carrier?: string;
  events: RawEvent[];
}

const CODE_TO_STATUS: Record<string, Status> = {
  PO: "posted",
  TR: "in_transit",
  RO: "in_transit",
  OD: "out_for_delivery",
  DL: "delivered",
  EX: "exception",
  RT: "exception",
};

// Código desconhecido NUNCA vira delivered: cai em exception.
export function mapCode(code: string): Status {
  return CODE_TO_STATUS[code.trim().toUpperCase()] ?? "exception";
}

export interface ParcelTrackOptions {
  baseUrl: string;
  fetchFn?: typeof fetch;
}

export class ParcelTrackProvider implements TrackingProvider {
  private baseUrl: string;
  private fetchFn: typeof fetch;

  constructor(opts: ParcelTrackOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  async fetch(trackingCode: string): Promise<RawTrackingResponse> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}/v1/trackings/${encodeURIComponent(trackingCode)}`);
    } catch (err) {
      throw new ProviderError(`Agregador indisponível: ${(err as Error).message}`);
    }
    if (!res.ok) throw new ProviderError(`Agregador respondeu HTTP ${res.status}`);
    try {
      return await res.json();
    } catch {
      throw new ProviderError("Agregador devolveu JSON inválido");
    }
  }

  normalize(raw: RawTrackingResponse): NormalizedTracking {
    const r = raw as Partial<RawResponse> | null;
    if (!r || typeof r !== "object" || !Array.isArray(r.events)) {
      throw new ProviderError("Resposta do agregador mal formada");
    }
    const events = r.events.map((e) => {
      if (!e || typeof e.status_code !== "string" || typeof e.timestamp !== "string") {
        throw new ProviderError("Evento do agregador mal formado");
      }
      // Exige fuso explícito: sem ele Date.parse usaria o fuso da máquina.
      const ms = /(Z|[+-]\d{2}:?\d{2})$/i.test(e.timestamp) ? Date.parse(e.timestamp) : NaN;
      if (Number.isNaN(ms)) throw new ProviderError(`Data de evento inválida: ${e.timestamp}`);
      return {
        occurred_at: new Date(ms).toISOString(),
        raw_status: e.status_code,
        status: mapCode(e.status_code),
      };
    });
    return { carrier: typeof r.carrier === "string" ? r.carrier : null, events };
  }
}
