# ACP Example

Minimal implementation of the [Agentic Commerce Protocol (ACP)](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol) — spec version 2026-01-30.

Built to understand ACP from the inside. Implements both sides: a merchant server and an agent client.

> **Spec currency.** This tracks **2026-01-30**. Upstream has since published
> **2026-04-17**, and this example has not been updated to it. What that version
> adds and this does not implement:
>
> - **3-D Secure results** — an `authentication_result` carrying `outcome` plus
>   `three_ds_cryptogram`, `electronic_commerce_indicator`, `transaction_id` and
>   `version`. Note the client here already advertises
>   `capabilities.interventions.supported: ["3ds"]`, so against 2026-04-17 it
>   claims a capability whose result shape the server does not produce.
> - **Out-of-stock sessions** — a checkout session state for unavailable items.
> - `display_name` on payment handlers.
>
> 2026-04-17 also **drops** `authentication_metadata.channel.browser.*` (the
> browser-fingerprinting block). This example never implemented it, so nothing
> here is stale in that direction.
>
> Everything below is accurate for 2026-01-30. Treat it as a reading of that
> version, not as a current-spec reference.

## What's here

- `src/server.ts` — ACP merchant (TicketShop), selling TOKEN2049 VIP passes
- `src/client.ts` — AI agent that buys a ticket via the full ACP checkout flow
- `src/types.ts` — ACP types (CheckoutSession, Allowance, etc.)
- `OBSERVATIONS.md` — What we learned implementing this from scratch

## Run it

```bash
npm install

# Terminal 1: start the merchant server
npm run server

# Terminal 2: run the agent
npm run client
```

The agent creates a session, adds fulfillment details, gets a delegate payment token (with Allowance constraints), and completes the checkout.

## Key observations

See [OBSERVATIONS.md](./OBSERVATIONS.md) for the full findings. The most important:

**The cross-merchant budget gap.** ACP's Allowance is scoped to a single `merchant_id + checkout_session_id`. An agent with a $500 budget buying at 3 merchants gets 3 independent Allowances. Total spend is tracked nowhere. This is a structural gap in every commerce protocol — not just ACP.

## Protocol

ACP is a REST protocol (no MCP binding). Agents call merchant endpoints directly via HTTP with `API-Version` and `Idempotency-Key` headers.

Compare with [ucp-example](https://github.com/goodmeta/ucp-example) for the MCP-native transport version.
