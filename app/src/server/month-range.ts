// A missing query selects the current UTC month; empty and duplicate values are invalid.
export function monthRange(month: string | null, today = new Date().toISOString().slice(0, 10)) {
  const selected = month ?? today.slice(0, 7);
  if (selected.length !== 7 || !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(selected) || selected < '0001-01') {
    throw new Error('Month must be YYYY-MM.');
  }
  const end = new Date(selected + '-01T00:00:00Z');
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);
  return { from: selected + '-01', through: selected === today.slice(0, 7) ? today : end.toISOString().slice(0, 10) };
}
