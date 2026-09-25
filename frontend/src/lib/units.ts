/**
 * Everything in the app is stored canonically in ml — this is the one
 * place that converts for display, so "oz vs ml" only ever needs to be
 * solved once instead of copy-pasted into every screen that shows an
 * amount. Always pass her actual profile.unit_system; these functions
 * don't guess a default themselves.
 */

export type UnitSystem = "oz" | "ml";

export function formatVolume(ml: number | null | undefined, unitSystem: UnitSystem): string {
  if (ml == null) return "—";
  if (unitSystem === "ml") {
    return `${Math.round(ml)}ml`;
  }
  const oz = (ml / 29.5735).toFixed(1).replace(/\.0$/, "");
  return `${oz}oz`;
}

/** For an input field where she types a number in her preferred unit —
 * converts what she typed back to canonical ml for storage. */
export function parseVolumeInput(value: string, unitSystem: UnitSystem): number | null {
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return unitSystem === "ml" ? Math.round(n) : Math.round(n * 29.5735);
}

export function volumeUnitLabel(unitSystem: UnitSystem): string {
  return unitSystem === "ml" ? "ml" : "oz";
}
