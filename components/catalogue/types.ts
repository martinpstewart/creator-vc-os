export type Campaign = {
  id: number
  name: string
  legacy_code: string | null
}

export type Product = {
  id: number
  campaign_id: number
  name: string
  legacy_code: string
  requires_address: boolean
  notes: string | null
}

export type Variant = {
  id: number
  campaign_id: number
  product_id: number
  name: string
  legacy_code: string
  default_price: number | null
  currency: string | null
  source_type: string
}

export type InboxRow = {
  id: number
  created_at: string
  updated_at: string
  shop_domain: string
  campaign_id: number | null
  shopify_product_id: string
  shopify_variant_id: string
  shopify_product_title: string | null
  shopify_variant_title: string | null
  shopify_sku: string | null
  status: 'pending' | 'matched' | 'created' | 'dismissed'
  resolved_variant_id: number | null
  resolution_note: string | null
}
