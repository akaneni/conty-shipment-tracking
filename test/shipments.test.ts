import { describe, expect, it } from "vitest";
import { makeEnv, pt } from "./helpers.ts";

describe("cadastro", () => {
  it("cadastra código, rejeita repetido (409) e corpo inválido (400)", async () => {
    const { req } = makeEnv();
    const a = await req("POST", "/shipments", { tracking_code: "BR1", carrier: "correios" });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ tracking_code: "BR1", status: null, delayed: false, events: [] });
    expect((await req("POST", "/shipments", { tracking_code: "BR1" })).status).toBe(409);
    expect((await req("POST", "/shipments", {})).status).toBe(400);
    expect((await req("POST", "/shipments", { tracking_code: "B", shipped_at: "ontem" })).status).toBe(400);
  });

  it("404 para envio inexistente e 502 quando o agregador falha", async () => {
    const { req, register } = makeEnv();
    expect((await req("GET", "/shipments/99")).status).toBe(404);
    expect((await req("POST", "/shipments/99/refresh")).status).toBe(404);
    const s = await register("SEM-RESPOSTA");
    const r = await req("POST", `/shipments/${s.id}/refresh`);
    expect(r.status).toBe(502);
    expect(r.body.error).toContain("agregador");
  });
});

describe("eventos fora de ordem e repetidos", () => {
  it("evento antigo que chega depois não regride o status", async () => {
    const { req, register, responses } = makeEnv();
    const s = await register("BR1");
    responses.BR1 = pt([["2026-10-02T10:00:00Z", "TR"], ["2026-10-03T10:00:00Z", "OD"]]);
    expect((await req("POST", `/shipments/${s.id}/refresh`)).body.status).toBe("out_for_delivery");

    responses.BR1 = pt([["2026-10-01T10:00:00Z", "PO"], ["2026-10-02T10:00:00Z", "TR"], ["2026-10-03T10:00:00Z", "OD"]]);
    const r = await req("POST", `/shipments/${s.id}/refresh`);
    expect(r.body.status).toBe("out_for_delivery");
    expect(r.body.events.map((e: any) => e.status)).toEqual(["posted", "in_transit", "out_for_delivery"]);
  });

  it("lote inteiro fora de ordem termina no status final correto", async () => {
    const { req, register, responses } = makeEnv();
    const s = await register("BR1");
    responses.BR1 = pt([["2026-10-03T10:00:00Z", "OD"], ["2026-10-01T10:00:00Z", "PO"], ["2026-10-02T10:00:00Z", "TR"]]);
    expect((await req("POST", `/shipments/${s.id}/refresh`)).body.status).toBe("out_for_delivery");
  });

  it("mesmo evento duas vezes no lote e refresh repetido não duplicam o histórico", async () => {
    const { req, register, responses } = makeEnv();
    const s = await register("BR1");
    responses.BR1 = pt([["2026-10-02T10:00:00Z", "TR"], ["2026-10-02T10:00:00Z", "TR"]]);
    expect((await req("POST", `/shipments/${s.id}/refresh`)).body.events).toHaveLength(1);
    await req("POST", `/shipments/${s.id}/refresh`);
    const g = await req("GET", `/shipments/${s.id}`);
    expect(g.body.events).toHaveLength(1);
  });

  it("mesmo instante com fusos diferentes é o mesmo evento", async () => {
    const { req, register, responses } = makeEnv();
    const s = await register("BR1");
    responses.BR1 = pt([["2026-10-02T10:00:00Z", "TR"], ["2026-10-02T07:00:00-03:00", "TR"]]);
    expect((await req("POST", `/shipments/${s.id}/refresh`)).body.events).toHaveLength(1);
  });

  it("entregue é terminal e guarda delivered_at; evento posterior só entra no histórico", async () => {
    const { req, register, responses } = makeEnv();
    const s = await register("BR1");
    responses.BR1 = pt([["2026-10-03T10:00:00Z", "DL"], ["2026-10-04T10:00:00Z", "TR"]]);
    const r = await req("POST", `/shipments/${s.id}/refresh`);
    expect(r.body).toMatchObject({ status: "delivered", delivered_at: "2026-10-03T10:00:00.000Z" });
    expect(r.body.events).toHaveLength(2);
  });

  it("exceção resolvida por novo evento volta a andar", async () => {
    const { req, register, responses } = makeEnv();
    const s = await register("BR1");
    responses.BR1 = pt([["2026-10-02T10:00:00Z", "EX"]]);
    expect((await req("POST", `/shipments/${s.id}/refresh`)).body.status).toBe("exception");
    responses.BR1 = pt([["2026-10-02T10:00:00Z", "EX"], ["2026-10-03T10:00:00Z", "TR"]]);
    expect((await req("POST", `/shipments/${s.id}/refresh`)).body.status).toBe("in_transit");
  });
});

