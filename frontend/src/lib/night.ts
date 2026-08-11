// Simple local-clock check for "is it late right now" — no timezone lookup
// needed since we only care about the device's own local time.
export function isNightTime(date: Date = new Date()): boolean {
  const h = date.getHours();
  return h >= 21 || h < 6;
}
