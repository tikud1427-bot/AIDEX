import { cn } from '@/lib/utils';

/**
 * The app's one raised surface.
 *
 * Named Panel, not Card, deliberately: the product has three private `Card`
 * shells and a brief that asks for fewer cards, so the shared primitive
 * should not be the thing that makes another grid of them feel like the
 * default. A panel is a surface something sits on; a card is an object in a
 * deck.
 */
export function Panel({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-xl border border-border bg-surface p-4 shadow-[0_1px_2px_rgb(0_0_0/0.04)]', className)}
      {...rest}
    >
      {children}
    </div>
  );
}
