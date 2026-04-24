# ACP Implementation Observations

Protocol: Agentic Commerce Protocol (ACP)  
Spec version: 2026-01-30  
Maintainers: OpenAI + Stripe  
Built: 2026-04-22

This file logs what was discovered building a minimal ACP merchant + agent implementation from scratch. Updated during and after the build. This is the real product — not the code.

---

## 1. API-Version Header Is Mandatory (But Underspecified)

The spec requires a date-based `API-Version` header on every request. What it doesn't specify:
- What happens if the version is unsupported (vs. just missing)?
- Should the merchant return a 4xx or negotiate down?
- No `Accept-Version` equivalent — agent can't discover supported versions.

In practice: merchants will likely just accept any version string and ignore it, which defeats the purpose. Needs a version negotiation mechanism.

## 2. "Ready for Payment" Is Merchant-Defined, Not Protocol-Defined

The spec defines `status: "not_ready_for_payment"` and `status: "ready_for_payment"` but doesn't define what transitions a session to ready. Each merchant decides what fields are required.

**Implication for agents:** An agent can't know ahead of time what fields to provide. It must create a session, check the status, infer from missing fields, and retry. The spec doesn't provide a "required fields" list in the response — agents have to guess or fail.

**Comparison to x402:** x402 is stateless. The agent either has the payment or it doesn't. No session state, no readiness concept. ACP's session model is more expressive but requires more round-trips.

## 3. Allowance Is the Strongest Per-Transaction Control in Any Protocol

The Allowance object is well-designed for single-transaction safety:
- `checkout_session_id` — can only be used for this session
- `merchant_id` — can only be used at this merchant
- `expires_at` — time-bounded
- `max_amount` — amount-bounded
- `reason: "one_time"` — no reuse

This is stronger than AP2's mandate system for individual transactions. AP2 mandates are pre-authorized spending envelopes; an Allowance is a scoped proof of authorization for a specific purchase.

## 4. The Cross-Merchant Budget Gap (Core Observation)

**This is the structural gap the talk is about.**

An agent with a $500 budget buys via ACP at two merchants:

```
Agent budget: $500

Purchase 1: TOKEN2049 ticket via ACP (TicketShop)
  Allowance: max_amount=$29,900, merchant_id=ticketshop, session=cs_ABC
  → Approved. Merchant charges $299.

Purchase 2: Anthropic API subscription via ACP (AnthropicShop)
  Allowance: max_amount=$25,000, merchant_id=anthropicshop, session=cs_DEF
  → Approved. Merchant charges $250.

Total spent: $549
Budget: $500
Overflow: $49
```

Neither merchant knows about the other transaction. The Allowance is scoped to `merchant_id + checkout_session_id`. There is no cross-merchant Allowance, no shared budget registry, no protocol-level enforcement.

The agent is the only party that could track total spend — but:
1. Agents don't natively have persistent state across sessions
2. Nothing in ACP requires agents to do budget tracking
3. The wallet/payment provider who issued the card could enforce it, but ACP doesn't define a wallet protocol

**This gap persists regardless of which commerce protocol wins (ACP or UCP).**

## 5. Allowance reason: "one_time" Only

The spec currently only defines `reason: "one_time"`. There's no:
- `reason: "subscription"` for recurring agent spending
- `reason: "budget"` for multi-session spending envelope
- `reason: "standing_order"` for pre-authorized regular payments

For an AI agent with a monthly SaaS subscription (e.g., Anthropic API), every renewal requires a new checkout session + new Allowance. The agent must re-run the full checkout flow each time.

**Comparison to AP2:** AP2 intent mandates support recurring authorization. An agent can get one signed mandate and use it for multiple charges within defined constraints. ACP has no equivalent.

## 6. Idempotency-Key Semantics Are Underspecified

All POST requests require an `Idempotency-Key` header. The spec doesn't specify:
- How long idempotency keys must be retained (we assume 24 hours)
- What response to return on duplicate key with different body (reject or ignore?)
- Whether idempotency applies across sessions or just within

In this implementation, we generate a new UUID per request and don't actually enforce idempotency (educational example). A production implementation needs to store keys and deduplicate.

## 7. No Sandbox Environment

ACP has no public sandbox. Real testing requires:
- OpenAI merchant application (chatgpt.com/merchants)
- Stripe production account with Shared Payment Token enabled

This means most developers implementing ACP will do exactly what we did here: build both sides of the protocol and test against themselves. This increases implementation drift risk.

## 8. Payment Handlers Are Opaque to the Agent

The session response includes `payment.handlers` listing available payment methods. But the agent doesn't know which handler to use without either:
- Hardcoding handler spec strings (`dev.acp.tokenized.card`)
- Reading the spec and implementing handler-specific logic

Agents using ChatGPT's built-in ACP support won't see this — OpenAI abstracts it. But third-party agents building against ACP directly will need handler-specific code for each payment type.

## 9. What ACP Does Well

- Clean session lifecycle (create → update → complete)
- Strong per-transaction Allowance model
- Extensions framework for payments (Razorpay UPI, gift cards, etc.)
- Capability negotiation (3DS, biometric) between merchant and agent
- Idempotency built in from the start

## 10. What ACP Doesn't Do

- Cross-merchant budget tracking (none)
- Recurring/subscription authorization (none)
- MCP transport binding (REST-only — agents using MCP need an adapter layer)
- Post-purchase (returns, refunds, disputes)
- Real-time inventory / out-of-stock handling during session

---

## Comparison: ACP vs x402

| Dimension | ACP | x402 |
|-----------|-----|------|
| Session model | Stateful (create→update→complete) | Stateless (402→pay→retry) |
| Authorization | Allowance (per-session token) | EIP-3009 permit (per-request signature) |
| Cross-merchant budget | None | None |
| Recurring payments | Not supported | Not supported |
| MCP integration | REST only (adapter needed) | Native HTTP (works anywhere) |
| Crypto rails | Not supported | Native (ERC-20 on Base) |
| Complexity | High (session lifecycle) | Low (one HTTP round-trip) |

**Key insight:** ACP is better for complex commerce (cart, fulfillment, tax). x402 is better for API access and micropayments. They're not competing — they're complementary layers.

---

*Next: See ucp-example/OBSERVATIONS.md for UCP comparison.*  
*See CROSS_PROTOCOL.md (root) for the budget gap scenario with both protocols.*
