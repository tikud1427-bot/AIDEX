/**
 * Eyebrow + title pair. Written for the Mind page, which is where the
 * product's calmest typography already lived; promoted here so the rest of
 * the interface can be brought up to the same register instead of
 * hand-rolling a heading per screen.
 */
export function SectionHeader({
  eyebrow,
  title,
  aside,
}: {
  eyebrow: string;
  title: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <div className="text-micro font-medium uppercase tracking-[0.16em] text-foreground-secondary">{eyebrow}</div>
        <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">{title}</h2>
      </div>
      {aside}
    </div>
  );
}
