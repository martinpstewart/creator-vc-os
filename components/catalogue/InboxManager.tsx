'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import type { Campaign, Product, Variant, InboxRow } from './types'

type ActionMode =
  | null
  | { type: 'match'; row: InboxRow }
  | { type: 'create'; row: InboxRow }

const STATUS_FILTERS = [
  { value: 'pending', label: 'Pending' },
  { value: 'matched', label: 'Matched' },
  { value: 'created', label: 'Created' },
  { value: 'dismissed', label: 'Dismissed' },
] as const

export default function InboxManager({
  campaigns,
  products,
  variants,
  onInboxCountChange,
}: {
  campaigns: Campaign[]
  products: Product[]
  variants: Variant[]
  onInboxCountChange: (n: number) => void
}) {
  const router = useRouter()
  const [rows, setRows] = useState<InboxRow[] | null>(null)
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]['value']>('pending')
  const [action, setAction] = useState<ActionMode>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const supabase = createClient()
      const { data, error: e } = await supabase
        .schema('aa_01_campaigns')
        .from('shopify_product_inbox')
        .select('*')
        .eq('status', status)
        .order('created_at', { ascending: false })
        .limit(200)
      if (cancelled) return
      if (e) setError(e.message)
      else setRows((data ?? []) as InboxRow[])
    })()
    return () => {
      cancelled = true
    }
  }, [status])

  // Push the latest pending count up to the tab badge.
  useEffect(() => {
    if (!rows) return
    if (status === 'pending') onInboxCountChange(rows.length)
  }, [rows, status, onInboxCountChange])

  async function dismiss(row: InboxRow) {
    if (!confirm(`Dismiss "${row.shopify_product_title ?? row.shopify_variant_id}"?`)) return
    setBusyId(row.id)
    setError(null)
    try {
      const supabase = createClient()
      const { error: e } = await supabase
        .schema('aa_01_campaigns')
        .from('shopify_product_inbox')
        .update({ status: 'dismissed', resolved_at: new Date().toISOString() })
        .eq('id', row.id)
      if (e) throw e
      setRows((prev) => (prev ? prev.filter((r) => r.id !== row.id) : prev))
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => {
              setStatus(f.value)
              setRows(null)
            }}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
              status === f.value ? 'bg-zinc-700 text-white' : 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-950/40 border border-red-900/60 rounded-xl px-4 py-3">
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {!rows && <p className="text-sm text-zinc-500">Loading…</p>}
      {rows && rows.length === 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-6 py-12 text-center text-sm text-zinc-500">
          Nothing here. {status === 'pending' && 'Inbox is clean.'}
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl divide-y divide-zinc-800/60">
          {rows.map((r) => (
            <div key={r.id} className="px-5 py-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-white truncate">
                      {r.shopify_product_title ?? <span className="text-zinc-500">(no title)</span>}
                    </p>
                    {r.shopify_variant_title && r.shopify_variant_title !== 'Default Title' && (
                      <span className="text-xs text-zinc-400">· {r.shopify_variant_title}</span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500 mt-1 flex items-center gap-3 flex-wrap font-mono">
                    <span>{r.shop_domain}</span>
                    <span>·</span>
                    <span>sku: {r.shopify_sku ?? '—'}</span>
                    <span>·</span>
                    <span>variant: {r.shopify_variant_id}</span>
                  </p>
                </div>
                {r.status === 'pending' && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => setAction({ type: 'match', row: r })}
                      disabled={busyId === r.id}
                      className="px-3 py-1.5 text-xs font-bold rounded-md bg-emerald-900/40 hover:bg-emerald-900/60 text-emerald-300 transition-colors disabled:opacity-50"
                    >
                      Match
                    </button>
                    <button
                      onClick={() => setAction({ type: 'create', row: r })}
                      disabled={busyId === r.id}
                      className="px-3 py-1.5 text-xs font-bold rounded-md bg-[#3B9EE8] hover:bg-[#2d8ed8] text-white transition-colors disabled:opacity-50"
                    >
                      Create
                    </button>
                    <button
                      onClick={() => dismiss(r)}
                      disabled={busyId === r.id}
                      className="px-3 py-1.5 text-xs rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors disabled:opacity-50"
                    >
                      Dismiss
                    </button>
                  </div>
                )}
                {r.status !== 'pending' && (
                  <span
                    className={`px-2 py-1 text-[10px] font-medium uppercase tracking-wide rounded ${
                      r.status === 'matched'
                        ? 'bg-emerald-900/40 text-emerald-300'
                        : r.status === 'created'
                        ? 'bg-blue-900/40 text-blue-300'
                        : 'bg-zinc-800 text-zinc-500'
                    }`}
                  >
                    {r.status}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {action?.type === 'match' && (
        <MatchDrawer
          row={action.row}
          campaigns={campaigns}
          products={products}
          variants={variants}
          onClose={() => setAction(null)}
          onResolved={(id) => {
            setRows((prev) => (prev ? prev.filter((r) => r.id !== id) : prev))
            setAction(null)
            router.refresh()
          }}
        />
      )}
      {action?.type === 'create' && (
        <CreateDrawer
          row={action.row}
          campaigns={campaigns}
          onClose={() => setAction(null)}
          onResolved={(id) => {
            setRows((prev) => (prev ? prev.filter((r) => r.id !== id) : prev))
            setAction(null)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

// ── Match drawer ────────────────────────────────────────────────────────────
function MatchDrawer({
  row,
  campaigns,
  products,
  variants,
  onClose,
  onResolved,
}: {
  row: InboxRow
  campaigns: Campaign[]
  products: Product[]
  variants: Variant[]
  onClose: () => void
  onResolved: (rowId: number) => void
}) {
  const [filter, setFilter] = useState('')
  const [picked, setPicked] = useState<Variant | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const campaignById = useMemo(() => new Map(campaigns.map((c) => [c.id, c])), [campaigns])

  const filtered = useMemo(() => {
    const needle = filter.toLowerCase().trim()
    return variants
      .filter((v) => {
        if (!needle) return true
        const p = productById.get(v.product_id)
        const c = campaignById.get(v.campaign_id)
        return (
          v.name.toLowerCase().includes(needle) ||
          v.legacy_code.toLowerCase().includes(needle) ||
          (p?.name.toLowerCase().includes(needle) ?? false) ||
          (c?.name.toLowerCase().includes(needle) ?? false)
        )
      })
      .slice(0, 60)
  }, [variants, filter, productById, campaignById])

  async function save() {
    if (!picked) return
    setSaving(true)
    setErr(null)
    try {
      const supabase = createClient()
      const product = productById.get(picked.product_id)
      // 1. Upsert the shopify_variants_map so the resolver picks variant_id next time.
      const { error: mErr } = await supabase
        .schema('aa_01_campaigns')
        .from('shopify_variants_map')
        .upsert(
          {
            campaign_id: picked.campaign_id,
            shopify_product_id: row.shopify_product_id,
            shopify_variant_id: row.shopify_variant_id,
            product_legacy_code: product?.legacy_code ?? null,
            variant_legacy_code: picked.legacy_code,
          },
          { onConflict: 'shopify_variant_id' },
        )
      if (mErr) throw mErr

      // 2. Mark inbox as matched.
      const { error: iErr } = await supabase
        .schema('aa_01_campaigns')
        .from('shopify_product_inbox')
        .update({
          status: 'matched',
          resolved_at: new Date().toISOString(),
          resolved_variant_id: picked.id,
          resolution_note: `Matched to ${product?.name ?? '?'} / ${picked.name}`,
        })
        .eq('id', row.id)
      if (iErr) throw iErr
      onResolved(row.id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer title="Match to existing variant" onClose={onClose}>
      <div className="space-y-4">
        <ShopifySummary row={row} />
        <Field label="Search variants">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="product name, variant name, legacy_code…"
            className={inputCls}
          />
        </Field>
        <div className="max-h-[40vh] overflow-y-auto border border-zinc-800 rounded-lg">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-zinc-500">No matches.</p>
          ) : (
            filtered.map((v) => {
              const p = productById.get(v.product_id)
              const c = campaignById.get(v.campaign_id)
              const isSelected = picked?.id === v.id
              return (
                <button
                  key={v.id}
                  onClick={() => setPicked(v)}
                  className={`w-full text-left px-4 py-3 border-b border-zinc-800/60 last:border-0 transition-colors ${
                    isSelected ? 'bg-[#3B9EE8]/15 border-l-2 border-l-[#3B9EE8]' : 'hover:bg-zinc-800/50'
                  }`}
                >
                  <p className="text-sm text-white">{p?.name} · {v.name}</p>
                  <p className="text-xs text-zinc-500 mt-0.5 font-mono">
                    {c?.name} · {v.legacy_code}
                  </p>
                </button>
              )
            })
          )}
        </div>
        {err && <p className="text-xs text-red-400">{err}</p>}
        <button
          onClick={save}
          disabled={!picked || saving}
          className="w-full px-4 py-2.5 text-sm font-bold rounded-md bg-[#3B9EE8] text-white hover:bg-[#2d8ed8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving…' : picked ? `Match to ${picked.name}` : 'Pick a variant above'}
        </button>
      </div>
    </Drawer>
  )
}

// ── Create drawer ───────────────────────────────────────────────────────────
function CreateDrawer({
  row,
  campaigns,
  onClose,
  onResolved,
}: {
  row: InboxRow
  campaigns: Campaign[]
  onClose: () => void
  onResolved: (rowId: number) => void
}) {
  const [campaignId, setCampaignId] = useState(row.campaign_id ?? campaigns[0]?.id ?? 0)
  // Create-new path inserts a product AND a variant in one go. UI is intentionally
  // minimal — Aaron can refine later from the Products tab.
  const [productName, setProductName] = useState(row.shopify_product_title ?? '')
  const [productLegacy, setProductLegacy] = useState('')
  const [variantName, setVariantName] = useState(row.shopify_variant_title ?? '')
  const [variantLegacy, setVariantLegacy] = useState(row.shopify_sku ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setErr(null)
    try {
      const supabase = createClient()
      // 1. Insert product
      const { data: productData, error: pErr } = await supabase
        .schema('aa_01_campaigns')
        .from('products')
        .insert({
          campaign_id: campaignId,
          Name: productName.trim(),
          legacy_code: productLegacy.trim(),
        })
        .select('id, legacy_code')
        .single()
      if (pErr) throw pErr
      const newProduct = productData as { id: number; legacy_code: string }

      // 2. Insert variant
      const { data: variantData, error: vErr } = await supabase
        .schema('aa_01_campaigns')
        .from('variants')
        .insert({
          campaign_id: campaignId,
          product_id: newProduct.id,
          Name: variantName.trim(),
          legacy_code: variantLegacy.trim(),
        })
        .select('id')
        .single()
      if (vErr) throw vErr
      const newVariant = variantData as { id: number }

      // 3. Upsert the shopify_variants_map row
      const { error: mErr } = await supabase
        .schema('aa_01_campaigns')
        .from('shopify_variants_map')
        .upsert(
          {
            campaign_id: campaignId,
            shopify_product_id: row.shopify_product_id,
            shopify_variant_id: row.shopify_variant_id,
            product_legacy_code: newProduct.legacy_code,
            variant_legacy_code: variantLegacy.trim(),
          },
          { onConflict: 'shopify_variant_id' },
        )
      if (mErr) throw mErr

      // 4. Mark inbox as created
      const { error: iErr } = await supabase
        .schema('aa_01_campaigns')
        .from('shopify_product_inbox')
        .update({
          status: 'created',
          resolved_at: new Date().toISOString(),
          resolved_variant_id: newVariant.id,
          resolution_note: `Created ${productName} / ${variantName}`,
        })
        .eq('id', row.id)
      if (iErr) throw iErr
      onResolved(row.id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer title="Create new product + variant" onClose={onClose}>
      <div className="space-y-4">
        <ShopifySummary row={row} />
        <Field label="Campaign">
          <select
            value={campaignId}
            onChange={(e) => setCampaignId(Number(e.target.value))}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-sm text-white"
          >
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Product name">
            <input value={productName} onChange={(e) => setProductName(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Product legacy_code">
            <input
              value={productLegacy}
              onChange={(e) => setProductLegacy(e.target.value)}
              className={`${inputCls} font-mono`}
              placeholder="ALIENS-EXPANDED"
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Variant name">
            <input value={variantName} onChange={(e) => setVariantName(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Variant legacy_code (=Shopify SKU)">
            <input
              value={variantLegacy}
              onChange={(e) => setVariantLegacy(e.target.value)}
              className={`${inputCls} font-mono`}
            />
          </Field>
        </div>
        {err && <p className="text-xs text-red-400">{err}</p>}
        <button
          onClick={save}
          disabled={saving || !productName.trim() || !productLegacy.trim() || !variantName.trim() || !variantLegacy.trim()}
          className="w-full px-4 py-2.5 text-sm font-bold rounded-md bg-[#3B9EE8] text-white hover:bg-[#2d8ed8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Creating…' : 'Create and link'}
        </button>
      </div>
    </Drawer>
  )
}

// ── Shared bits ─────────────────────────────────────────────────────────────
function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <aside className="relative w-full max-w-lg h-full bg-zinc-950 border-l border-zinc-800 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-zinc-950/95 backdrop-blur border-b border-zinc-800 px-5 py-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-white text-sm">✕</button>
        </div>
        <div className="p-5">{children}</div>
      </aside>
    </div>
  )
}

function ShopifySummary({ row }: { row: InboxRow }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-xs">
      <p className="text-zinc-400 font-medium">From Shopify</p>
      <dl className="grid grid-cols-3 gap-x-3 gap-y-1 mt-2 font-mono">
        <dt className="text-zinc-600">Shop</dt><dd className="col-span-2 text-zinc-300 truncate">{row.shop_domain}</dd>
        <dt className="text-zinc-600">Product</dt><dd className="col-span-2 text-zinc-300 truncate">{row.shopify_product_title ?? '—'}</dd>
        <dt className="text-zinc-600">Variant</dt><dd className="col-span-2 text-zinc-300 truncate">{row.shopify_variant_title ?? '—'}</dd>
        <dt className="text-zinc-600">SKU</dt><dd className="col-span-2 text-zinc-300">{row.shopify_sku ?? '—'}</dd>
      </dl>
    </div>
  )
}

const inputCls =
  'w-full bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-medium uppercase tracking-wide text-zinc-500 mb-1.5">{label}</label>
      {children}
    </div>
  )
}
