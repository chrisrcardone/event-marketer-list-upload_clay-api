/**
 * The required "Demo" pill from the design review: quiet, next to the product
 * name, visible on every signed-in screen. Do not remove, soften, or move it.
 */
export function DemoPill() {
  return (
    <span
      className="inline-flex items-center whitespace-nowrap rounded-pill border border-line bg-oat-200 px-[9px] pt-[4px] pb-[3px] font-mono text-[9.5px] font-semibold uppercase tracking-[.06em] text-oat-400"
      style={{ fontVariationSettings: '"MONO" 0.5' }}
    >
      Demo
    </span>
  );
}
