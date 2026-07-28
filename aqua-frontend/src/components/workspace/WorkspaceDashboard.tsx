import { useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, Sparkles, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useChatStore } from '@/stores/chatStore';
import { useUploadStore } from '@/stores/uploadStore';
import { cn } from '@/lib/utils';
import type { WorkspaceOverview } from '@/types';

/* ──────────────────────────────────────────────────────────────────────────
   What AQUA found in your project.

   This was eleven bordered cards in a three-column grid — Architecture, Tech
   stack, API endpoints, Authentication, Database, Folder structure, Entry
   points, Configuration, Statistics, TODOs, Suggestions — with a blurred
   gradient orb behind the title. A repository-analytics dashboard, which is
   precisely the category the product is not.

   Same data, no data removed. It now opens as a few sentences in AQUA's
   voice, because a thing that understands your project should be able to
   TELL you about it; the raw inventory sits underneath in disclosures for
   the moments you want to go digging. Native <details>, so it is keyboard
   operable and findable by browser search without a line of JavaScript.
   ────────────────────────────────────────────────────────────────────────── */

const METHOD_STYLE: Record<string, string> = {
  GET: 'text-success',
  POST: 'text-primary',
  PUT: 'text-warning',
  PATCH: 'text-warning',
  DELETE: 'text-danger',
  MOUNT: 'text-accent',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function list(items: string[], max = 3): string {
  const take = items.slice(0, max);
  if (take.length === 0) return '';
  if (take.length === 1) return take[0];
  return `${take.slice(0, -1).join(', ')} and ${take[take.length - 1]}`;
}

/**
 * The brief — composed from the overview, never invented. Each sentence is
 * dropped whole if the fields behind it are empty, so a sparse index reads
 * as a short honest paragraph rather than one full of "unknown".
 */
function buildBrief(o: WorkspaceOverview): string[] {
  const out: string[] = [];

  const what: string[] = [];
  what.push(o.projectType ? `A ${o.projectType} project` : 'This project');
  if (o.frameworks?.length) what.push(`built with ${list(o.frameworks)}`);
  if (o.runtime?.length) what.push(`running on ${o.runtime[0]}`);
  if (what.length > 1) out.push(`${what.join(', ')}.`);

  const langs = Object.entries(o.languages ?? {}).sort((a, b) => b[1] - a[1]);
  const size: string[] = [];
  if (o.stats?.fileCount) size.push(`${o.stats.fileCount.toLocaleString()} files`);
  if (o.stats?.functions) size.push(`${o.stats.functions.toLocaleString()} functions`);
  if (o.stats?.classes) size.push(`${o.stats.classes.toLocaleString()} classes`);
  if (size.length) {
    out.push(`${list(size, 3)}${langs.length ? `, mostly ${langs[0][0]}` : ''}.`);
  }

  const surface: string[] = [];
  if (o.apiRoutes?.length) surface.push(`${o.apiRoutes.length} API endpoints`);
  if (o.authMethods?.length) surface.push(`authentication through ${o.authMethods[0]}`);
  if (o.databaseTech?.length) surface.push(`data in ${list(o.databaseTech, 2)}`);
  if (surface.length) out.push(`It exposes ${list(surface, 3)}.`);

  const attention: string[] = [];
  if (o.todoCount) attention.push(`${o.todoCount} TODO${o.todoCount === 1 ? '' : 's'} left in the code`);
  if (o.potentialTechDebt?.length) {
    attention.push(`${o.potentialTechDebt.length} thing${o.potentialTechDebt.length === 1 ? '' : 's'} worth a second look`);
  }
  if (attention.length) out.push(`Worth knowing: ${list(attention, 2)}.`);

  return out;
}

function Disclosure({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <details className="group border-b border-border/50 last:border-b-0">
      <summary className="row-touch flex cursor-pointer list-none items-center gap-2 py-3 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-foreground-secondary/60 transition-transform group-open:rotate-180" />
        {title}
        {count !== undefined && (
          <span className="ml-auto shrink-0 text-micro tabular-nums text-foreground-secondary/60">{count}</span>
        )}
      </summary>
      <div className="pb-4 pl-5.5 text-body leading-relaxed text-foreground-secondary">{children}</div>
    </details>
  );
}

function KeyValues({ pairs }: { pairs: [string, string][] }) {
  const real = pairs.filter(([, v]) => v && v !== 'unknown');
  if (!real.length) return <Empty />;
  return (
    <dl className="space-y-2">
      {real.map(([k, v]) => (
        <div key={k}>
          <dt className="text-micro font-medium uppercase tracking-wide text-foreground-secondary/60">{k}</dt>
          <dd className="text-foreground-secondary">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Empty() {
  return <p className="text-foreground-secondary/60">Nothing found.</p>;
}

export function WorkspaceDashboard({ overview }: { overview: WorkspaceOverview }) {
  const sendMessage = useChatStore((s) => s.sendMessage);
  const setShowDashboard = useUploadStore((s) => s.setShowDashboard);
  const reduce = useReducedMotion();

  const brief = useMemo(() => buildBrief(overview), [overview]);
  const langs = useMemo(
    () => Object.entries(overview.languages ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 6),
    [overview.languages],
  );
  const stack = useMemo(
    () => [...(overview.frameworks ?? []), ...(overview.runtime ?? []).slice(0, 2)].slice(0, 5),
    [overview.frameworks, overview.runtime],
  );

  function ask(question: string) {
    setShowDashboard(false);
    void sendMessage(question);
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="mx-auto w-full max-w-2xl px-4 py-10 md:py-14"
      >
        <div className="mb-1 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-micro font-medium uppercase tracking-[0.16em] text-foreground-secondary/70">
              Read and understood
            </p>
            <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight text-foreground">{overview.name}</h1>
          </div>
          <button
            onClick={() => setShowDashboard(false)}
            className="tap touch-lg -mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-foreground-secondary transition-colors hover:bg-surface-secondary hover:text-foreground"
            aria-label="Close project overview"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── The brief ──────────────────────────────────────────────────── */}
        <div className="mt-4 space-y-2 text-lead leading-relaxed text-foreground">
          {(overview.purpose || overview.summary) && <p>{overview.purpose || overview.summary}</p>}
          {brief.map((line) => (
            <p key={line} className="text-foreground-secondary">
              {line}
            </p>
          ))}
        </div>

        {stack.length > 0 && (
          <div className="mt-5 flex flex-wrap items-center gap-1.5">
            {stack.map((t) => (
              <Badge key={t}>{t}</Badge>
            ))}
          </div>
        )}

        {overview.partial && (
          <p className="mt-4 text-caption text-warning">
            AQUA read part of this project. Some of what follows may be incomplete.
          </p>
        )}

        {/* ── Straight back into the conversation ────────────────────────── */}
        {overview.suggestedQuestions?.length > 0 && (
          <div className="mt-8">
            <p className="mb-2 flex items-center gap-1.5 text-micro font-medium uppercase tracking-[0.14em] text-foreground-secondary/60">
              <Sparkles className="h-3 w-3" /> Ask about it
            </p>
            <div className="flex flex-wrap gap-1.5">
              {overview.suggestedQuestions.slice(0, 5).map((q) => (
                <button
                  key={q}
                  onClick={() => ask(q)}
                  className="tap rounded-full border border-border px-3 py-1.5 text-caption text-foreground-secondary transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Everything else, when it's wanted ──────────────────────────── */}
        <div className="mt-10 border-t border-border/50">
          <Disclosure title="Architecture">
            <KeyValues
              pairs={[
                ['Frontend', overview.architecture?.frontend],
                ['Backend', overview.architecture?.backend],
                ['API layer', overview.architecture?.apiLayer],
                ['Data layer', overview.architecture?.dataLayer],
                ['Auth flow', overview.architecture?.authFlow],
                ['Storage', overview.architecture?.storage],
                ['Background jobs', overview.architecture?.backgroundJobs],
                ['Service relationships', overview.architecture?.serviceRelationships],
              ].filter((p): p is [string, string] => typeof p[1] === 'string')}
            />
          </Disclosure>

          {overview.apiRoutes?.length > 0 && (
            <Disclosure title="API endpoints" count={overview.apiRoutes.length}>
              <ul className="space-y-1 font-mono text-micro">
                {overview.apiRoutes.slice(0, 40).map((r, i) => (
                  <li key={`${r.method}-${r.path}-${i}`} className="flex items-baseline gap-2">
                    <span className={cn('w-14 shrink-0 font-semibold', METHOD_STYLE[r.method] ?? 'text-foreground-secondary')}>
                      {r.method}
                    </span>
                    <span className="min-w-0 truncate text-foreground">{r.path}</span>
                  </li>
                ))}
                {overview.apiRoutes.length > 40 && (
                  <li className="pt-1 font-sans text-foreground-secondary/60">
                    &hellip; and {overview.apiRoutes.length - 40} more. Ask about any of them.
                  </li>
                )}
              </ul>
            </Disclosure>
          )}

          <Disclosure title="Structure">
            {overview.entryPoints?.length > 0 && (
              <>
                <p className="text-micro font-medium uppercase tracking-wide text-foreground-secondary/60">Entry points</p>
                <ul className="mb-4 mt-1 space-y-0.5 font-mono text-caption text-foreground">
                  {overview.entryPoints.slice(0, 6).map((e) => (
                    <li key={e} className="truncate">{e}</li>
                  ))}
                </ul>
              </>
            )}
            {overview.coreModules?.length > 0 && (
              <>
                <p className="text-micro font-medium uppercase tracking-wide text-foreground-secondary/60">
                  Most depended upon
                </p>
                <ul className="mb-4 mt-1 space-y-0.5 text-caption">
                  {overview.coreModules.slice(0, 6).map((m) => (
                    <li key={m.file} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate font-mono text-foreground">{m.file}</span>
                      <span className="shrink-0 tabular-nums text-foreground-secondary/60">
                        {m.importedBy} import{m.importedBy === 1 ? '' : 's'}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {overview.largestFolders?.length > 0 && (
              <>
                <p className="text-micro font-medium uppercase tracking-wide text-foreground-secondary/60">Largest folders</p>
                <ul className="mt-1 space-y-0.5 text-caption">
                  {overview.largestFolders.slice(0, 6).map((f) => (
                    <li key={f.dir} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate font-mono text-foreground">{f.dir}/</span>
                      <span className="shrink-0 tabular-nums text-foreground-secondary/60">{formatBytes(f.bytes)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {!overview.entryPoints?.length && !overview.coreModules?.length && !overview.largestFolders?.length && <Empty />}
          </Disclosure>

          <Disclosure title="Languages and dependencies">
            {langs.length > 0 && (
              <ul className="mb-4 space-y-0.5 text-caption">
                {langs.map(([lang, count]) => (
                  <li key={lang} className="flex items-baseline justify-between gap-3">
                    <span className="text-foreground">{lang}</span>
                    <span className="shrink-0 tabular-nums text-foreground-secondary/60">{count}</span>
                  </li>
                ))}
              </ul>
            )}
            {overview.majorDependencies?.length > 0 && (
              <p>
                {overview.dependencyCount
                  ? `${overview.dependencyCount} dependencies, chiefly `
                  : 'Chiefly '}
                {list(overview.majorDependencies, 8)}.
              </p>
            )}
            {!langs.length && !overview.majorDependencies?.length && <Empty />}
          </Disclosure>

          <Disclosure title="Configuration">
            {overview.configFiles?.length > 0 ? (
              <ul className="space-y-0.5 font-mono text-caption text-foreground">
                {overview.configFiles.slice(0, 12).map((c) => (
                  <li key={c} className="truncate">{c}</li>
                ))}
              </ul>
            ) : (
              <Empty />
            )}
            {overview.envVars?.length > 0 && (
              <p className="mt-3 break-all font-mono text-micro text-foreground-secondary/80">
                {overview.envVars.slice(0, 24).join(' · ')}
              </p>
            )}
          </Disclosure>

          {(overview.todos?.length > 0 || overview.potentialTechDebt?.length > 0) && (
            <Disclosure title="Loose ends" count={overview.todoCount || overview.todos?.length}>
              {overview.todos?.length > 0 && (
                <ul className="mb-4 space-y-1.5">
                  {overview.todos.slice(0, 12).map((t, i) => (
                    <li key={`${t.file}-${i}`}>
                      <span className="font-mono text-micro text-foreground-secondary/60">{t.file}</span>
                      {t.text && <p className="text-foreground-secondary">{t.text}</p>}
                    </li>
                  ))}
                </ul>
              )}
              {overview.potentialTechDebt?.length > 0 && (
                <ul className="space-y-1">
                  {overview.potentialTechDebt.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
            </Disclosure>
          )}

          {overview.suggestedImprovements?.length > 0 && (
            <Disclosure title="What AQUA would look at" count={overview.suggestedImprovements.length}>
              <ul className="space-y-1.5">
                {overview.suggestedImprovements.map((s) => (
                  <li key={s} className="flex gap-2">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </Disclosure>
          )}
        </div>

        <p className="mt-8 text-micro text-foreground-secondary/60">
          All of this is already in context. Just ask.
        </p>
      </motion.div>
    </div>
  );
}
