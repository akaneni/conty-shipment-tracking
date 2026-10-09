import { describe, expect, it } from "vitest";
import { deriveState, isDelayed, type TrackingEvent } from "../src/status.ts";

const ev = (occurred_at: string, status: TrackingEvent["status"]): TrackingEvent => ({ occurred_at, status });

describe("deriveState", () => {
  it("sem eventos mantém sem status", () => {
    expect(deriveState([])).toEqual({ status: null, delivered_at: null });
  });

  it("usa o evento de maior occurred_at, independente da ordem de chegada", () => {
    const s = deriveState([
      ev("2026-10-03T10:00:00.000Z", "out_for_delivery"),
      ev("2026-10-01T10:00:00.000Z", "posted"),
      ev("2026-10-02T10:00:00.000Z", "in_transit"),
    ]);
    expect(s.status).toBe("out_for_delivery");
  });

  it("empate de occurred_at resolve pelo maior rank", () => {
    const t = "2026-10-02T10:00:00.000Z";
    expect(deriveState([ev(t, "in_transit"), ev(t, "out_for_delivery")]).status).toBe("out_for_delivery");
    expect(deriveState([ev(t, "out_for_delivery"), ev(t, "in_transit")]).status).toBe("out_for_delivery");
  });

  it("entregue é terminal: evento posterior não altera o status", () => {
    const s = deriveState([
      ev("2026-10-04T10:00:00.000Z", "delivered"),
      ev("2026-10-05T10:00:00.000Z", "in_transit"),
      ev("2026-10-06T10:00:00.000Z", "exception"),
    ]);
    expect(s).toEqual({ status: "delivered", delivered_at: "2026-10-04T10:00:00.000Z" });
  });

  it("empate de occurred_at entre exception e out_for_delivery resolve pelo rank (exception vence)", () => {
    const t = "2026-10-02T10:00:00.000Z";
    expect(deriveState([ev(t, "out_for_delivery"), ev(t, "exception")]).status).toBe("exception");
    expect(deriveState([ev(t, "exception"), ev(t, "out_for_delivery")]).status).toBe("exception");
  });

  it("exceção pode ser seguida de novo status (resolvida)", () => {
    const s = deriveState([
      ev("2026-10-02T10:00:00.000Z", "exception"),
      ev("2026-10-03T10:00:00.000Z", "in_transit"),
    ]);
    expect(s.status).toBe("in_transit");
  });

  it("delivered_at é a menor data entre os eventos de entrega", () => {
    const s = deriveState([ev("2026-10-05T10:00:00.000Z", "delivered"), ev("2026-10-04T10:00:00.000Z", "delivered")]);
    expect(s.delivered_at).toBe("2026-10-04T10:00:00.000Z");
  });
});

describe("isDelayed", () => {
  const shipped = "2026-10-01T00:00:00.000Z";
  const limitMs = 120 * 3600_000;
  const at = (offset: number) => new Date(Date.parse(shipped) + offset);

  it("dentro do limite não atrasa", () => {
    expect(isDelayed({ status: "in_transit", shipped_at: shipped }, at(limitMs - 1), 120)).toBe(false);
  });
  it("no limite exato não atrasa", () => {
    expect(isDelayed({ status: "in_transit", shipped_at: shipped }, at(limitMs), 120)).toBe(false);
  });
  it("1 ms acima do limite atrasa", () => {
    expect(isDelayed({ status: "in_transit", shipped_at: shipped }, at(limitMs + 1), 120)).toBe(true);
  });
  it("entregue acima do limite não é atraso", () => {
    expect(isDelayed({ status: "delivered", shipped_at: shipped }, at(limitMs * 3), 120)).toBe(false);
  });
  it("nunca consultado ao agregador (sem status) não conta como atrasado", () => {
    expect(isDelayed({ status: null, shipped_at: shipped }, at(limitMs * 10), 120)).toBe(false);
  });
});
