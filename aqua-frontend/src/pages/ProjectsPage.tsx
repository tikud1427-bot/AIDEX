import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderGit2, MoreHorizontal, Plus, RefreshCcw, Trash2 } from 'lucide-react';
import { deleteWorkspace, listWorkspaces } from '@/api/project';
import { normalizeError } from '@/api/client';
import { SectionHeader } from '@/components/ui/section-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useChatStore } from '@/stores/chatStore';
import { useUploadStore } from '@/stores/uploadStore';
import { useUiStore } from '@/stores/uiStore';
import { timeAgo } from '@/lib/format';
import type { IndexStatus, WorkspaceSummary } from '@/types';

/* Projects.
   `listWorkspaces()` and `deleteWorkspace()` were already written and typed
   in src/api/project.ts, against a live GET /project/workspaces — and called
   by no component. A project used to exist only for as long as the tab that
   uploaded it. This is that endpoint, given a screen. */

const STATUS_LABEL: Record<IndexStatus, string> = {
  pending: 'Waiting',
  indexing: 'Reading',
  indexed: 'Ready',
  failed: 'Failed',
};

function projectName(ws: WorkspaceSummary): string {
  const name = (ws.meta as { name?: unknown } | undefined)?.name;
  return typeof name === 'string' && name.trim() ? name : `Project ${ws.id.slice(0, 8)}`;
}

export default function ProjectsPage() {
  const navigate = useNavigate();
  const toast = useUiStore((s) => s.toast);
  const setProjectUploadOpen = useUiStore((s) => s.setProjectUploadOpen);
  const newConversation = useChatStore((s) => s.newConversation);
  const setWorkspaceId = useChatStore((s) => s.setWorkspaceId);
  const fetchOverview = useUploadStore((s) => s.fetchOverview);

  const [items, setItems] = useState<WorkspaceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<WorkspaceSummary | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listWorkspaces();
      setItems([...res.workspaces].sort((a, b) => b.createdAt - a.createdAt));
    } catch (err) {
      setError(normalizeError(err).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Open a project by starting a conversation grounded in it — the same
   *  composition an upload performs, minus the upload. */
  function openProject(ws: WorkspaceSummary) {
    newConversation();
    setWorkspaceId(ws.id);
    void fetchOverview(ws.id);
    navigate('/');
  }

  async function handleDelete(ws: WorkspaceSummary) {
    const prev = items;
    setItems((list) => list.filter((x) => x.id !== ws.id));
    try {
      await deleteWorkspace(ws.id);
      toast('success', 'Project removed', `${projectName(ws)} and everything indexed from it.`);
    } catch {
      setItems(prev);
      toast('error', 'Could not remove that project', 'Check your connection and try again.');
    }
  }

  if (loading) return <CenterNote>Looking for your projects&hellip;</CenterNote>;

  if (error) {
    return (
      <CenterNote>
        <p className="text-foreground">Projects couldn&rsquo;t load.</p>
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

  if (items.length === 0) {
    return (
      <CenterNote>
        <p className="text-lg font-semibold text-foreground">No projects yet.</p>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-foreground-secondary">
          Add a codebase, a folder or an archive and AQUA reads it once, then carries what it learned into every
          conversation about it.
        </p>
        <button
          onClick={() => setProjectUploadOpen(true)}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          <Plus className="h-4 w-4" /> Add a project
        </button>
      </CenterNote>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-10 md:px-8 md:py-14">
        <SectionHeader
          eyebrow="Your world"
          title="Projects"
          aside={
            <Button size="sm" variant="secondary" onClick={() => setProjectUploadOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          }
        />

        <ul>
          {items.map((ws) => (
            <li
              key={ws.id}
              className="group/item row-touch flex items-center gap-3 border-b border-border/50 py-3 last:border-b-0"
            >
              <FolderGit2 className="h-4 w-4 shrink-0 text-foreground-secondary/60" aria-hidden="true" />

              <button
                onClick={() => openProject(ws)}
                className="min-w-0 flex-1 text-left"
              >
                <p className="truncate text-sm font-medium text-foreground">{projectName(ws)}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-micro text-foreground-secondary/70">
                  <span>
                    {ws.fileCount.toLocaleString()} {ws.fileCount === 1 ? 'file' : 'files'}
                  </span>
                  {ws.projectType && <span>&middot; {ws.projectType}</span>}
                  <span>&middot; added {timeAgo(ws.createdAt)}</span>
                </p>
              </button>

              <Badge variant={ws.indexStatus === 'indexed' ? 'success' : ws.indexStatus === 'failed' ? 'danger' : 'default'}>
                {STATUS_LABEL[ws.indexStatus]}
              </Badge>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="tap touch-lg affordance flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-foreground-secondary transition-colors hover:bg-surface-secondary hover:text-foreground"
                    aria-label={`Options for ${projectName(ws)}`}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem destructive onSelect={() => setPendingDelete(ws)}>
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>

        <p className="mt-8 text-body leading-relaxed text-foreground-secondary">
          Opening a project starts a conversation with it already in context.
        </p>
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Remove this project?"
        description={
          pendingDelete
            ? `“${projectName(pendingDelete)}” and everything AQUA indexed from it will be removed. This can’t be undone.`
            : undefined
        }
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (pendingDelete) void handleDelete(pendingDelete);
          setPendingDelete(null);
        }}
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
