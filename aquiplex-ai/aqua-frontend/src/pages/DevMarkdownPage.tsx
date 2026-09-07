import { MarkdownRenderer } from '@/components/markdown/MarkdownRenderer';
import { MARKDOWN_FIXTURES, PROSE_FIXTURE } from '@/test/fixtures/markdownTables';

/**
 * /dev/markdown — every table fixture on one page, inside the real message
 * column, at whatever width the window happens to be.
 *
 * DEV ONLY. The route is registered behind `import.meta.env.DEV` and the
 * import is dynamic, so Rollup drops this file and the fixtures from the
 * production bundle entirely (verified: no `four-column-prose` string in
 * dist/). It exists because jsdom cannot see geometry and this sandbox has no
 * browser — the fastest honest way to check the card layout at 320px is to
 * open one URL and drag the window.
 *
 * The `data-md-layout` badge on each block is the decision the shape test
 * made, printed next to the result it produced.
 */
export default function DevMarkdownPage() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        <h1 className="text-base font-semibold text-foreground">Markdown table fixtures</h1>
        <p className="mt-1 text-caption leading-relaxed text-foreground-secondary">
          Same column geometry as a real assistant turn. Narrow the window past
          ~34rem of column width and every <code>stack</code> block should become
          one labelled card per row — no character-level wrapping, no page-level
          horizontal scroll.
        </p>

        {MARKDOWN_FIXTURES.map((f) => (
          <section key={f.id} className="mt-8 border-t border-border pt-4">
            <div className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <h2 className="text-sm font-semibold text-foreground">{f.name}</h2>
              <code className="rounded bg-surface-secondary px-1.5 py-0.5 font-mono text-micro text-foreground-secondary">
                expects: {f.expect ?? 'no table'}
              </code>
            </div>
            {/* Mirrors MessageBubble: avatar gutter + the same reading column. */}
            <div className="flex gap-3">
              <div className="h-7 w-7 shrink-0 rounded-full bg-surface-secondary" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <MarkdownRenderer content={f.markdown} stripCitations />
              </div>
            </div>
          </section>
        ))}

        <section className="mt-8 border-t border-border pt-4">
          <h2 className="mb-1 text-sm font-semibold text-foreground">Prose control</h2>
          <div className="flex gap-3">
            <div className="h-7 w-7 shrink-0 rounded-full bg-surface-secondary" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <MarkdownRenderer content={PROSE_FIXTURE} />
            </div>
          </div>
        </section>

        <div className="h-16" />
      </div>
    </div>
  );
}
