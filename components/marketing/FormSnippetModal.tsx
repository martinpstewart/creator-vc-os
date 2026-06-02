'use client'

import { useMemo, useState } from 'react'
import { Check, ClipboardCopy, X } from 'lucide-react'

type FieldKey = 'email' | 'first_name' | 'last_name' | 'phone'

const FIELD_OPTIONS: { key: FieldKey; label: string; placeholder: string; required: boolean }[] = [
  { key: 'email',      label: 'Email',      placeholder: 'Email address',  required: true  },
  { key: 'first_name', label: 'First name', placeholder: 'First name',     required: false },
  { key: 'last_name',  label: 'Last name',  placeholder: 'Last name',      required: false },
  { key: 'phone',      label: 'Phone',      placeholder: 'Phone (optional)', required: false },
]

export default function FormSnippetModal({ onClose }: { onClose: () => void }) {
  const [heading, setHeading] = useState('Sign up for updates')
  const [subheading, setSubheading] = useState('')
  const [fields, setFields] = useState<Record<FieldKey, boolean>>({
    email: true,
    first_name: true,
    last_name: true,
    phone: false,
  })
  const [buttonLabel, setButtonLabel] = useState('Sign me up')
  const [successMessage, setSuccessMessage] = useState("Thanks! We'll be in touch.")
  const [copied, setCopied] = useState(false)

  const html = useMemo(
    () => buildFormHtml({ heading, subheading, fields, buttonLabel, successMessage }),
    [heading, subheading, fields, buttonLabel, successMessage],
  )

  function toggle(k: FieldKey) {
    if (k === 'email') return // always-on
    setFields((f) => ({ ...f, [k]: !f[k] }))
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(html)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Fallback: select the textarea text
      const ta = document.getElementById('cvc-snippet-output') as HTMLTextAreaElement | null
      ta?.select()
      document.execCommand?.('copy')
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full max-w-3xl max-h-[90vh] overflow-hidden bg-zinc-900 border border-zinc-800 rounded-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">Form snippet builder</h3>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              Drag an <span className="text-zinc-300">HTML</span> block from Unlayer&apos;s sidebar
              into the page, double-click it, and paste this snippet.
            </p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white p-1" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 flex-1 min-h-0">
          {/* Config */}
          <div className="p-5 border-b md:border-b-0 md:border-r border-zinc-800 overflow-y-auto">
            <Field label="Heading">
              <input
                type="text"
                value={heading}
                onChange={(e) => setHeading(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-600"
              />
            </Field>

            <Field label="Subheading (optional)">
              <input
                type="text"
                value={subheading}
                onChange={(e) => setSubheading(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-600"
              />
            </Field>

            <Field label="Fields">
              <div className="space-y-1.5">
                {FIELD_OPTIONS.map((f) => (
                  <label
                    key={f.key}
                    className={`flex items-center gap-2 text-xs ${
                      f.required ? 'cursor-default opacity-80' : 'cursor-pointer'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={fields[f.key]}
                      disabled={f.required}
                      onChange={() => toggle(f.key)}
                      className="accent-[#3B9EE8]"
                    />
                    <span className="text-zinc-200">{f.label}</span>
                    {f.required && (
                      <span className="text-[10px] text-zinc-500">always on</span>
                    )}
                  </label>
                ))}
              </div>
            </Field>

            <Field label="Submit button label">
              <input
                type="text"
                value={buttonLabel}
                onChange={(e) => setButtonLabel(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-600"
              />
            </Field>

            <Field label="Success message">
              <input
                type="text"
                value={successMessage}
                onChange={(e) => setSuccessMessage(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-600"
              />
            </Field>

            <div className="bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-[11px] text-zinc-500 mt-4">
              <span className="text-zinc-300">Posts to:</span>{' '}
              <code className="text-[#3B9EE8]">/api/microsite-signup</code>
              <p className="mt-1.5 text-zinc-600">
                The slug is auto-detected from the page&apos;s URL — the same snippet works
                on every landing page you build from this template.
              </p>
            </div>
          </div>

          {/* Output */}
          <div className="p-5 overflow-y-auto bg-zinc-950/30 flex flex-col gap-3">
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">Generated HTML</p>
            <textarea
              id="cvc-snippet-output"
              readOnly
              value={html}
              className="flex-1 min-h-[280px] bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-[11px] font-mono text-zinc-300 focus:outline-none focus:border-zinc-600 resize-none"
              spellCheck={false}
            />
            <button
              onClick={copy}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-bold rounded-md bg-[#3B9EE8] text-white hover:bg-[#2d8ed8] transition-colors w-full"
            >
              {copied ? <Check size={14} /> : <ClipboardCopy size={14} />}
              {copied ? 'Copied to clipboard' : 'Copy HTML'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <label className="block text-[11px] uppercase tracking-wide text-zinc-500 mb-1">{label}</label>
      {children}
    </div>
  )
}

// ============================================================
// HTML generation
// ============================================================

function escAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

type BuildArgs = {
  heading: string
  subheading: string
  fields: Record<FieldKey, boolean>
  buttonLabel: string
  successMessage: string
}

function buildFormHtml({ heading, subheading, fields, buttonLabel, successMessage }: BuildArgs): string {
  const inputStyle = [
    'display:block', 'width:100%', 'box-sizing:border-box', 'padding:10px 12px',
    'margin:0 0 10px', 'border:1px solid #d4d4d8', 'border-radius:6px',
    'font:14px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif',
    'color:#0a0a0a', 'background:#fff',
  ].join(';')
  const buttonStyle = [
    'display:block', 'width:100%', 'padding:12px 16px', 'margin-top:4px',
    'background:#3B9EE8', 'color:#fff', 'border:0', 'border-radius:6px',
    'font:600 14px/1 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif',
    'cursor:pointer',
  ].join(';')
  const wrapStyle = [
    'max-width:420px', 'margin:24px auto', 'padding:24px',
    'background:#fafafa', 'border:1px solid #e4e4e7', 'border-radius:10px',
    'font:14px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif',
    'color:#0a0a0a',
  ].join(';')
  const headingStyle = 'margin:0 0 6px;font-size:20px;font-weight:700'
  const subheadingStyle = 'margin:0 0 16px;color:#52525b'
  const successStyle = 'margin:0;padding:14px 16px;border-radius:6px;background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0'
  const errorStyle   = 'margin:8px 0 0;padding:10px 12px;border-radius:6px;background:#fef2f2;color:#991b1b;border:1px solid #fecaca;font-size:13px'

  // Inputs — preserve order, email always first.
  const inputs: string[] = []
  if (fields.email) {
    inputs.push(`<input type="email" name="email" required placeholder="Email" autocomplete="email" style="${inputStyle}">`)
  }
  if (fields.first_name) {
    inputs.push(`<input type="text" name="first_name" placeholder="First name" autocomplete="given-name" style="${inputStyle}">`)
  }
  if (fields.last_name) {
    inputs.push(`<input type="text" name="last_name" placeholder="Last name" autocomplete="family-name" style="${inputStyle}">`)
  }
  if (fields.phone) {
    inputs.push(`<input type="tel" name="phone" placeholder="Phone" autocomplete="tel" style="${inputStyle}">`)
  }

  // Inline script — idempotent so re-pasting doesn't double-bind.
  const script = `<script>(function(){
  var forms=document.querySelectorAll('form[data-cvc-form]');
  forms.forEach(function(f){
    if(f.dataset.cvcBound)return;f.dataset.cvcBound='1';
    f.addEventListener('submit',function(e){
      e.preventDefault();
      var wrap=f.closest('.cvc-form');
      var ok=wrap.querySelector('[data-cvc-success]');
      var err=wrap.querySelector('[data-cvc-error]');
      var btn=f.querySelector('button[type=submit]');
      var orig=btn.textContent;
      btn.disabled=true;btn.textContent='Sending…';
      if(err)err.style.display='none';
      var fields={};
      Array.prototype.forEach.call(f.elements,function(el){if(el.name)fields[el.name]=el.value;});
      var slug=window.location.pathname.replace(/^\\/p\\//,'').replace(/\\/$/,'');
      var qs=new URLSearchParams(window.location.search);
      var utm={};['source','medium','campaign','term','content'].forEach(function(k){var v=qs.get('utm_'+k);if(v)utm[k]=v;});
      fetch('/api/microsite-signup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({slug:slug,fields:fields,utm:utm})})
        .then(function(r){if(!r.ok)throw new Error(r.status);return r.json();})
        .then(function(){f.style.display='none';if(ok)ok.style.display='block';})
        .catch(function(){if(err){err.textContent='Sorry, something went wrong. Please try again.';err.style.display='block';}btn.disabled=false;btn.textContent=orig;});
    });
  });
})();</script>`

  const subheadingHtml = subheading.trim()
    ? `<p style="${subheadingStyle}">${escAttr(subheading)}</p>`
    : ''

  return `<div class="cvc-form" style="${wrapStyle}">
  <h3 style="${headingStyle}">${escAttr(heading)}</h3>
  ${subheadingHtml}
  <form data-cvc-form novalidate>
    ${inputs.join('\n    ')}
    <button type="submit" style="${buttonStyle}">${escAttr(buttonLabel)}</button>
    <div data-cvc-error style="${errorStyle};display:none"></div>
  </form>
  <div data-cvc-success style="${successStyle};display:none">${escAttr(successMessage)}</div>
</div>
${script}`
}
