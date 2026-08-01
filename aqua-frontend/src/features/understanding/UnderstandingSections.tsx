import { useEffect, useState } from 'react';
import { SectionHeader } from '@/components/ui/section-header';
import {
  fetchUnderstanding, correctItem,
  type UnderstandingModel,
} from '@/api/understanding';

/* ────────────────────────────────────────────────────────────────────────────
   The three sections the Understanding page was missing.

   All three come from data the read model ALREADY returns — projects from the
   graph, sources from belief provenance, unknowns from the coverage model.
   Nothing new is tracked to render them.

   Every item carries the ref it was given, and "Not quite" sends that ref
   straight back. The person clicking it never learns whether they are editing
   a belief, a goal or a graph node — which is the difference between
   correcting an assistant and administering a database.
   ──────────────────────────────────────────────────────────────────────────── */

export function UnderstandingSections() {
  const [model, setModel] = useState<UnderstandingModel | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => { fetchUnderstanding().then(setModel).catch(() => setModel(null)); };
  useEffect(load, []);

  if (!model) return null;

  const dismiss = async (ref: string) => {
    setBusy(ref);
    try { await correctItem(ref, { action: 'remove' }); load(); }
    finally { setBusy(null); }
  };

  return (
    <>
      {model.projects.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionHeader eyebrow="What you're building" title="Projects" />
          <ul className="flex flex-col gap-1.5">
            {model.projects.map((p) => (
              <li key={p.ref} className="group flex items-baseline justify-between gap-3">
                <span className="text-[length:var(--text-body)] text-[var(--text)]">{p.label}</span>
                <NotQuite onClick={() => dismiss(p.ref)} busy={busy === p.ref} label="Not mine" />
              </li>
            ))}
          </ul>
        </section>
      )}

      {model.sources.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionHeader eyebrow="Where this came from" title="How I learned it" />
          {/* Answers "why do you think that?" without anyone having to ask.
              Provenance is the difference between a system that remembers and
              one you can hold to account. */}
          <ul className="flex flex-col gap-1">
            {model.sources.map((s) => (
              <li key={s.kind} className="flex items-baseline justify-between gap-3">
                <span className="text-[length:var(--text-body)] text-[var(--text)]">{s.label}</span>
                <span className="text-[length:var(--text-micro)] tabular-nums text-[var(--text-secondary)]">
                  {s.count}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {model.unknowns.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionHeader eyebrow="Still learning" title="What I don't know yet" />
          {/* Phrased as invitations, not deficits. A list of the user's
              omissions on the screen meant to build trust reads as a scorecard
              they are failing. */}
          <p className="text-[length:var(--text-caption)] text-[var(--text-secondary)]">
            Nothing to fill in — these come up naturally as we work.
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {model.unknowns.slice(0, 6).map((u) => (
              <li
                key={u.id}
                className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[length:var(--text-micro)] text-[var(--text-secondary)]"
              >
                {u.prompt}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function NotQuite({ onClick, busy, label = 'Not quite' }: { onClick: () => void; busy: boolean; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="shrink-0 rounded px-1.5 py-0.5 text-[length:var(--text-micro)] text-[var(--text-secondary)] opacity-0 transition focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary)] group-hover:opacity-100 disabled:opacity-40"
    >
      {busy ? '…' : label}
    </button>
  );
}
