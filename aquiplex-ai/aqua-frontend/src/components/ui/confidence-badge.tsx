import { confidenceTone } from '@/lib/format';
import { cn } from '@/lib/utils';

/** A belief's confidence as a percentage, toned by how sure AQUA is. */
export function ConfidenceBadge({ value, className }: { value: number; className?: string }) {
  return (
    <span
      className={cn(
        'rounded-full border border-border bg-surface-secondary px-2 py-0.5 font-mono text-micro tabular-nums',
        confidenceTone(value),
        className,
      )}
    >
      {Math.round(value * 100)}%
    </span>
  );
}
