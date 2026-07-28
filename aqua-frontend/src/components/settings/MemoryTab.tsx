import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Brain, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { forgetAllMemory, listMemory } from '@/api/memory';
import { useUiStore } from '@/stores/uiStore';

/**
 * Memory in Settings is now controls only.
 *
 * This tab used to BE the memory interface: a `font-mono` list of storage
 * keys and values with a delete button per row, scoped to whichever
 * conversation happened to be open — which meant the product's defining
 * capability was filed under configuration, shown as a database table, and
 * showed you a fraction of what AQUA actually knew. The facts live at
 * /memory now, owner-scoped, written as sentences. What stays here is what
 * genuinely belongs in settings: the count, and the way out.
 */
export function MemoryTab() {
  const navigate = useNavigate();
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const toast = useUiStore((s) => s.toast);

  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    listMemory()
      .then((res) => setCount(res.factCount))
      .catch(() => setCount(null))
      .finally(() => setLoading(false));
  }, []);

  function openMemory() {
    setSettingsOpen(false);
    navigate('/memory');
  }

  async function handleForgetAll() {
    try {
      await forgetAllMemory();
      setCount(0);
      toast('success', 'Memory cleared', 'AQUA starts fresh from your next message.');
    } catch {
      toast('error', 'Could not clear memory', 'Check your connection and try again.');
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <Brain className="mt-0.5 h-5 w-5 shrink-0 text-foreground-secondary/60" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-foreground">
            {loading ? (
              <span className="inline-flex items-center gap-2 text-foreground-secondary">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking&hellip;
              </span>
            ) : count === null ? (
              'AQUA picks things up as you work and carries them between conversations.'
            ) : count === 0 ? (
              'AQUA hasn’t learned anything about you yet.'
            ) : (
              `AQUA remembers ${count} ${count === 1 ? 'thing' : 'things'} about you.`
            )}
          </p>
          <p className="mt-1 text-caption leading-relaxed text-foreground-secondary">
            Everything it has learned is yours to read, correct or remove.
          </p>
        </div>
      </div>

      <Button size="sm" variant="secondary" onClick={openMemory}>
        Open memory <ArrowRight className="h-3.5 w-3.5" />
      </Button>

      <div className="border-t border-border pt-4">
        <p className="text-caption leading-relaxed text-foreground-secondary">
          Clearing memory removes everything AQUA has learned about you. Your conversations stay where they are.
        </p>
        <Button
          size="sm"
          variant="ghost"
          className="mt-2 text-danger hover:bg-danger/10"
          disabled={count === 0}
          onClick={() => setConfirmClear(true)}
        >
          <Trash2 className="h-3.5 w-3.5" /> Forget everything
        </Button>
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
