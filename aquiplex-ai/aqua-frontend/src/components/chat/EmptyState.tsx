import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, FolderGit2, MessageSquare, Plus } from 'lucide-react';
import { listWorkspaces } from '@/api/project';
import { useChatStore } from '@/stores/chatStore';
import { useConversationStore } from '@/stores/conversationStore';
import { useMindStore } from '@/stores/mindStore';
import { useUiStore } from '@/stores/uiStore';
import { useUploadStore } from '@/stores/uploadStore';
import { AquaLogo } from '@/components/common/AquaLogo';
import { dateBucket } from '@/lib/format';
import type { WorkspaceSummary } from '@/types';

/* ──────────────────────────────────────────────────────────────────────────
   The opening.

   This used to be nine hardcoded prompt cards — the same nine for every
   person, every session, forever, all of them code chores. A product whose
   entire claim is that it understands your world cannot open with a menu.

   So it opens with what AQUA actually knows: the goal you're in the middle
   of, the threads you were last in, the projects it has read. Every line is
   derived from real state and every one of them disappears when the state
   isn't there — a new account gets an honest invitation instead of a
   fabricated welcome.
   ────────────────────────────────────────────────────────────────────────── */

function projectName(ws: WorkspaceSummary): string {
  const name = (ws.meta as { name?: unknown } | undefined)?.name;
  return typeof name === 'string' && name.trim() ? name : `Project ${ws.id.slice(0, 8)}`;
}

export function EmptyState() {
  const navigate = useNavigate();
  const conversations = useConversationStore((s) => s.items);
  const setProjectUploadOpen = useUiStore((s) => s.setProjectUploadOpen);
  const newConversation = useChatStore((s) => s.newConversation);
  const setWorkspaceId = useChatStore((s) => s.setWorkspaceId);
  const fetchOverview = useUploadStore((s) => s.fetchOverview);

  const model = useMindStore((s) => s.model);
  const hasLoadedOnce = useMindStore((s) => s.hasLoadedOnce);
  const refreshMind = useMindStore((s) => s.refresh);

  const [projects, setProjects] = useState<WorkspaceSummary[]>([]);

  // Both of these are enrichment, not content. The screen renders complete
  // from stores that are already populated; if either never lands, the
  // corresponding block simply isn't there.
  useEffect(() => {
    if (!hasLoadedOnce) void refreshMind({ silent: true });
  }, [hasLoadedOnce, refreshMind]);

  useEffect(() => {
    listWorkspaces()
      .then((res) => setProjects([...res.workspaces].sort((a, b) => b.createdAt - a.createdAt).slice(0, 3)))
      .catch(() => setProjects([]));
  }, []);

  const recent = useMemo(
    () => [...conversations].filter((c) => !c.archived).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3),
    [conversations],
  );

  /** One sentence of continuity, in strict order of how much it actually
   *  knows. Returns null when it knows nothing — never a filler line. */
  const continuity = useMemo(() => {
    const goals = (model?.goals ?? []).filter((g) => g.status === 'active' || g.status === 'blocked');
    if (goals.length) {
      const top = [...goals].sort((a, b) => b.priority - a.priority)[0];
      const rest = goals.length - 1;
      return rest > 0
        ? `You're in the middle of ${top.title}, and ${rest} other ${rest === 1 ? 'thing' : 'things'}.`
        : `You're in the middle of ${top.title}.`;
    }

    // `workspace:` focus topics are plumbing, not subject matter — the Mind
    // page filters them out of attention for the same reason.
    const focus = (model?.working?.focusRanked ?? [])
      .filter((f) => !f.topic.startsWith('workspace:'))
      .slice(0, 2)
      .map((f) => f.topic);
    if (focus.length) return `Lately you've been on ${focus.join(' and ')}.`;

    if (recent.length) {
      const last = recent[0];
      const when = dateBucket(last.updatedAt).toLowerCase();
      return when === 'today'
        ? `Earlier today you were on ${last.title}.`
        : `Last time you were on ${last.title}.`;
    }
    return null;
  }, [model, recent]);

  function openProject(ws: WorkspaceSummary) {
    newConversation();
    setWorkspaceId(ws.id);
    void fetchOverview(ws.id);
  }

  const returning = !!continuity;

  return (
    <div className="flex flex-1 flex-col items-center overflow-y-auto px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-xl"
      >
        <div className="mb-9">
          <div className="mb-5 flex h-10 w-10 items-center justify-center">
            <AquaLogo size={40} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {returning ? 'Welcome back.' : 'What are you working on?'}
          </h1>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-foreground-secondary">
            {continuity ??
              'AQUA reads what you give it once, remembers what matters, and carries it into every conversation after.'}
          </p>
        </div>

        {recent.length > 0 && (
          <Group label="Pick up where you left off">
            {recent.map((c) => (
              <Row key={c.id} icon={MessageSquare} onClick={() => navigate(`/c/${c.id}`)} title={c.title} meta={dateBucket(c.updatedAt)} />
            ))}
          </Group>
        )}

        {projects.length > 0 && (
          <Group label={recent.length > 0 ? 'Or a project' : 'Your projects'}>
            {projects.map((ws) => (
              <Row
                key={ws.id}
                icon={FolderGit2}
                onClick={() => openProject(ws)}
                title={projectName(ws)}
                meta={`${ws.fileCount.toLocaleString()} ${ws.fileCount === 1 ? 'file' : 'files'}`}
              />
            ))}
          </Group>
        )}

        {recent.length === 0 && projects.length === 0 && (
          <button
            onClick={() => setProjectUploadOpen(true)}
            className="tap inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Add a project
          </button>
        )}
      </motion.div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <p className="mb-1 px-1 text-micro font-medium uppercase tracking-[0.14em] text-foreground-secondary/60">
        {label}
      </p>
      <div>{children}</div>
    </section>
  );
}

function Row({
  icon: Icon,
  title,
  meta,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  meta?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group/item row-touch flex w-full items-center gap-3 rounded-lg px-1 py-2.5 text-left transition-colors hover:bg-surface-secondary/60"
    >
      <Icon className="h-4 w-4 shrink-0 text-foreground-secondary/50" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{title}</span>
      {meta && <span className="shrink-0 text-micro text-foreground-secondary/60">{meta}</span>}
      <ArrowRight className="affordance h-3.5 w-3.5 shrink-0 text-foreground-secondary/50" aria-hidden="true" />
    </button>
  );
}
