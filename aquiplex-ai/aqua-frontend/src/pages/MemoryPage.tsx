import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, MessageSquarePlus, Pin, PinOff, RefreshCcw, Trash2 } from 'lucide-react';
import { forgetAllMemory, forgetMemoryFact, listMemory, memoryTimeline, pinMemoryFact } from '@/api/memory';
import { normalizeError } from '@/api/client';
import { SectionHeader } from '@/components/ui/section-header';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useUiStore } from '@/stores/uiStore';
import { humanizeKey, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { MemoryChange, MemoryFact } from '@/types';

/* What AQUA remembers about you — a destination, not a settings tab.
   Memory was reachable only through Settings → Memory, scoped to the current
   conversation, rendered as key/value rows with a delete button each. This is
   the same data read from the endpoint it is actually stored against, written
   as sentences. */

function FactRow({
  fact,
  onPin,
  onForget,
}: {
  fact: MemoryFact;
  onPin: (key: string, pinned: boolean) => void;
  onForget: (key: string) => void;
}) {
  const [showEvidence, setShowEvidence] = useState(false);
  const evidence = fact.sourceMessage || fact.sourceText || '';
  const learned = fact.createdAt ?? fact.ts;
  const revised = (fact.revision ?? 1) > 1;

  return (
    <div className="group/item row-touch border-b border-border/50 py-3 last:border-b-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-micro font-medium uppercase tracking-[0.14em] text-foreground-secondary">
            {humanizeKey(fact.key)}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-foreground">{fact.value}</p>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-foreground-secondary/70">
            {learned && <span>Learned {timeAgo(learned)}</span>}
            {revised && <span>Revised {(fact.revision ?? 1) - 1}&times;</span>}
            {!!fact.retrievalCount && <span>Used {fact.retrievalCount}&times;</span>}
            {evidence && (
              <button
                onClick={() => setShowEvidence((v) => !v)}
                aria-expanded={showEvidence}
                className="tap flex items-center gap-1 rounded text-foreground-secondary/70 underline-offset-2 hover:text-foreground hover:underline"
              >
                <ChevronDown className={cn('h-3 w-3 transition-transform', showEvidence && 'rotate-180')} />
                Why AQUA thinks this
              </button>
            )}
          </div>

          {showEvidence && evidence && (
            <p className="mt-2 border-l-2 border-border pl-3 text-caption italic leading-relaxed text-foreground-secondary">
              &ldquo;{evidence}&rdquo;
            </p>
          )}
        </div>

        <div className="affordance flex shrink-0 items-center gap-0.5">
          <button
            onClick={() => onPin(fact.key, !fact.pinned)}
            className="tap touch-lg flex h-8 w-8 items-center justify-center rounded-md text-foreground-secondary transition-colors hover:bg-surface-secondary hover:text-foreground"
            aria-label={fact.pinned ? `Unpin ${humanizeKey(fact.key)}` : `Pin ${humanizeKey(fact.key)}`}
            title={fact.pinned ? 'Unpin' : 'Pin so this is never forgotten automatically'}
          >
            {fact.pinned ? <Pin className="h-3.5 w-3.5 fill-current text-primary/70" /> : <PinOff className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={() => onForget(fact.key)}
            className="tap touch-lg flex h-8 w-8 items-center justify-center rounded-md text-foreground-secondary transition-colors hover:bg-danger/10 hover:text-danger"
            aria-label={`Forget ${humanizeKey(fact.key)}`}
            title="Forget this"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MemoryPage() {
  const navigate = useNavigate();
  const toast = useUiStore((s) => s.toast);
  const [facts, setFacts] = useState<MemoryFact[]>([]);
  const [changes, setChanges] = useState<MemoryChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listMemory();
      setFacts(res.facts);
      // The change feed is a bonus, not the page — a failure here must not
      // take down the facts the user actually came for.
      memoryTimeline(30, 8)
        .then((t) => setChanges(t.changes))
        .catch(() => setChanges([]));
    } catch (err) {
      setError(normalizeError(err).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, MemoryFact[]>();
    for (const f of facts) {
      const label = f.category ? humanizeKey(f.category) : 'Other';
      const bucket = map.get(label) ?? [];
      bucket.push(f);
      map.set(label, bucket);
    }
    // Pinned first within a group, then whatever importance order the server
    // already sorted by — it knows which facts it keeps needing.
    for (const list of map.values()) {
      list.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [facts]);

  const lastLearned = useMemo(
    () => facts.reduce((max, f) => Math.max(max, f.updatedAt ?? f.createdAt ?? f.ts ?? 0), 0),
    [facts],
  );

  async function handlePin(key: string, pinned: boolean) {
    const prev = facts;
    setFacts((f) => f.map((x) => (x.key === key ? { ...x, pinned } : x)));
    try {
      await pinMemoryFact(key, pinned);
    } catch {
      setFacts(prev);
      toast('error', pinned ? 'Could not pin that' : 'Could not unpin that');
    }
  }

  async function handleForget(key: string) {
    const prev = facts;
    setFacts((f) => f.filter((x) => x.key !== key));
    try {
      await forgetMemoryFact(key);
      toast('success', 'Forgotten', `AQUA no longer remembers ${humanizeKey(key).toLowerCase()}.`);
    } catch {
      setFacts(prev);
      toast('error', 'Could not forget that', 'Check your connection and try again.');
    }
  }

  async function handleForgetAll() {
    const prev = facts;
    setFacts([]);
    setChanges([]);
    try {
      await forgetAllMemory();
      toast('success', 'Memory cleared', 'AQUA starts fresh from your next message.');
    } catch {
      setFacts(prev);
      toast('error', 'Could not clear memory', 'Check your connection and try again.');
    }
  }

  if (loading) return <CenterNote>Reading what AQUA remembers&hellip;</CenterNote>;

  if (error) {
    return (
      <CenterNote>
        <p className="text-foreground">Memory couldn&rsquo;t load.</p>
        <p className="mt-1 text-sm text-foreground-secondary">{error}</p>
        <button
          onClick={() => void load()}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-surface-secondary"
        >
          <RefreshCcw className="h-4 w-4" /> Try again
        </button>
      </CenterNote>
    );
  }

  if (facts.length === 0) {
    return (
      <CenterNote>
        <p className="text-lg font-semibold text-foreground">AQUA doesn&rsquo;t know anything about you yet.</p>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-foreground-secondary">
          Nothing here is filled in from a form. AQUA picks things up as you work &mdash; what you&rsquo;re building, how
          you like answers, what you keep coming back to &mdash; and everything it learns shows up here for you to
          correct or remove.
        </p>
        <button
          onClick={() => navigate('/')}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          <MessageSquarePlus className="h-4 w-4" /> Start a conversation
        </button>
      </CenterNote>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-10 md:px-8 md:py-14">
        <SectionHeader
          eyebrow="Yours"
          title="What AQUA remembers"
          aside={
            <span className="shrink-0 text-micro tabular-nums text-foreground-secondary">
              {facts.length} {facts.length === 1 ? 'thing' : 'things'}
              {lastLearned ? ` \u00b7 last ${timeAgo(lastLearned)}` : ''}
            </span>
          }
        />

        {changes.length > 0 && (
          <Panel className="mb-10">
            <p className="mb-3 text-micro font-medium uppercase tracking-[0.16em] text-foreground-secondary">
              Recently learned
            </p>
            <ul className="space-y-2">
              {changes.map((c, i) => (
                <li key={`${c.at}-${i}`} className="flex items-baseline gap-3 text-body leading-relaxed">
                  <span className="shrink-0 text-micro tabular-nums text-foreground-secondary/60">{timeAgo(c.at)}</span>
                  <span className="min-w-0 text-foreground-secondary">{c.label}</span>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {grouped.map(([category, list]) => (
          <section key={category} className="mb-10">
            <h2 className="mb-1 text-base font-semibold tracking-tight text-foreground">{category}</h2>
            <div>
              {list.map((f) => (
                <FactRow key={f.key} fact={f} onPin={handlePin} onForget={handleForget} />
              ))}
            </div>
          </section>
        ))}

        <div className="mt-12 border-t border-border pt-6">
          <p className="text-body leading-relaxed text-foreground-secondary">
            Everything above is yours. Pin what should never fade, remove anything that&rsquo;s wrong, or clear the lot
            and let AQUA start over.
          </p>
          <Button variant="ghost" size="sm" className="mt-3 text-danger" onClick={() => setConfirmClear(true)}>
            <Trash2 className="h-3.5 w-3.5" /> Forget everything
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Forget everything?"
        description="AQUA will lose all of it and start building its picture of you again from your next message. This can’t be undone."
        confirmLabel="Forget everything"
        destructive
        onConfirm={() => void handleForgetAll()}
      />
    </div>
  );
}

function CenterNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-8 text-center text-sm text-foreground-secondary">
      <div>{children}</div>
    </div>
  );
}
