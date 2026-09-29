// Display only the recorded calendar date. Keep the original timestamp in the
// database for sorting, revisions and persistence.
export function formatDemoDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  // Avoid changing a fixture's date when the viewer is in another time zone.
  const recorded = typeof value === 'string' && value.match(/^(\d{4}-\d{2}-\d{2})(?:T|\s|$)/);
  if (recorded) return recorded[1];
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}
