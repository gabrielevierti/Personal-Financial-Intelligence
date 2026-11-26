/** Mini grafico SVG senza assi: mostra la forma della serie, i punti null interrompono la linea. */
export function Sparkline({ values, width = 120, height = 32, label }: { values: Array<number | null>; width?: number; height?: number; label: string }) {
  const nums = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (nums.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const step = width / Math.max(1, values.length - 1);
  let d = '';
  let pen = false;
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      pen = false;
      return;
    }
    const x = i * step;
    const y = height - 3 - ((v - min) / span) * (height - 6);
    d += `${pen ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    pen = true;
  });
  const last = nums[nums.length - 1];
  const first = nums[0];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={`spark ${last >= first ? 'up' : 'down'}`} role="img" aria-label={label}>
      <path d={d} fill="none" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
