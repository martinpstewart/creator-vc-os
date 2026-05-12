'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronRight, Plus, Pencil, Trash2, X } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import type { Campaign, Product, Variant } from './types'

type EditMode =
  | null
  | { type: 'new-product'; campaignId: number }
  | { type: 'edit-product'; product: Product }
  | { type: 'new-variant'; campaignId: number; productId: number }
  | { type: 'edit-variant'; variant: Variant }

export default function ProductsManager({
  campaigns,
  products,
  variants,
  mappedLegacyCodes,
}: {
  campaigns: Campaign[]
  products: Product[]
  variants: Variant[]
  mappedLegacyCodes: Set<string>
}) {
  const router = useRouter()
  const [expanded, setExpanded] = useState<Set<number>>(new Set(campaigns.map((c) => c.id)))
  const [edit, setEdit] = useState<EditMode>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function deleteProduct(p: Product) {
    if (!confirm(`Delete "${p.name}" and all its variants? This cannot be undone.`)) return
    setBusy(true)
    setError(null)
    try {
      const supabase = createClient()
      // Delete child variants first (no ON DELETE CASCADE on this FK in production).
      const { error: vErr } = await supabase
        .schema('aa_01_campaigns')
        .from('variants')
        .delete()
        .eq('product_id', p.id)
      if (vErr) throw vErr
      const { error: pErr } = await supabase
        .schema('aa_01_campaigns')
        .from('products')
        .delete()
        .eq('id', p.id)
      if (pErr) throw pErr
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function deleteVariant(v: Variant) {
    if (!confirm(`Delete variant "${v.name}"?`)) return
    setBusy(true)
    setError(null)
    try {
      const supabase = createClient()
      const { error: dErr } = await supabase
        .schema('aa_01_campaigns')
        .from('variants')
        .delete()
        .eq('id', v.id)
      if (dErr) throw dErr
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-950/40 border border-red-900/60 rounded-xl px-4 py-3">
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {campaigns.map((campaign) => {
        const camPgProducts = products.filter((p) => p.campaign_id === campaign.id)
        const isOpen = expanded.has(campaign.id)
        return (
          <div key={campaign.id} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <button
              onClick={() => toggle(campaign.id)}
              className="w-full flex items-center justify-between px-5 py-4 hover:bg-zinc-800/40 transition-colors"
            >
              <div className="flex items-center gap-3">
                {isOpen ? <ChevronDown size={16} className="text-zinc-500" /> : <ChevronRight size={16} className="text-zinc-500" />}
                <div className="text-left">
                  <p className="text-sm font-semibold text-white">{campaign.name}</p>
                  <p className="text-xs text-zinc-500 mt-0.5 font-mono">
                    {campaign.legacy_code} · {camPgProducts.length} product{camPgProducts.length === 1 ? '' : 's'}
                  </p>
                </div>
              </div>
              <span
                onClick={(e) => {
                  e.stopPropagation()
                  setEdit({ type: 'new-product', campaignId: campaign.id })
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md bg-[#3B9EE8] text-white hover:bg-[#2d8ed8] transition-colors cursor-pointer"
              >
                <Plus size={14} />
                Product
              </span>
            </button>

            {isOpen && (
              <div className="border-t border-zinc-800">
                {camPgProducts.length === 0 ? (
                  <p className="px-6 py-8 text-center text-sm text-zinc-500">No products yet.</p>
                ) : (
                  camPgProducts.map((p) => (
                    <ProductBlock
                      key={p.id}
                      product={p}
                      variants={variants.filter((v) => v.product_id === p.id)}
                      mappedLegacyCodes={mappedLegacyCodes}
                      busy={busy}
                      onEditProduct={() => setEdit({ type: 'edit-product', product: p })}
                      onDeleteProduct={() => deleteProduct(p)}
                      onAddVariant={() => setEdit({ type: 'new-variant', campaignId: p.campaign_id, productId: p.id })}
                      onEditVariant={(v) => setEdit({ type: 'edit-variant', variant: v })}
                      onDeleteVariant={(v) => deleteVariant(v)}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        )
      })}

      {edit && (
        <EditDrawer
          mode={edit}
          campaigns={campaigns}
          products={products}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

function ProductBlock({
  product,
  variants,
  mappedLegacyCodes,
  busy,
  onEditProduct,
  onDeleteProduct,
  onAddVariant,
  onEditVariant,
  onDeleteVariant,
}: {
  product: Product
  variants: Variant[]
  mappedLegacyCodes: Set<string>
  busy: boolean
  onEditProduct: () => void
  onDeleteProduct: () => void
  onAddVariant: () => void
  onEditVariant: (v: Variant) => void
  onDeleteVariant: (v: Variant) => void
}) {
  return (
    <div className="border-b border-zinc-800/60 last:border-0">
      <div className="flex items-start justify-between gap-4 px-6 py-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">{product.name}</p>
          <p className="text-xs text-zinc-500 mt-0.5 font-mono">{product.legacy_code}</p>
          <div className="flex flex-wrap gap-2 mt-2">
            {product.requires_address && (
              <span className="text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">Ships</span>
            )}
            {product.ships_separately && (
              <span className="text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">Separate</span>
            )}
          </div>
          {product.notes && <p className="text-xs text-zinc-500 mt-2 italic">{product.notes}</p>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={onAddVariant}
            disabled={busy}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors disabled:opacity-50"
            title="Add variant"
          >
            <Plus size={12} />
            Variant
          </button>
          <button
            onClick={onEditProduct}
            disabled={busy}
            className="p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
            title="Edit product"
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={onDeleteProduct}
            disabled={busy}
            className="p-1.5 rounded-md text-zinc-500 hover:text-red-400 hover:bg-red-950/40 transition-colors disabled:opacity-50"
            title="Delete product"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      {variants.length > 0 && (
        <table className="w-full text-xs">
          <tbody>
            {variants.map((v) => {
              const mapped = mappedLegacyCodes.has(v.legacy_code)
              return (
                <tr key={v.id} className="border-t border-zinc-800/40 hover:bg-zinc-800/20 transition-colors">
                  <td className="pl-12 pr-4 py-2.5 w-2">
                    <span
                      className={`inline-block w-2 h-2 rounded-full ${
                        mapped ? 'bg-emerald-500' : 'bg-amber-500'
                      }`}
                      title={mapped ? 'Mapped to a Shopify variant' : 'No Shopify mapping yet'}
                    />
                  </td>
                  <td className="px-2 py-2.5 text-zinc-300">{v.name}</td>
                  <td className="px-2 py-2.5 text-zinc-500 font-mono">{v.legacy_code}</td>
                  <td className="px-2 py-2.5 text-zinc-500 tabular-nums">
                    {v.default_price !== null ? `${v.default_price} ${v.currency ?? ''}`.trim() : '—'}
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        onClick={() => onEditVariant(v)}
                        disabled={busy}
                        className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => onDeleteVariant(v)}
                        disabled={busy}
                        className="p-1 rounded-md text-zinc-500 hover:text-red-400 hover:bg-red-950/40 transition-colors disabled:opacity-50"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ── Edit drawer ─────────────────────────────────────────────────────────────
function EditDrawer({
  mode,
  campaigns,
  products,
  onClose,
  onSaved,
}: {
  mode: NonNullable<EditMode>
  campaigns: Campaign[]
  products: Product[]
  onClose: () => void
  onSaved: () => void
}) {
  const isProduct = mode.type === 'new-product' || mode.type === 'edit-product'
  const isVariant = mode.type === 'new-variant' || mode.type === 'edit-variant'

  const title =
    mode.type === 'new-product'
      ? 'New product'
      : mode.type === 'edit-product'
      ? 'Edit product'
      : mode.type === 'new-variant'
      ? 'New variant'
      : 'Edit variant'

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <aside className="relative w-full max-w-md h-full bg-zinc-950 border-l border-zinc-800 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-zinc-950/95 backdrop-blur border-b border-zinc-800 px-5 py-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-white p-1">
            <X size={16} />
          </button>
        </div>
        <div className="p-5">
          {isProduct && (
            <ProductForm
              campaigns={campaigns}
              initial={
                mode.type === 'edit-product'
                  ? mode.product
                  : { campaign_id: (mode as { campaignId: number }).campaignId }
              }
              onSaved={onSaved}
            />
          )}
          {isVariant && (
            <VariantForm
              products={products}
              initial={
                mode.type === 'edit-variant'
                  ? mode.variant
                  : {
                      campaign_id: (mode as { campaignId: number }).campaignId,
                      product_id: (mode as { productId: number }).productId,
                    }
              }
              onSaved={onSaved}
            />
          )}
        </div>
      </aside>
    </div>
  )
}

function ProductForm({
  campaigns,
  initial,
  onSaved,
}: {
  campaigns: Campaign[]
  initial: Partial<Product> & { campaign_id: number }
  onSaved: () => void
}) {
  const [name, setName] = useState(initial.name ?? '')
  const [legacy, setLegacy] = useState(initial.legacy_code ?? '')
  const [campaignId, setCampaignId] = useState(initial.campaign_id)
  const [requiresAddress, setRequiresAddress] = useState(initial.requires_address ?? true)
  const [shipsSeparately, setShipsSeparately] = useState(initial.ships_separately ?? false)
  const [notes, setNotes] = useState(initial.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setErr(null)
    try {
      const supabase = createClient()
      const payload = {
        campaign_id: campaignId,
        Name: name.trim(),
        legacy_code: legacy.trim(),
        requires_address: requiresAddress,
        ships_separately: shipsSeparately,
        notes: notes.trim() || null,
      }
      if (initial.id) {
        const { error } = await supabase.schema('aa_01_campaigns').from('products').update(payload).eq('id', initial.id)
        if (error) throw error
      } else {
        const { error } = await supabase.schema('aa_01_campaigns').from('products').insert(payload)
        if (error) throw error
      }
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
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
      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
      </Field>
      <Field label="Legacy code (uppercase, dash-separated)">
        <input value={legacy} onChange={(e) => setLegacy(e.target.value)} className={`${inputCls} font-mono`} placeholder="ALIENS-EXPANDED" />
      </Field>
      <div className="flex items-center gap-4">
        <Toggle label="Requires shipping address" checked={requiresAddress} onChange={setRequiresAddress} />
        <Toggle label="Ships separately" checked={shipsSeparately} onChange={setShipsSeparately} />
      </div>
      <Field label="Notes (optional)">
        <textarea value={notes ?? ''} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls} />
      </Field>
      {err && <p className="text-xs text-red-400">{err}</p>}
      <button
        onClick={save}
        disabled={saving || !name.trim() || !legacy.trim()}
        className="w-full px-4 py-2.5 text-sm font-bold rounded-md bg-[#3B9EE8] text-white hover:bg-[#2d8ed8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {saving ? 'Saving…' : 'Save product'}
      </button>
    </div>
  )
}

function VariantForm({
  products,
  initial,
  onSaved,
}: {
  products: Product[]
  initial: Partial<Variant> & { campaign_id: number; product_id: number }
  onSaved: () => void
}) {
  const [productId, setProductId] = useState(initial.product_id)
  const [name, setName] = useState(initial.name ?? '')
  const [legacy, setLegacy] = useState(initial.legacy_code ?? '')
  const [price, setPrice] = useState(initial.default_price?.toString() ?? '')
  const [currency, setCurrency] = useState(initial.currency ?? 'USD')
  const [sourceType, setSourceType] = useState(initial.source_type ?? 'shopify_product')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Restrict product picker to products in the same campaign — keeps the
  // FK relationship consistent.
  const productsForCampaign = products.filter((p) => p.campaign_id === initial.campaign_id)

  async function save() {
    setSaving(true)
    setErr(null)
    try {
      const supabase = createClient()
      const payload = {
        campaign_id: initial.campaign_id,
        product_id: productId,
        Name: name.trim(),
        legacy_code: legacy.trim(),
        default_price: price.trim() ? Number(price) : null,
        currency: currency.trim() || null,
        source_type: sourceType,
      }
      if (initial.id) {
        const { error } = await supabase.schema('aa_01_campaigns').from('variants').update(payload).eq('id', initial.id)
        if (error) throw error
      } else {
        const { error } = await supabase.schema('aa_01_campaigns').from('variants').insert(payload)
        if (error) throw error
      }
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <Field label="Product">
        <select value={productId} onChange={(e) => setProductId(Number(e.target.value))} className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-sm text-white">
          {productsForCampaign.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Blu-ray Package" />
      </Field>
      <Field label="Legacy code (matches Shopify SKU)">
        <input value={legacy} onChange={(e) => setLegacy(e.target.value)} className={`${inputCls} font-mono`} placeholder="ALIENS-BLU-RAY" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Price">
          <input value={price} onChange={(e) => setPrice(e.target.value)} className={`${inputCls} tabular-nums`} inputMode="decimal" />
        </Field>
        <Field label="Currency">
          <input value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputCls} maxLength={4} />
        </Field>
      </div>
      <Field label="Source type">
        <select value={sourceType} onChange={(e) => setSourceType(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-sm text-white">
          <option value="shopify_product">shopify_product</option>
          <option value="post_purchase_upsell">post_purchase_upsell</option>
        </select>
      </Field>
      {err && <p className="text-xs text-red-400">{err}</p>}
      <button
        onClick={save}
        disabled={saving || !name.trim() || !legacy.trim()}
        className="w-full px-4 py-2.5 text-sm font-bold rounded-md bg-[#3B9EE8] text-white hover:bg-[#2d8ed8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {saving ? 'Saving…' : 'Save variant'}
      </button>
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

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="rounded border-zinc-700 bg-zinc-900" />
      {label}
    </label>
  )
}
