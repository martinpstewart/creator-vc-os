import { createClient } from '@/lib/supabase-server'
import { getCurrentRole } from '@/lib/auth-server'
import CatalogueClient from '@/components/catalogue/CatalogueClient'
import type { Campaign, Product, Variant } from '@/components/catalogue/types'

export const dynamic = 'force-dynamic'

// The "Name" column has a capital N (quoted identifier). PostgREST is
// case-sensitive on identifiers, so we alias to lowercase `name` for the
// JS side — keeps the client component clean.
const CAMPAIGN_COLS = 'id, name:"Name", legacy_code'
const PRODUCT_COLS = 'id, campaign_id, name:"Name", legacy_code, requires_address, ships_separately, notes'
const VARIANT_COLS = 'id, campaign_id, product_id, name:"Name", legacy_code, default_price, currency, source_type'

export default async function CataloguePage() {
  const supabase = await createClient()
  // Role decides delete-button visibility — admin sees Trash2 buttons,
  // team gets read + create + update only (CRU not D). Enforced in the
  // UI per the role rule; underlying products/variants tables remain
  // server-writable for any authenticated user, so this is a UX
  // boundary not a security one. DB-level enforcement (RLS or a
  // SECURITY DEFINER delete RPC gated on admin) would be a follow-up.
  const role = await getCurrentRole()

  const [campaignsRes, productsRes, variantsRes, inboxCountRes, mapRes] = await Promise.all([
    supabase.schema('aa_01_campaigns').from('campaigns').select(CAMPAIGN_COLS).order('id'),
    supabase.schema('aa_01_campaigns').from('products').select(PRODUCT_COLS).order('id'),
    supabase.schema('aa_01_campaigns').from('variants').select(VARIANT_COLS).order('id'),
    supabase
      .schema('aa_01_campaigns')
      .from('shopify_product_inbox')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
    supabase
      .schema('aa_01_campaigns')
      .from('shopify_variants_map')
      .select('variant_legacy_code'),
  ])

  // Build a set of variant legacy_codes that have at least one Shopify mapping.
  const mappedLegacyCodes = new Set<string>(
    ((mapRes.data ?? []) as { variant_legacy_code: string | null }[])
      .map((r) => r.variant_legacy_code)
      .filter((c): c is string => !!c),
  )

  return (
    <CatalogueClient
      role={role}
      campaigns={(campaignsRes.data ?? []) as Campaign[]}
      products={(productsRes.data ?? []) as Product[]}
      variants={(variantsRes.data ?? []) as Variant[]}
      mappedLegacyCodes={Array.from(mappedLegacyCodes)}
      pendingInboxCount={inboxCountRes.count ?? 0}
      errors={{
        campaigns: campaignsRes.error?.message ?? null,
        products: productsRes.error?.message ?? null,
        variants: variantsRes.error?.message ?? null,
      }}
    />
  )
}
