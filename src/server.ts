// ACP Merchant Server — TicketShop
// Implements the Agentic Commerce Protocol (ACP) spec: 2026-01-30
// Spec: github.com/agentic-commerce-protocol/agentic-commerce-protocol
//
// Endpoints:
//   POST   /checkout_sessions                    — create session
//   GET    /checkout_sessions/:id                — get session
//   POST   /checkout_sessions/:id                — update session
//   POST   /checkout_sessions/:id/complete       — complete checkout
//   POST   /checkout_sessions/:id/cancel         — cancel session
//   POST   /agentic_commerce/delegate_payment    — tokenize payment credentials

import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { logger } from "hono/logger"
import type {
  CheckoutSession,
  LineItem,
  Total,
  CreateSessionRequest,
  UpdateSessionRequest,
  CompleteSessionRequest,
  DelegatePaymentRequest,
  DelegatePaymentResponse,
  FulfillmentOption,
} from "./types.js"

const MERCHANT_ID = process.env.MERCHANT_ID ?? "ticketshop"
const PORT = Number(process.env.PORT ?? 3000)

// Product catalog
const CATALOG: Record<string, { title: string; unit_price: number; tax_rate: number }> = {
  "token2049-vip": {
    title: "TOKEN2049 Singapore VIP Pass",
    unit_price: 29900, // $299.00 in cents
    tax_rate: 0.09,    // 9% GST (Singapore)
  },
}

const FULFILLMENT_OPTIONS: FulfillmentOption[] = [
  {
    id: "email-delivery",
    title: "Email Delivery (instant)",
    cost: 0,
    item_ids: ["token2049-vip"],
  },
  {
    id: "physical-badge",
    title: "Physical Badge (pick up at venue)",
    cost: 0,
    item_ids: ["token2049-vip"],
  },
]

// In-memory session store (Map: id → session)
const sessions = new Map<string, CheckoutSession>()