describe("status inventado pela transportadora", () => {
  it("vira exception, não delivered, e o bruto fica guardado", async () => {
    const { req, register, responses } = makeEnv();
    const s = await register("BR1");
    responses.BR1 = pt([["2026-10-01T10:00:00Z", "PO"], ["2026-10-02T10:00:00Z", "ENTREGUE_QUASE"]]);
    const r = await req("POST", `/shipments/${s.id}/refresh`);
    expect(r.body.status).toBe("exception");
    expect(r.body.delivered_at).toBeNull();
    expect(r.body.events.at(-1)).toMatchObject({ status: "exception", raw_status: "ENTREGUE_QUASE" });
  });
});

describe("atraso com data controlada (limite 120h)", () => {
  const H = 3600_000;
  const setup = async () => {
    const env = makeEnv();
    const s = await env.register("BR1"); // shipped_at = T0
    env.responses.BR1 = pt([["2026-10-01T10:00:00Z", "TR"]]);
    await env.req("POST", `/shipments/${s.id}/refresh`);
    return { ...env, id: s.id };
  };
  const delayed = async (env: Awaited<ReturnType<typeof setup>>) =>
    (await env.req("GET", `/shipments/${env.id}`)).body.delayed;

  it("dentro do limite não atrasa", async () => {
    const env = await setup();
    env.clock.advance(120 * H - 1);
    expect(await delayed(env)).toBe(false);
  });

  it("no limite exato não atrasa", async () => {
    const env = await setup();
    env.clock.advance(120 * H);
    expect(await delayed(env)).toBe(false);
    expect(env.notifier.sent).toHaveLength(0);
  });

  it("1 ms acima do limite atrasa", async () => {
    const env = await setup();
    env.clock.advance(120 * H + 1);
    expect(await delayed(env)).toBe(true);
  });

  it("entregue acima do limite não é atraso", async () => {
    const env = await setup();
    env.responses.BR1 = pt([["2026-10-05T10:00:00Z", "DL"]]);
    await env.req("POST", `/shipments/${env.id}/refresh`);
    env.clock.advance(500 * H);
    expect(await delayed(env)).toBe(false);
    expect((await env.req("GET", "/shipments/delayed")).body).toEqual([]);
    expect(env.notifier.sent).toHaveLength(0);
  });

  it("alerta sai uma vez só, mesmo consultando várias vezes", async () => {
    const env = await setup();
    env.clock.advance(121 * H);
    await delayed(env);
    await delayed(env);
    await env.req("GET", "/shipments/delayed");
    await env.req("POST", `/shipments/${env.id}/refresh`);
    expect(env.notifier.sent).toHaveLength(1);
    expect(env.notifier.sent[0]).toMatchObject({ shipment_id: env.id, tracking_code: "BR1" });
    const g = await env.req("GET", `/shipments/${env.id}`);
    expect(g.body.delay_alerted_at).toBe(new Date(Date.parse("2026-10-01T00:00:00.000Z") + 121 * H).toISOString());
  });

  it("GET /shipments/delayed lista só os atrasados", async () => {
    const env = await setup();
    await env.register("BR2", { shipped_at: new Date(env.clock().getTime() + 200 * H).toISOString() });
    env.clock.advance(121 * H);
    const list = (await env.req("GET", "/shipments/delayed")).body;
    expect(list.map((s: any) => s.tracking_code)).toEqual(["BR1"]);
  });

  it("limite configurável", async () => {
    const env = makeEnv({ hours: 1 });
    const s = await env.register("BR1");
    env.clock.advance(H + 1);
    expect((await env.req("GET", `/shipments/${s.id}`)).body.delayed).toBe(true);
  });
});
