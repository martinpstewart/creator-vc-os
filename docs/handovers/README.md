# Handovers between Claude sessions

Single source of truth for cross-Claude communication on Creator VC OS.

There are two Claudes working on this project:

- **Claude Code** (Martin's terminal, this CLI tool) — owns the **PWA frontend** (Next.js / Vercel), the **edge functions** under `supabase/functions/`, the migrations under `supabase/migrations/`, and the read-side RPCs the app uses.
- **C Chat** (a separate Claude.ai project) — owns the **database backbone**: schema design, historic CSV imports, view rewrites, customer/contact data quality, and large migration programmes.

The two Claudes share the same Supabase database and the same git repo, but neither sees the other's transcript. These handovers are how they catch each other up.

## Folder layout

```
docs/handovers/
  README.md                              ← you are here
  NEXT.md                                ← live "what's open, blocked, queued" — read FIRST
  YYYY-MM-DD-short-slug.md               ← dated rev, one per substantial session
```

## Conventions

### `NEXT.md`
- Always kept under one page.
- Three sections only: **What's done**, **What's open / waiting on whom**, **Watch items**.
- Updated at the end of every session that changes the state of the world.
- A fresh Claude session reads this file FIRST to orient itself.

### Dated session docs
- Filename: `YYYY-MM-DD-short-slug.md` (lowercase, hyphen-separated).
- Written at the END of a substantial session — not every small fix.
- Audience: a fresh Claude session in the OTHER role who needs to pick up where the writing Claude left off.
- Length: as long as it needs to be, but lead with a **TL;DR** so the reader can skim.
- Tone: technical, terse, link-heavy. Code blocks and tables welcome.

### What belongs here vs in `.docx`
- Markdown HERE is the canonical record.
- C Chat may continue to produce `.docx` for Robin or human reviewers — those should sit next to the matching `.md` as exports, not replace them.
- If a session produced both formats, the `.md` is what fresh Claudes read; the `.docx` is for humans.

## Who writes what

Both Claudes follow the same convention. Each writes the dated file for their own session, and updates `NEXT.md` with the cross-cutting state.

## What goes in commit messages vs handovers

- **Commit messages** explain why a specific change was made.
- **Handovers** explain the **shape of the world** after a session: what's now expected to be true, what's still broken, what the next Claude should be careful about.

## Example flow

1. Session ends.
2. The Claude that ran it writes `2026-06-18-snapshot-architecture.md` covering what they did + why.
3. They update `NEXT.md` to reflect the new state — moving things from "open" to "done", flagging anything new that's now blocking the other Claude.
4. Commit both files in the same commit as the substantive changes.
5. The other Claude, on next session, reads `NEXT.md` first then the most recent dated docs as needed.
