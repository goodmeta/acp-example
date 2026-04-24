// ACP (Agentic Commerce Protocol) types
// Spec: github.com/agentic-commerce-protocol/agentic-commerce-protocol
// Version: 2026-01-30

export type CheckoutStatus =
  | "not_ready_for_payment"
  | "ready_for_payment"
  | "completed"
  | "canceled"

export type TotalType = "subtotal" | "tax" | "fulfillment" | "discount" | "total"

export type Total = {
  type: TotalType
  amount: number // minor currency units (cents)
}

export type LineItem = {
  id: string
  title: string
  quantity: number
  unit_price: number // minor currency units
  base_amount: number
  discount: number
  subtotal: number
  tax: number
  total: number
}

export type Address = {
  line_one: string
  line_two?: string
  city: string
  state: string
  country: string
  postal_code: string
}

export type FulfillmentDetails = {
  name: string
  phone?: string
  email: string
  address: Address
}

export type FulfillmentOption = {
  id: string
  title: string
  cost: number // minor currency units
  item_ids: string[]
}

export type PaymentHandler = {
  id: string
  spec: string
  psp: string
  requires_pci_compliance: boolean
  requires_delegate_payment: boolean
  display_name: string
}

export type Capabilities = {
  interventions: {
    supported: string[]
    required: string[]
  }
}

export type MessageSeverity = "info" | "warning" | "error"

export type Message = {
  severity: MessageSeverity
  code: string
  message: string
}

export type Order = {
  id: string
  created_at: string
  status: "confirmed"
  total: number
  currency: string
}

export type CheckoutSession = {
  id: string
  status: CheckoutStatus
  currency: "usd"
  line_items: LineItem[]
  available_fulfillment_options: FulfillmentOption[]
  fulfillment_details: FulfillmentDetails | null
  selected_fulfillment_options: Array<{ id: string; item_ids: string[] }>
  totals: Total[]
  payment: {
    handlers: PaymentHandler[]
    selected_handler_id: string | null
    credential_token: string | null
  }
  capabilities: Capabilities
  messages: Message[]
  order: Order | null
  created_at: string
  updated_at: string
}

// Allowance — spending constraint scoped to a single merchant + session
export type AllowanceReason = "one_time"

export type Allowance = {
  reason: AllowanceReason
  max_amount: number // minor currency units
  currency: string
  checkout_session_id: string
  merchant_id: string
  expires_at: string // ISO 8601
}

export type DelegatePaymentRequest = {
  payment_method: {
    type: "card"
    number: string
    display_last4: string
    display_brand: string
  }
  allowance: Allowance
  risk_signals: string[]
  metadata?: Record<string, string>
}

export type DelegatePaymentResponse = {
  id: string // vt_ token
  created: string
  metadata: Record<string, string>
}

// Request bodies

export type CreateSessionRequest = {
  line_items: Array<{
    id: string
    quantity: number
  }>
  capabilities?: Partial<Capabilities>
}

export type UpdateSessionRequest = {
  fulfillment_details?: FulfillmentDetails
  selected_fulfillment_options?: Array<{ id: string; item_ids: string[] }>
  capabilities?: Partial<Capabilities>
}

export type CompleteSessionRequest = {
  payment: {
    handler_id: string
    credential_token: string
  }
}
