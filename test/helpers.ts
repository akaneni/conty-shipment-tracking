import { createApp } from "../src/app.ts";
import { openDb } from "../src/db.ts";
import { InMemoryNotifier } from "../src/notifier.ts";
import type { NormalizedTracking, RawTrackingResponse, TrackingProvider } from "../src/provider.ts";
import { ParcelTrackProvider } from "../src/providers/parceltrack.ts";

export const T0 = Date.parse("2026-10-01T00:00:00.000Z");

export function makeClock(start = T0) {
  let now = start;
  const clock = () => new Date(now);
  return Object.assign(clock, { set: (ms: number) => (now = ms), advance: (ms: number) => (now += ms) });
}

// Agregador em memória no formato ParcelTrack; `responses[code]` é trocado pelo teste.
export function makeEnv(opts: { provider?: TrackingProvider; hours?: number } = {}) {
  const responses: Record<string, unknown> = {};
  const fetchFn = (async (url: string | URL | Request) => {
    const code = decodeURIComponent(String(url).split("/").pop()!);
    return responses[code] === undefined
      ? new Response("nope", { status: 404 })
      : new Response(JSON.stringify(responses[code]));
  }) as typeof fetch;
  const clock = makeClock();
  const notifier = new InMemoryNotifier();
  const provider = opts.provider ?? new ParcelTrackProvider({ baseUrl: "http://agg", fetchFn });
  const app = createApp({ db: openDb(), clock, provider, notifier, transitAlertHours: opts.hours ?? 120 });

  const req = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  };
  const register = async (code: string, extra: object = {}) =>
    (await req("POST", "/shipments", { tracking_code: code, ...extra })).body;
  return { app, req, register, responses, clock, notifier };
}

export const pt = (events: Array<[string, string]>, carrier = "correios") => ({
  tracking_number: "x",
  carrier,
  events: events.map(([timestamp, status_code]) => ({ timestamp, status_code })),
});

export type { NormalizedTracking, RawTrackingResponse, TrackingProvider };
