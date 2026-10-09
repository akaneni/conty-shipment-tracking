import { describe, expect, it } from "vitest";
import { ParcelTrackProvider } from "../src/providers/parceltrack.ts";
import { ProviderError } from "../src/provider.ts";

const provider = new ParcelTrackProvider({ baseUrl: "http://x", fetchFn: async () => new Response("{}") });

const raw = (events: unknown[]) => ({ tracking_number: "BR1", carrier: "correios", events });

describe("ParcelTrackProvider.normalize", () => {
  it("traduz os códigos conhecidos e converte a data para UTC", () => {
    const out = provider.normalize(
      raw([
        { timestamp: "2026-10-01T09:30:00-03:00", status_code: "PO", status_text: "Objeto postado" },
        { timestamp: "2026-10-02T10:00:00Z", status_code: "TR", status_text: "Em trânsito" },
        { timestamp: "2026-10-03T10:00:00Z", status_code: "OD", status_text: "Saiu para entrega" },
        { timestamp: "2026-10-03T15:00:00Z", status_code: "DL", status_text: "Entregue" },
      ]),
    );
    expect(out.carrier).toBe("correios");
    expect(out.events.map((e) => e.status)).toEqual(["posted", "in_transit", "out_for_delivery", "delivered"]);
    expect(out.events[0]).toEqual({ occurred_at: "2026-10-01T12:30:00.000Z", raw_status: "PO", status: "posted" });
  });

  it("status inventado vira exception e não delivered, preservando o bruto", () => {
    const out = provider.normalize(raw([{ timestamp: "2026-10-02T10:00:00Z", status_code: "ENTREGUE_QUASE", status_text: "?" }]));
    expect(out.events[0]).toMatchObject({ status: "exception", raw_status: "ENTREGUE_QUASE" });
  });

  it.each(["dl", " DL ", "DL\n", "DL2", "DELIVERED"])("match exato: %j vira exception, não delivered, com o bruto preservado", (code) => {
    const out = provider.normalize(raw([{ timestamp: "2026-10-02T10:00:00Z", status_code: code }]));
    expect(out.events[0]).toMatchObject({ status: "exception", raw_status: code });
  });

  it("só \"DL\" exato vira delivered", () => {
    const out = provider.normalize(raw([{ timestamp: "2026-10-02T10:00:00Z", status_code: "DL" }]));
    expect(out.events[0]!.status).toBe("delivered");
  });

  it("rejeita resposta mal formada e data inválida", () => {
    expect(() => provider.normalize(null)).toThrow(ProviderError);
    expect(() => provider.normalize({ events: "x" })).toThrow(ProviderError);
    expect(() => provider.normalize(raw([{ timestamp: "ontem", status_code: "PO" }]))).toThrow(ProviderError);
    expect(() => provider.normalize(raw([{ timestamp: "2026-10-01T00:00:00Z" }]))).toThrow(ProviderError);
  });

  it("timestamp sem fuso explícito é rejeitado", () => {
    expect(() => provider.normalize(raw([{ timestamp: "2026-10-01T00:00:00", status_code: "PO" }]))).toThrow(ProviderError);
  });
});

describe("ParcelTrackProvider.fetch", () => {
  it("consulta o agregador pelo código e falha com ProviderError em HTTP != 2xx", async () => {
    const urls: string[] = [];
    const ok = new ParcelTrackProvider({
      baseUrl: "http://agg/",
      fetchFn: async (u) => (urls.push(String(u)), new Response(JSON.stringify({ a: 1 }))),
    });
    expect(await ok.fetch("BR 1")).toEqual({ a: 1 });
    expect(urls[0]).toBe("http://agg/v1/trackings/BR%201");

    const bad = new ParcelTrackProvider({ baseUrl: "http://agg", fetchFn: async () => new Response("no", { status: 500 }) });
    await expect(bad.fetch("BR1")).rejects.toThrow(ProviderError);
    const down = new ParcelTrackProvider({ baseUrl: "http://agg", fetchFn: async () => { throw new Error("ECONNREFUSED"); } });
    await expect(down.fetch("BR1")).rejects.toThrow(ProviderError);
  });
});