function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`
}

function computeTotals(lineItems: LineItem[], fulfillmentCost: number): Total[] {
  const subtotal = lineItems.reduce((sum, item) => sum + item.subtotal, 0)
  const tax = lineItems.reduce((sum, item) => sum + item.tax, 0)
  const total = subtotal + tax + fulfillmentCost
  const totals: Total[] = [
    { type: "subtotal", amount: subtotal },
    { type: "tax", amount: tax },
  ]
  if (fulfillmentCost > 0) totals.push({ type: "fulfillment", amount: fulfillmentCost })
  totals.push({ type: "total", amount: total })
  return totals
}

function getSessionTotal(session: CheckoutSession): number {
  return session.totals.find((t) => t.type === "total")?.amount ?? 0
}

function isReadyForPayment(session: CheckoutSession): boolean {
  return (
    session.fulfillment_details !== null &&
    session.selected_fulfillment_options.length > 0
  )
}

const app = new Hono()
app.use(logger())

// Require API-Version header (ACP spec requires date-based versioning)
app.use("*", async (c, next) => {
  const version = c.req.header("API-Version")
  if (!version) {
    return c.json({ error: "Missing API-Version header. Use: API-Version: 2026-01-30" }, 400)
  }
  await next()
})

// POST /checkout_sessions — create session
app.post("/checkout_sessions", async (c) => {
  const body = await c.req.json<CreateSessionRequest>()

  if (!body.line_items?.length) {
    return c.json({ error: "line_items required" }, 400)
  }

  const lineItems: LineItem[] = []
  for (const req of body.line_items) {
    const product = CATALOG[req.id]
    if (!product) {
      return c.json({ error: `Unknown product: ${req.id}` }, 404)
    }
    const subtotal = product.unit_price * req.quantity
    const tax = Math.round(subtotal * product.tax_rate)
    lineItems.push({
      id: req.id,
      title: product.title,
      quantity: req.quantity,
      unit_price: product.unit_price,
      base_amount: subtotal,
      discount: 0,
      subtotal,
      tax,
      total: subtotal + tax,
    })
  }

  const session: CheckoutSession = {
    id: generateId("cs"),
    status: "not_ready_for_payment",
    currency: "usd",
    line_items: lineItems,
    available_fulfillment_options: FULFILLMENT_OPTIONS,
    fulfillment_details: null,
    selected_fulfillment_options: [],
    totals: computeTotals(lineItems, 0),
    payment: {
      handlers: [
        {
          id: "mock-card-handler",
          spec: "dev.acp.tokenized.card",
          psp: "mock",
          requires_pci_compliance: false,
          requires_delegate_payment: true,
          display_name: "Credit/Debit Card",
        },
      ],
      selected_handler_id: null,
      credential_token: null,
    },
    capabilities: {
      interventions: {
        // Intersection of agent capabilities (from request) and what we support
        supported: body.capabilities?.interventions?.supported?.filter((i) =>
          ["3ds"].includes(i)
        ) ?? [],
        required: [],
      },
    },
    messages: [],
    order: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  sessions.set(session.id, session)
  console.log(`[ACP] Session created: ${session.id}`)
  return c.json(session, 201)
})

// GET /checkout_sessions/:id — get session
app.get("/checkout_sessions/:id", (c) => {
  const session = sessions.get(c.req.param("id"))
  if (!session) return c.json({ error: "Session not found" }, 404)
  return c.json(session)
})

// POST /checkout_sessions/:id — update session
app.post("/checkout_sessions/:id", async (c) => {
  const session = sessions.get(c.req.param("id"))
  if (!session) return c.json({ error: "Session not found" }, 404)

  if (session.status === "completed" || session.status === "canceled") {
    return c.json({ error: `Cannot update session in status: ${session.status}` }, 409)
  }

  const body = await c.req.json<UpdateSessionRequest>()

  if (body.fulfillment_details) {
    session.fulfillment_details = body.fulfillment_details
  }

  if (body.selected_fulfillment_options) {
    session.selected_fulfillment_options = body.selected_fulfillment_options
    // Recalculate totals with fulfillment cost
    const selectedOption = FULFILLMENT_OPTIONS.find(
      (o) => o.id === body.selected_fulfillment_options![0]?.id
    )
    session.totals = computeTotals(session.line_items, selectedOption?.cost ?? 0)
  }

  session.status = isReadyForPayment(session) ? "ready_for_payment" : "not_ready_for_payment"
  session.updated_at = new Date().toISOString()

  console.log(`[ACP] Session updated: ${session.id} → ${session.status}`)
  return c.json(session)
})

// POST /checkout_sessions/:id/complete — finalize checkout
app.post("/checkout_sessions/:id/complete", async (c) => {
  const session = sessions.get(c.req.param("id"))
  if (!session) return c.json({ error: "Session not found" }, 404)

  if (session.status !== "ready_for_payment") {
    return c.json(
      { error: `Session not ready for payment. Status: ${session.status}` },
      409
    )
  }

  const body = await c.req.json<CompleteSessionRequest>()

  if (!body.payment?.credential_token) {
    return c.json({ error: "payment.credential_token required" }, 400)
  }

  // Verify credential token was issued by our delegate_payment endpoint
  if (!body.payment.credential_token.startsWith("vt_")) {
    return c.json({ error: "Invalid credential token" }, 400)
  }

  session.payment.selected_handler_id = body.payment.handler_id
  session.payment.credential_token = body.payment.credential_token
  session.status = "completed"
  session.order = {
    id: generateId("ord"),
    created_at: new Date().toISOString(),
    status: "confirmed",
    total: getSessionTotal(session),
    currency: session.currency,
  }
  session.updated_at = new Date().toISOString()

  console.log(`[ACP] Session completed: ${session.id} → order ${session.order.id}`)
  return c.json(session)
})

// POST /checkout_sessions/:id/cancel — cancel session
app.post("/checkout_sessions/:id/cancel", (c) => {
  const session = sessions.get(c.req.param("id"))
  if (!session) return c.json({ error: "Session not found" }, 404)

  if (session.status === "completed") {
    return c.json({ error: "Cannot cancel completed session" }, 409)
  }

  session.status = "canceled"
  session.updated_at = new Date().toISOString()

  console.log(`[ACP] Session canceled: ${session.id}`)
  return c.json(session)
})

// POST /agentic_commerce/delegate_payment — tokenize payment credentials
// In a real implementation this would call Stripe/Adyen to vault the card.
// Here we validate the Allowance and return a mock vt_ token.
app.post("/agentic_commerce/delegate_payment", async (c) => {
  const body = await c.req.json<DelegatePaymentRequest>()

  const { allowance } = body

  // Validate allowance fields
  if (!allowance) return c.json({ error: "allowance required" }, 400)
  if (allowance.reason !== "one_time") {
    return c.json({ error: `Unsupported allowance reason: ${allowance.reason}` }, 400)
  }
  if (allowance.merchant_id !== MERCHANT_ID) {
    return c.json({ error: `merchant_id mismatch: expected ${MERCHANT_ID}` }, 400)
  }
  if (new Date(allowance.expires_at) <= new Date()) {
    return c.json({ error: "Allowance expired" }, 400)
  }

  // Verify session exists and allowance covers the total
  const session = sessions.get(allowance.checkout_session_id)
  if (!session) {
    return c.json({ error: `Session not found: ${allowance.checkout_session_id}` }, 404)
  }

  const sessionTotal = getSessionTotal(session)
  if (allowance.max_amount < sessionTotal) {
    return c.json(
      {
        error: `Allowance max_amount (${allowance.max_amount}) is less than session total (${sessionTotal})`,
      },
      400
    )
  }

  // Issue mock vaulted token
  const token: DelegatePaymentResponse = {
    id: generateId("vt"),
    created: new Date().toISOString(),
    metadata: {
      merchant_id: MERCHANT_ID,
      checkout_session_id: allowance.checkout_session_id,
      last4: body.payment_method.display_last4,
    },
  }

  console.log(`[ACP] Delegate payment tokenized: ${token.id} for session ${allowance.checkout_session_id}`)
  return c.json(token, 201)
})

// Start server
serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`[ACP] TicketShop merchant server running on http://localhost:${PORT}`)
  console.log(`[ACP] Merchant ID: ${MERCHANT_ID}`)
  console.log(`[ACP] Catalog: ${Object.keys(CATALOG).join(", ")}`)
})
