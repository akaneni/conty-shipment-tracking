import type { Status } from "./status.ts";

// Resposta bruta do agregador: opaca para o domínio. Só o adaptador a lê.
export type RawTrackingResponse = unknown;

export interface NormalizedEvent {
  occurred_at: string; // ISO UTC
  raw_status: string; // texto/código original da transportadora, preservado
  status: Status;
}

export interface NormalizedTracking {
  carrier: string | null;
  events: NormalizedEvent[];
}

export class ProviderError extends Error {}

export interface TrackingProvider {
  fetch(trackingCode: string): Promise<RawTrackingResponse>;
  // Única fronteira de tradução: do formato do agregador para o domínio.
  normalize(raw: RawTrackingResponse): NormalizedTracking;
}
