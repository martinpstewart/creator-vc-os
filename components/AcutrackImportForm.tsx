'use client'

// Acutrack CSV import form. The fulfilment partner has no API, so
// every few days a staff member exports OrderExportReport_*.csv and
// uploads it here. Each upload fully replaces the canonical received-
// orders set in Supabase; the dispatch monitor on the home dashboard
// reconciles paid Payhere orders against this set and surfaces any
// silently-undispatched orders.
//
// Upload flow (per the three SECURITY DEFINER RPCs):
//   1. Generate a unique batch label.
//   2. Stream rows in chunks of 1000 via acutrack_import_append.
//   3. On all-chunks-success, acutrack_import_commit atomically swaps
//      the new batch in as the live set.
//   4. Any error OR a user cancel calls acutrack_import_abort, which
//      drops the staged batch. The live set is untouched because the
//      commit step never ran.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Upload, FileText, AlertTriangle, CheckCircle2, X, Loader2, FileSpreadsheet,
} from 'lucide-react'
import Papa from 'papaparse'
import { createClient } from '@/lib/supabase-browser'
import { formatErrorMessage } from '@/lib/format-error'

// One distinct order, ready to send to Supabase. PONumber# values can
// arrive with trailing tabs/spaces; we trim on parse. Date is sent
// verbatim — the RPC parses it as MM/DD/YYYY.
type ParsedRow = {
  ponumber: string
  date_created: string
}

// Summary from glide-retrigger-missing surfaced in the success message.
type RetriggerSummary = {
  retriggered: number
  failures:   number
  eligible:   number
  configured: boolean
  message?:   string
}

type Stage =
  | { kind: 'idle' }
  | { kind: 'parsing'; filename: string }
  | { kind: 'parsed'; filename: string; rows: ParsedRow[] }
  | { kind: 'uploading'; batch: string; filename: string; rows: ParsedRow[]; done: number; total: number }
  | { kind: 'committing'; batch: string; filename: string }
  | { kind: 'done'; liveRows: number; filename: string; retrigger?: RetriggerSummary | null }
  | { kind: 'error'; message: string; filename?: string }

const CHUNK_SIZE = 1000

