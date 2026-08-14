/**
 * Pure Markdown helpers — no React, no DOM.
 *
 * These live outside the component files for two reasons: react-refresh wants
 * a component module to export only components, and the regression suite
 * should be able to exercise the decisions without mounting anything.
 */

/**
 * Split markdown into stable top-level blocks (blank-line separated, fenced
 * code kept intact). During streaming, appended tokens only ever change the
 * LAST block — memoizing each block means everything above it skips
 * react-markdown's parse + render entirely on every frame. This is what
 * keeps long streaming answers smooth: parse cost stays O(tail block), not
 * O(entire message) per animation frame.
 *
 * Moved here verbatim from MarkdownRenderer; the algorithm is unchanged.
 */
export function splitMarkdownBlocks(content: string): string[] {
  const lines = content.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;
  let fenceMarker = '';

  const push = () => {
    if (current.length) {
      blocks.push(current.join('\n'));
      current = [];
    }
  };

  for (const line of lines) {
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fenceMatch[1][0].repeat(3);
      } else if (line.trimStart().startsWith(fenceMarker)) {
        inFence = false;
        current.push(line);
        push(); // close the code block as its own unit
        continue;
      }
    }
    if (!inFence && line.trim() === '') {
      push();
      continue;
    }
    current.push(line);
  }
  push();
  return blocks;
}

export type TableLayout = 'plain' | 'stack' | 'scroll';

/** Longest cell we still read as "a value" rather than "a sentence". */
export const DENSE_CELL_CHARS = 20;
/** A two-column table only earns cards once its cells are genuinely prose. */
export const PAIR_PROSE_CHARS = 90;

/**
 * Pick a presentation from a table's shape.
 *
 *  plain  — wraps naturally at any width. Few columns, or short cells.
 *  scroll — genuinely tabular grid (many short/numeric columns). Keeps the
 *           grid and pans inside its own scroller when it cannot fit.
 *  stack  — prose laid out as a table. Becomes one labelled card per row on
 *           narrow containers, stays an ordinary table on wide ones.
 *
 * The rule set is deliberately small and shape-based rather than
 * content-sniffing: an AI can emit any table, and a heuristic nobody can
 * predict is worse than one that is occasionally conservative.
 */
export function chooseTableLayout(cols: number, maxCellChars: number): TableLayout {
  if (cols <= 1) return 'plain';
  if (maxCellChars <= DENSE_CELL_CHARS) return cols >= 4 ? 'scroll' : 'plain';
  if (cols >= 3) return 'stack';
  return maxCellChars > PAIR_PROSE_CHARS ? 'stack' : 'plain';
}
