import type { CategorySpend } from '../server/spending';

// Angles start at twelve o'clock. The undisplayed remainder stays an empty track.
export function donutSlices(categories: CategorySpend[], total: number) {
  let start = 0;
  return categories.map(category => {
    const sweep = total > 0 ? category.amount / total * 360 : 0;
    const slice = { ...category, start, sweep, middle: start + sweep / 2 };
    start += sweep;
    return slice;
  });
}
export function donutPath(start: number, sweep: number) {
  const point = (radius: number, degrees: number) => {
    const radians = (degrees - 90) * Math.PI / 180;
    return `${160 + radius * Math.cos(radians)},${160 + radius * Math.sin(radians)}`;
  };
  // Two arcs support an exact full-circle category without a degenerate SVG arc.
  const half = sweep / 2;
  return `M ${point(144, start)} A 144 144 0 0 1 ${point(144, start + half)} A 144 144 0 0 1 ${point(144, start + sweep)} L ${point(100, start + sweep)} A 100 100 0 0 0 ${point(100, start + half)} A 100 100 0 0 0 ${point(100, start)} Z`;
}
