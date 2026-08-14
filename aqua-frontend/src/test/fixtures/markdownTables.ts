import type { TableLayout } from '@/lib/markdown';

/**
 * Markdown table regression fixtures.
 *
 * Case 1 is the exact response class from the bug report — the four-column
 * "Action / How / Why it works / Evidence" answer that rendered as
 * "Co / ol / the / skin" on a phone, including the fullwidth 【n】 citation
 * markers that were reaching the reader.
 *
 * ONE source of truth, consumed by three places:
 *   • src/test/markdown.test.ts          — layout decision, pure
 *   • src/test/markdownRenderer.test.tsx — rendered DOM structure
 *   • src/pages/DevMarkdownPage.tsx      — /dev/markdown, DEV builds only
 *   • e2e/markdown-tables.spec.ts        — real-browser geometry
 *
 * `expect` is the presentation `chooseTableLayout` must pick. If a change to
 * the heuristic moves one of these, that is the review conversation the
 * fixture exists to force.
 */
export interface MarkdownFixture {
  id: string;
  name: string;
  /** Presentation the shape test must choose, or null where no table applies. */
  expect: TableLayout | null;
  markdown: string;
}

export const MARKDOWN_FIXTURES: MarkdownFixture[] = [
  {
    id: 'two-column',
    name: 'Case 1 — two-column table',
    expect: 'plain',
    markdown: `| Setting | Value |
| --- | --- |
| Region | ap-south-1 |
| Runtime | Node 22 |
| Memory | 512 MB |`,
  },
  {
    id: 'four-column-prose',
    name: 'Case 2 — four-column table (the reported bug)',
    expect: 'stack',
    markdown: `## Quick-Fix (today's burn)

| Action | How | Why it works | Evidence |
| --- | --- | --- | --- |
| Cool the skin | 10-15 min cool (not ice-cold) shower or wet washcloth | Lowers temperature, reduces inflammation and pain | 【2】 |
| Gentle cleanse | Mild, fragrance-free cleanser; pat dry | Removes sweat/sunscreen residue without stripping barrier | 【3】 |
| Hydrate & moisturize | Apply a thick, soothing moisturizer (e.g., aloe-vera gel, or a petroleum-jelly/Aquaphor) | Locks in water, soothes burn, prevents peeling | 【3】 |
| Pain/swelling control | Non-steroidal pain reliever **if tolerated** (e.g., ibuprofen 200-400 mg) or acetaminophen | Reduces pain & edema | General OTC guidance 【2】 |`,
  },
  {
    id: 'long-cells',
    name: 'Case 3 — long text inside cells',
    expect: 'stack',
    markdown: `| Common mistake | Fix |
| --- | --- |
| Low SPF / incomplete coverage | Use **broad-spectrum SPF 30-50**. Apply a nickel-size amount (~1 ml) to *entire* face, ears, neck, and any exposed skin. |
| Applying too late | Apply **15-30 min before stepping outside** so the formula can bind to the skin properly. |
| Skipping re-application | Re-apply **every 80-120 min** (or sooner after sweating, wiping, or rain). Carry a travel-size tube for quick touch-ups. |`,
  },
  {
    id: 'long-urls',
    name: 'Case 4 — very long URLs',
    expect: 'stack',
    markdown: `| Endpoint | Documentation |
| --- | --- |
| Upload | https://api.aquiplex.example.com/v1/workspaces/00000000-0000-4000-8000-000000000000/uploads?include=metadata&expand=parser,evidence |
| Retrieval | [Knowledge-first retrieval reference](https://docs.aquiplex.example.com/engine/persistent-intelligence-core/retrieval/knowledge-first-ranking-and-scoring) |`,
  },
  {
    id: 'prose-and-table',
    name: 'Case 5 — mixed prose and table',
    expect: 'stack',
    markdown: `Three things matter here, and only the third is really about cost.

| Factor | What it changes | When it matters |
| --- | --- | --- |
| Latency | Time to first token, which is what the reader actually perceives | Every single turn |
| Grounding | Whether the answer cites something real instead of sounding plausible | Research and file questions |
| Spend | Credits per turn, which only becomes visible near the wall | Long sessions |

The first two are worth paying for. The third is worth watching.`,
  },
  {
    id: 'streaming-partial',
    name: 'Case 6 — table mid-stream (delimiter row just arrived)',
    expect: 'stack',
    markdown: `| Action | How | Why it works | Evidence |
| --- | --- | --- | --- |
| Cool the skin | 10-15 min cool (not ice-cold) shower or wet washcloth | Lowers temperature, reduces inflammat`,
  },
  {
    id: 'many-rows-dense',
    name: 'Case 7 — large table, many short columns',
    expect: 'scroll',
    markdown: `| Run | Suite | Pass | Fail | Skip | Time | Peak MB |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | files | 153 | 0 | 0 | 8.2s | 214 |
| 2 | memory | 135 | 0 | 0 | 6.9s | 198 |
| 3 | orchestrator | 91 | 0 | 0 | 4.1s | 176 |
| 4 | artifacts | 98 | 0 | 0 | 5.5s | 233 |
| 5 | cognition | 55 | 0 | 0 | 3.2s | 165 |
| 6 | search | 52 | 0 | 0 | 2.8s | 151 |
| 7 | pic | 38 | 0 | 0 | 2.1s | 149 |
| 8 | mind | 34 | 0 | 0 | 1.9s | 144 |
| 9 | identity | 31 | 0 | 0 | 1.7s | 140 |
| 10 | providers | 77 | 0 | 0 | 9.4s | 187 |`,
  },
  {
    id: 'rich-cells',
    name: 'Case 8 — emphasis, links, inline code and citations in cells',
    expect: 'stack',
    markdown: `| Flag | Default | Effect |
| --- | --- | --- |
| \`AQUA_BRAIN\` | *off* | Master kill switch for the whole federation layer 【1】 |
| \`AQUA_CONTEXT_V2\` | **off** | Swaps the [context engine](https://example.com/context) for the scored assembler |
| \`AQUA_TWIN_V2\` | *off* | Infers style patterns from the **user message only**, never from AQUA's own output |`,
  },
];

/** Prose-only control: proves nothing in the table path fires without a table. */
export const PROSE_FIXTURE = `### Heading

Ordinary paragraph with a [link](https://example.com), some \`inline code\`, and
an unusually long token like supercalifragilisticexpialidociousandthensome that
must wrap at the container edge without being shredded character by character.

- first item
  - nested item
- second item

> A blockquote, for the vertical rhythm.`;