export default function AcutrackImportForm() {
  const [stage, setStage] = useState<Stage>({ kind: 'idle' })

  // Refs that survive re-renders during the long upload loop:
  //   - cancelled: user clicked Cancel. The loop checks it between
  //     chunks and bails out.
  //   - activeBatch: the batch we'd need to abort on a cancel or on
  //     a page-unload.
  const cancelledRef = useRef(false)
  const activeBatchRef = useRef<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const supabase = createClient()

  // Best-effort abort on unmount — if the user navigates away while a
  // batch is mid-upload, drop it so we don't leak staging rows.
  useEffect(() => {
    return () => {
      const b = activeBatchRef.current
      if (b) {
        // Fire-and-forget; if it fails the batch just stays orphaned
        // (which the next successful commit will not touch).
        void supabase.rpc('acutrack_import_abort', { p_batch: b })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const reset = useCallback(() => {
    cancelledRef.current = false
    activeBatchRef.current = null
    setStage({ kind: 'idle' })
    if (inputRef.current) inputRef.current.value = ''
  }, [])

  // Parse the CSV client-side. We only care about PONumber# +
  // Date Created; everything else is ignored. Dedupe by PONumber#
  // (first occurrence wins, matching the spec).
  const onFile = useCallback((file: File) => {
    setStage({ kind: 'parsing', filename: file.name })
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        try {
          const seen = new Map<string, string>()
          for (const row of result.data) {
            const pono = (row['PONumber#'] ?? '').trim()
            if (!pono) continue
            if (seen.has(pono)) continue
            const date = (row['Date Created'] ?? '').trim()
            seen.set(pono, date)
          }
          const rows: ParsedRow[] = Array.from(seen.entries()).map(([ponumber, date_created]) => ({
            ponumber,
            date_created,
          }))
          if (rows.length === 0) {
            setStage({
              kind: 'error',
              filename: file.name,
              message:
                'No usable rows found. Expected columns "PONumber#" and "Date Created" — double-check the CSV is the Acutrack OrderExportReport.',
            })
            return
          }
          setStage({ kind: 'parsed', filename: file.name, rows })
        } catch (e) {
          setStage({ kind: 'error', filename: file.name, message: formatErrorMessage(e) })
        }
      },
      error: (err) => {
        setStage({ kind: 'error', filename: file.name, message: `Parse failed: ${err.message}` })
      },
    })
  }, [])

  // Confirm → run the full upload pipeline. Each error path makes sure
  // to abort the staged batch so we never leave half-uploaded state.
  const upload = useCallback(async (rows: ParsedRow[], filename: string) => {
    cancelledRef.current = false
    const batch = `upload_${Date.now()}`
    activeBatchRef.current = batch

    setStage({ kind: 'uploading', batch, filename, rows, done: 0, total: rows.length })

    try {
      for (let offset = 0; offset < rows.length; offset += CHUNK_SIZE) {
        if (cancelledRef.current) {
          await supabase.rpc('acutrack_import_abort', { p_batch: batch })
          activeBatchRef.current = null
          setStage({ kind: 'idle' })
          if (inputRef.current) inputRef.current.value = ''
          return
        }
        const chunk = rows.slice(offset, offset + CHUNK_SIZE)
        const { error } = await supabase.rpc('acutrack_import_append', {
          p_batch: batch,
          p_rows: chunk,
        })
        if (error) throw error
        const done = Math.min(offset + chunk.length, rows.length)
        setStage({ kind: 'uploading', batch, filename, rows, done, total: rows.length })
      }

      // All chunks accepted — commit. The RPC refuses an empty batch
      // so this can't silently wipe data even if our chunk loop drops.
      setStage({ kind: 'committing', batch, filename })
      const { data: commitData, error: commitErr } = await supabase.rpc(
        'acutrack_import_commit',
        { p_batch: batch },
      )
      if (commitErr) throw commitErr
      const liveRows = Number(
        (commitData as { live_rows?: number } | null)?.live_rows ?? 0,
      )
      activeBatchRef.current = null

      // Acutrack data is now live. Kick the Glide webhook for every
      // still-red flagged order so Glide can re-attempt the Acutrack
      // hand-off. Failure here doesn't roll back the commit — the
      // import succeeded regardless, and we surface the retrigger
      // outcome as an additional line in the success message.
      let retrigger: RetriggerSummary | null = null
      try {
        const { data: rdata, error: rerr } = await supabase.functions.invoke<RetriggerSummary>(
          'glide-retrigger-missing',
          { body: {} },
        )
        if (rerr) throw rerr
        if (rdata) retrigger = rdata
      } catch (e) {
        // Don't fail the commit on a retrigger error. Stash a faux
        // summary so the UI can show "couldn't reach Glide" without
        // hiding the fact that the CSV did land.
        retrigger = {
          retriggered: 0,
          failures: 0,
          eligible: 0,
          configured: false,
          message: `Retrigger step failed: ${formatErrorMessage(e)}`,
        }
      }

      setStage({ kind: 'done', liveRows, filename, retrigger })
      if (inputRef.current) inputRef.current.value = ''
    } catch (e) {
      // Best-effort abort. We deliberately ignore its error — if even
      // abort fails we can't do much more, and the orphaned staging
      // rows are harmless until the next successful commit replaces
      // the live set anyway.
      try {
        await supabase.rpc('acutrack_import_abort', { p_batch: batch })
      } catch { /* swallow */ }
      activeBatchRef.current = null
      setStage({ kind: 'error', filename, message: formatErrorMessage(e) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const requestCancel = useCallback(() => {
    cancelledRef.current = true
  }, [])

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <FileSpreadsheet size={16} className="text-zinc-400" />
          <h2 className="text-sm font-semibold text-white">Acutrack export</h2>
        </div>
        <p className="text-xs text-zinc-500 mt-1">
          Upload <code className="text-zinc-300">OrderExportReport_*.csv</code> to refresh the canonical received-orders set.
          Each upload fully replaces the prior one — the dispatch monitor reconciles paid Payhere orders against whatever&rsquo;s currently loaded.
        </p>
      </div>

      <div className="p-5">
        {/* Idle / error / done all expose the file picker. Parsed shows
            the preview + confirm. Uploading / committing show progress
            with cancel. */}
        {(stage.kind === 'idle' || stage.kind === 'error' || stage.kind === 'done') && (
          <FilePicker
            inputRef={inputRef}
            onFile={onFile}
            doneState={stage.kind === 'done' ? stage : undefined}
            errorState={stage.kind === 'error' ? stage : undefined}
            onReset={reset}
          />
        )}

        {stage.kind === 'parsing' && (
          <Row icon={<Loader2 size={14} className="animate-spin text-zinc-400" />}>
            Parsing <code className="text-zinc-300">{stage.filename}</code>…
          </Row>
        )}

        {stage.kind === 'parsed' && (
          <div className="space-y-4">
            <Row icon={<FileText size={14} className="text-zinc-400" />}>
              <span className="text-zinc-300">{stage.filename}</span>
              <span className="text-zinc-500"> · </span>
              <span className="text-zinc-300 font-semibold">{stage.rows.length.toLocaleString()} distinct orders found</span>
            </Row>
            <p className="text-[11px] text-zinc-500">
              Click <span className="text-zinc-300">Confirm upload</span> to replace the live Acutrack set with this file. The previous import will be discarded.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void upload(stage.rows, stage.filename)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#3B9EE8] hover:bg-[#3691d4] text-white text-sm font-medium transition-colors"
              >
                <Upload size={14} strokeWidth={2.25} />
                Confirm upload
              </button>
              <button
                type="button"
                onClick={reset}
                className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {stage.kind === 'uploading' && (
          <UploadProgress
            filename={stage.filename}
            done={stage.done}
            total={stage.total}
            onCancel={requestCancel}
            cancelled={cancelledRef.current}
          />
        )}

        {stage.kind === 'committing' && (
          <Row icon={<Loader2 size={14} className="animate-spin text-zinc-400" />}>
            All rows uploaded. Committing batch…
          </Row>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function FilePicker({
  inputRef,
  onFile,
  doneState,
  errorState,
  onReset,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>
  onFile: (file: File) => void
  doneState?: { liveRows: number; filename: string; retrigger?: RetriggerSummary | null }
  errorState?: { message: string; filename?: string }
  onReset: () => void
}) {
  return (
    <div className="space-y-4">
      <label
        htmlFor="acutrack-csv"
        className="flex flex-col items-center justify-center gap-2 px-4 py-8 rounded-lg border-2 border-dashed border-zinc-800 hover:border-zinc-700 bg-zinc-950/40 cursor-pointer transition-colors"
      >
        <Upload size={20} className="text-zinc-500" />
        <span className="text-sm text-zinc-300">Choose CSV file</span>
        <span className="text-[11px] text-zinc-600">Acutrack OrderExportReport_*.csv</span>
        <input
          id="acutrack-csv"
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onFile(file)
          }}
          className="hidden"
        />
      </label>

      {doneState && (
        <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/40 px-4 py-3 flex items-start gap-2">
          <CheckCircle2 size={14} className="text-emerald-300 mt-0.5 shrink-0" />
          <div className="text-xs text-emerald-300">
            <p className="font-medium">
              Loaded {doneState.liveRows.toLocaleString()} orders. Dispatch monitor updated.
            </p>
            <p className="text-emerald-400/80 mt-0.5">
              From <code>{doneState.filename}</code>. Reload <code>/</code> or wait for the home dashboard tab to refocus to see the new state.
            </p>
            {doneState.retrigger && (
              <p className="text-emerald-400/80 mt-1">
                {doneState.retrigger.configured === false ? (
                  <span className="text-amber-300/90">
                    {doneState.retrigger.message ?? 'Glide retrigger skipped (GLIDE_WEBHOOK_URL not set).'}
                  </span>
                ) : doneState.retrigger.eligible === 0 ? (
                  <span>No orders needed a Glide retrigger.</span>
                ) : (
                  <span>
                    Retriggered{' '}
                    <strong className="text-emerald-200">{doneState.retrigger.retriggered}</strong> of{' '}
                    {doneState.retrigger.eligible} order{doneState.retrigger.eligible === 1 ? '' : 's'} to Glide
                    {doneState.retrigger.failures > 0 && (
                      <> ({doneState.retrigger.failures} failed — check Supabase logs)</>
                    )}
                    .
                  </span>
                )}
              </p>
            )}
            <button
              type="button"
              onClick={onReset}
              className="mt-2 text-emerald-200 hover:text-emerald-100 underline decoration-emerald-800 underline-offset-2"
            >
              Upload another
            </button>
          </div>
        </div>
      )}

      {errorState && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 flex items-start gap-2">
          <AlertTriangle size={14} className="text-red-300 mt-0.5 shrink-0" />
          <div className="text-xs text-red-300">
            <p className="font-medium">Upload failed{errorState.filename ? ` — ${errorState.filename}` : ''}</p>
            <p className="text-red-400/80 mt-0.5 break-words">{errorState.message}</p>
            <p className="text-red-400/60 mt-1">
              The staged batch was discarded; the previous Acutrack set is still live.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function UploadProgress({
  filename,
  done,
  total,
  onCancel,
  cancelled,
}: {
  filename: string
  done: number
  total: number
  onCancel: () => void
  cancelled: boolean
}) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)
  return (
    <div className="space-y-3">
      <Row icon={<Loader2 size={14} className="animate-spin text-zinc-400" />}>
        <span className="text-zinc-300">
          Uploaded {done.toLocaleString()} / {total.toLocaleString()} rows…
        </span>
        <span className="text-zinc-500"> · </span>
        <span className="text-zinc-500">{filename}</span>
      </Row>
      <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-[#3B9EE8] transition-all duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-zinc-600 tabular-nums">{pct}%</span>
        <button
          type="button"
          onClick={onCancel}
          disabled={cancelled}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors disabled:opacity-50"
        >
          <X size={12} />
          {cancelled ? 'Cancelling…' : 'Cancel upload'}
        </button>
      </div>
    </div>
  )
}

function Row({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm text-zinc-400">
      {icon}
      <span>{children}</span>
    </div>
  )
}
