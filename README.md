# ACP Example

Minimal implementation of the [Agentic Commerce Protocol (ACP)](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol) — spec version 2026-01-30.

Built to understand ACP from the inside. Implements both sides: a merchant server and an agent client.

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

Compare with [ucp-example](../ucp-example/) for the MCP-native transport version.
