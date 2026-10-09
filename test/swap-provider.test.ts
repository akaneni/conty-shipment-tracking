import { describe, expect, it } from "vitest";
import { ProviderError, type NormalizedTracking, type TrackingProvider } from "../src/provider.ts";
import { makeEnv } from "./helpers.ts";

// Segundo agregador, com formato totalmente diferente (status textual, epoch em segundos).
interface OtherRaw {
  parcel: { id: string; history: Array<{ at_epoch: number; label: string }> };
}

class OtherAggregator implements TrackingProvider {
  constructor(private payload: OtherRaw) {}
  async fetch(): Promise<unknown> {
    return this.payload;
  }
  normalize(raw: unknown): NormalizedTracking {
    const r = raw as OtherRaw;
    if (!r?.parcel) throw new ProviderError("formato inesperado");
    const map: Record<string, NormalizedTracking["events"][number]["status"]> = {
      "picked up": "posted",
      "on the way": "in_transit",
      "delivered to recipient": "delivered",
    };
    return {
      carrier: "dhl",
      events: r.parcel.history.map((h) => ({
        occurred_at: new Date(h.at_epoch * 1000).toISOString(),
        raw_status: h.label,
        status: map[h.label.toLowerCase()] ?? "exception",
      })),
    };
  }
}

describe("troca de agregador", () => {
  it("um segundo adaptador com outro formato funciona sem tocar no domínio", async () => {
    const provider = new OtherAggregator({
      parcel: {
        id: "X",
        history: [
          { at_epoch: 1790000000, label: "On the way" },
          { at_epoch: 1789990000, label: "Picked up" },
          { at_epoch: 1790000500, label: "Teleported" },
        ],
      },
    });
    const { req, register } = makeEnv({ provider });
    const s = await register("X");
    const r = await req("POST", `/shipments/${s.id}/refresh`);
    expect(r.status).toBe(200);
    expect(r.body.carrier).toBe("dhl");
    expect(r.body.events.map((e: any) => e.status)).toEqual(["posted", "in_transit", "exception"]);
    expect(r.body.status).toBe("exception");
    expect(JSON.stringify(r.body)).not.toContain("at_epoch");
  });
});
