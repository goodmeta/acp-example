// ACP Agent Client — simulates an AI agent buying a conference ticket
// Drives the full checkout lifecycle against the ACP merchant server:
//   1. Create session
//   2. Update with fulfillment details
//   3. Delegate payment (get vt_ token)
//   4. Complete checkout
//
// Run: tsx src/client.ts
// (requires server running on PORT 3000)

const BASE_URL = `http://localhost:${process.env.PORT ?? 3000}`
const API_VERSION = "2026-01-30"

function acpFetch(path: string, options: RequestInit = {}) {
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "API-Version": API_VERSION,
      "Idempotency-Key": crypto.randomUUID(),
      ...(options.headers ?? {}),
    },
  })
}

function log(step: string, data: unknown) {
  console.log(`\n${"─".repeat(60)}`)
  console.log(`STEP: ${step}`)
  console.log("─".repeat(60))
  console.log(JSON.stringify(data, null, 2))
}

async function runCheckout() {
  console.log("ACP Agent — Buying TOKEN2049 VIP Pass")
  console.log("Protocol: Agentic Commerce Protocol v2026-01-30")
  console.log("Merchant: TicketShop (localhost:3000)\n")

  // ── Step 1: Create checkout session ──────────────────────────────────────
  const createRes = await acpFetch("/checkout_sessions", {
    method: "POST",
    body: JSON.stringify({
      line_items: [{ id: "token2049-vip", quantity: 1 }],
      capabilities: { interventions: { supported: ["3ds"] } },
    }),
  })
  const session = await createRes.json() as Record<string, unknown>
  log("1. Create Session", {
    id: session["id"],
    status: session["status"],
    totals: session["totals"],
    payment_handlers: (session["payment"] as Record<string, unknown>)["handlers"],
  })

  const sessionId = session["id"] as string
  const sessionTotal = (session["totals"] as Array<{ type: string; amount: number }>)
    .find((t) => t.type === "total")?.amount ?? 0

  // OBSERVATION: Session starts as "not_ready_for_payment" — payment not available
  // until fulfillment details are provided. ACP separates these concerns explicitly.

  // ── Step 2: Update session with fulfillment details ───────────────────────
  const updateRes = await acpFetch(`/checkout_sessions/${sessionId}`, {
    method: "POST",
    body: JSON.stringify({
      fulfillment_details: {
        name: "Alice Agent",
        email: "alice@example.com",
        address: {
          line_one: "1 Raffles Place",
          city: "Singapore",
          state: "Singapore",
          country: "SG",
          postal_code: "048616",
        },
      },
      selected_fulfillment_options: [
        { id: "email-delivery", item_ids: ["token2049-vip"] },
      ],
    }),
  })
  const updatedSession = await updateRes.json() as Record<string, unknown>
  log("2. Update Session (fulfillment)", {
    status: updatedSession["status"],
    fulfillment_details: updatedSession["fulfillment_details"],
    selected_fulfillment_options: updatedSession["selected_fulfillment_options"],
  })

  // OBSERVATION: Status transitions to "ready_for_payment" automatically once
  // fulfillment is provided. Merchant controls this logic — ACP doesn't specify
  // exactly what "ready" means, leaving it to the merchant. This means agents
  // can't predict what fields are needed without probing.

  // ── Step 3: Tokenize payment via delegate_payment ─────────────────────────
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 min
  const delegateRes = await acpFetch("/agentic_commerce/delegate_payment", {
    method: "POST",
    body: JSON.stringify({
      payment_method: {
        type: "card",
        number: "4242424242424242",
        display_last4: "4242",
        display_brand: "visa",
      },
      allowance: {
        reason: "one_time",
        max_amount: sessionTotal,       // must cover the session total
        currency: "usd",
        checkout_session_id: sessionId, // scoped to THIS session
        merchant_id: "ticketshop",      // scoped to THIS merchant
        expires_at: expiresAt,
      },
      risk_signals: [],
    }),
  })
  const delegateToken = await delegateRes.json() as Record<string, unknown>
  log("3. Delegate Payment (get vt_ token)", delegateToken)

  // OBSERVATION: The Allowance is dual-scoped: checkout_session_id + merchant_id.
  // This means:
  // - A token issued for session cs_ABC at ticketshop cannot be used at vendor_XYZ
  // - A token issued for session cs_ABC cannot be used for session cs_DEF
  // This is strong per-transaction protection, but it means there is NO mechanism
  // in ACP to track an agent's total spending across multiple merchants or sessions.
  // If an agent has a $500 budget and buys at 3 merchants, each Allowance is
  // independent. Budget overflow is invisible to all parties.

  const credentialToken = delegateToken["id"] as string

  // ── Step 4: Complete checkout ─────────────────────────────────────────────
  const completeRes = await acpFetch(`/checkout_sessions/${sessionId}/complete`, {
    method: "POST",
    body: JSON.stringify({
      payment: {
        handler_id: "mock-card-handler",
        credential_token: credentialToken,
      },
    }),
  })
  const completedSession = await completeRes.json() as Record<string, unknown>
  log("4. Complete Checkout", {
    status: completedSession["status"],
    order: completedSession["order"],
  })

  // ── Summary ───────────────────────────────────────────────────────────────
  const order = completedSession["order"] as Record<string, unknown>
  console.log("\n" + "═".repeat(60))
  console.log("CHECKOUT COMPLETE")
  console.log("═".repeat(60))
  console.log(`Order ID:    ${order?.["id"]}`)
  console.log(`Total:       $${((order?.["total"] as number ?? 0) / 100).toFixed(2)} USD`)
  console.log(`Status:      ${order?.["status"]}`)
  console.log(`Session:     ${sessionId}`)
  console.log("\nSee OBSERVATIONS.md for implementation notes.")
}

runCheckout().catch((err) => {
  console.error("Agent failed:", err)
  process.exit(1)
})
