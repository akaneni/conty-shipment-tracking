# Rastreio do produto enviado ao criador (shipment-tracking)

Origem: enunciado 07 + decisões do grill. Tamanho: Medium.

## Requisitos

| ID | Requisito | Aceite |
|----|-----------|--------|
| TRK-01 | Cadastrar código de rastreio (`POST /shipments`), com `carrier` e `shipped_at` opcionais. | 201; código repetido -> 409; corpo inválido -> 400. |
| TRK-02 | Consultar o agregador (`POST /shipments/:id/refresh`) por trás da interface `TrackingProvider`; a tradução (`normalize`) fica isolada no adaptador. | Domínio nunca lê o formato bruto; segundo adaptador fake funciona sem alterar o domínio. |
| TRK-03 | Status normalizados: `posted`, `in_transit`, `out_for_delivery`, `delivered`, `exception`. | Todo evento guardado tem um desses. |
| TRK-04 | Status atual = evento de maior `occurred_at` (empate: maior rank). Evento antigo não regride. | Teste de eventos fora de ordem. |
| TRK-05 | `delivered` é terminal: depois dele nada muda o status. `exception` pode ser seguida de novo status. | Testes dedicados. |
| TRK-06 | Status desconhecido vira `exception`, com o texto bruto em `raw_status`. Nunca `delivered`. | Teste com status inventado. |
| TRK-07 | Histórico sem duplicata, por `(shipment_id, occurred_at, raw_status)`. | Mesmo evento duas vezes e refresh repetido. |
| TRK-08 | Atraso = não entregue E `agora - shipped_at > TRANSIT_ALERT_HOURS` (estrito). Entregue nunca é atraso. Relógio injetável. | Testes: dentro, no limite exato, +1 ms, entregue. |
| TRK-09 | Alerta de atraso uma vez por pacote (`delay_alerted_at`), via `Notifier` (implementação em memória). | Teste de alerta único. |
| TRK-10 | `GET /shipments/:id` (status, histórico, `delayed`) e `GET /shipments/delayed`. | Testes HTTP. |
| TRK-11 | README com payload bruto e normalizado, regra de atraso, nota de SLA por transportadora, o que ficou de fora, nota de IA. | Revisão do README. |

## Decisões além da spec
- `shipped_at` vem do corpo do cadastro; se ausente, é o relógio no cadastro.
- Falha do agregador no refresh -> 502; resposta bruta mal formada ou data inválida também (`ProviderError`).
- Ranks: posted 1, in_transit 2, out_for_delivery 3, exception 4, delivered 5.
- `delivered_at` = menor `occurred_at` entre os eventos `delivered`.
