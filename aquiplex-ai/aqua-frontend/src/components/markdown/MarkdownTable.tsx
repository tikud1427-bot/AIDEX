import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useMemo,
  type ReactElement,
  type ReactNode,
} from 'react';
import { chooseTableLayout } from '@/lib/markdown';

/**
 * Responsive Markdown tables.
 *
 * ── The defect this replaces ──────────────────────────────────────────────
 * The old renderer was `<div class="overflow-x-auto"><table class="w-full">`
 * inside a prose container carrying `overflow-wrap: anywhere`.
 *
 * `anywhere` is not a cosmetic sibling of `break-word`. Per CSS Text 3, the
 * soft wrap opportunities it introduces ARE counted when computing min-content
 * intrinsic size; the ones `break-word` introduces are not. A table using
 * automatic layout sizes its columns from their min-content widths — so
 * `anywhere` told the layout engine that every column's minimum was ONE
 * CHARACTER. `width:100%` then starved the short columns to feed the long
 * ones, and "Cool" came out as "Co / ol".
 *
 * The character-shredding was therefore never an overflow problem, which is
 * exactly why adding more `overflow-x: auto` never touched it.
 *
 * ── What replaces it ──────────────────────────────────────────────────────
 * 1. The prose container wraps with `break-word` (`.md-prose` in globals.css).
 *    `anywhere` survives only where it is genuinely wanted: links and inline
 *    code, the two things that should break mid-token.
 * 2. Each table picks one of three presentations from its own SHAPE, measured
 *    here at render time — see `chooseTableLayout` in lib/markdown.ts.
 * 3. The narrow presentation is CSS-only, driven by a container query on the
 *    table's own wrapper, so it responds to the width of the column the table
 *    actually sits in (message list, artifact preview, dialog) rather than the
 *    width of the window. No JS measurement, no ResizeObserver, no extra
 *    re-render — which is what keeps it free during streaming.
 *
 * The DOM stays a real `<table>` in every mode. Cards are produced by CSS
 * `display` changes plus a `data-md-label` echo of the column header, and the
 * explicit roles below keep the accessibility tree intact once `display:table-*`
 * is gone (browsers drop implicit table semantics when you re-`display` them).
 */

/** Flatten a React subtree to its text, for measuring cells and reading headers. */
function nodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (isValidElement(node)) return nodeText((node.props as { children?: ReactNode }).children);
  return '';
}

interface TableShape {
  headers: string[];
  cols: number;
  maxCellChars: number;
}

type AnyElement = ReactElement<{ children?: ReactNode }>;

const elementsOf = (node: ReactNode): AnyElement[] =>
  Children.toArray(node).filter(isValidElement) as AnyElement[];

/**
 * Measure the table without rendering it twice. Cheap: a handful of nodes per
 * row, over a subtree react-markdown has already built. Only ever runs on the
 * streaming tail block, because every finished block above it is memoized.
 */
function analyzeTable(children: ReactNode): TableShape {
  const headers: string[] = [];
  let cols = 0;
  let maxCellChars = 0;

  for (const section of elementsOf(children)) {
    // `thead`/`tbody` are intentionally left as intrinsic elements in the
    // renderer's component map — that is what makes this check possible.
    const isHead = section.type === 'thead';
    for (const row of elementsOf(section.props.children)) {
      const cells = elementsOf(row.props.children);
      cols = Math.max(cols, cells.length);
      cells.forEach((cell, i) => {
        const text = nodeText(cell).trim();
        if (isHead) headers[i] = text;
        else maxCellChars = Math.max(maxCellChars, text.length);
      });
    }
  }

  return { headers, cols, maxCellChars };
}

/** Column headers for the current table, so each cell can echo its own. */
const HeaderContext = createContext<string[]>([]);
/** Zero-based column index of the cell being rendered. */
const ColumnContext = createContext(-1);

export function MarkdownTable({ children }: { children?: ReactNode }) {
  const shape = useMemo(() => analyzeTable(children), [children]);
  const layout = chooseTableLayout(shape.cols, shape.maxCellChars);
  const scrollable = layout === 'scroll';

  return (
    <div className="md-table-wrap">
      {/* A scroll container that keyboard users cannot reach fails WCAG 2.1.1,
          so the one mode that actually pans becomes a focusable, named region.
          The other two never scroll and must not add a tab stop for nothing. */}
      <div
        className="md-table-scroller"
        {...(scrollable
          ? {
              tabIndex: 0,
              role: 'region' as const,
              'aria-label': 'Table — scroll sideways for more columns',
            }
          : null)}
      >
        <HeaderContext.Provider value={shape.headers}>
          <table role="table" className="md-table" data-md-layout={layout}>
            {children}
          </table>
        </HeaderContext.Provider>
      </div>
    </div>
  );
}

/**
 * Rows hand each cell its column index. A context provider emits no DOM, so
 * `<tr>` still has `<td>` as its real children.
 *
 * Index keys are correct here for the same reason they are in
 * MarkdownRenderer: a streaming table only ever appends.
 */
export function MarkdownTr({ children }: { children?: ReactNode }) {
  const cells = elementsOf(children);
  return (
    <tr role="row" className="md-tr">
      {cells.map((cell, i) => (
        <ColumnContext.Provider key={i} value={i}>
          {cell}
        </ColumnContext.Provider>
      ))}
    </tr>
  );
}

export function MarkdownTh({ children }: { children?: ReactNode }) {
  return (
    <th role="columnheader" scope="col" className="md-th">
      {children}
    </th>
  );
}

export function MarkdownTd({ children }: { children?: ReactNode }) {
  const headers = useContext(HeaderContext);
  const col = useContext(ColumnContext);
  const label = col >= 0 ? headers[col]?.trim() : '';

  return (
    <td role="cell" className="md-td" data-md-label={label || undefined}>
      {children}
    </td>
  );
}
