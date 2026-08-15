// Design tokens for Cuddle Postpartum — "Hand-Drawn / Journal" personality.
export const colors = {
  surface: "#FDFBF7",
  onSurface: "#2C2925",
  surfaceSecondary: "#F4EFE6",
  onSurfaceSecondary: "#3A3631",
  surfaceTertiary: "#EAE3D6",
  onSurfaceTertiary: "#4F4A44",
  surfaceInverse: "#2C2925",
  onSurfaceInverse: "#FDFBF7",
  brand: "#D68C7A",
  brandPrimary: "#D68C7A",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#98A99B",
  onBrandSecondary: "#1A2421",
  brandTertiary: "#E2C8B5",
  onBrandTertiary: "#44352D",
  success: "#8A9A5B",
  onSuccess: "#FFFFFF",
  warning: "#DEB068",
  onWarning: "#3A2A12",
  error: "#CC7373",
  onError: "#FFFFFF",
  info: "#8CA8B0",
  onInfo: "#FFFFFF",
  border: "#EAE3D6",
  borderStrong: "#D5C8B2",
  divider: "#EAE3D6",
  muted: "#8A8178",
  // Soft, low-saturation role accents for the Tag Team hand-off feature.
  // Pastel by design — an accent, not a loud UI shift, to keep the app calm.
  roleMom: "#E8A9BC",
  roleMomTint: "#FBEEF2",
  roleDad: "#93B4D6",
  roleDadTint: "#EDF3FA",
  roleNeutral: "#B6AFA3",
  roleNeutralTint: "#F4F1EB",
};

// Soft, low-saturation accent per caregiver role — shared between the Tag
// Team card and the app-wide ambient background. Deliberately gentle:
// this shifts the mood of the app slightly, never overwhelms it.
export function roleAccent(role?: string | null) {
  const r = (role || "").toLowerCase();
  if (r.includes("mom") || r.includes("mother") || r === "primary") {
    return { fg: colors.roleMom, tint: colors.roleMomTint };
  }
  if (r.includes("dad") || r.includes("father") || r === "partner") {
    return { fg: colors.roleDad, tint: colors.roleDadTint };
  }
  if (r) {
    return { fg: colors.roleNeutral, tint: colors.roleNeutralTint };
  }
  return null;
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  "3xl": 48,
};

export const radius = {
  sm: 6,
  md: 12,
  lg: 20,
  pill: 999,
};

export const fonts = {
  display: "Fraunces",
  displayMedium: "Fraunces-Medium",
  displayItalic: "Fraunces-Italic",
  text: "Quicksand",
  textMedium: "Quicksand-Medium",
};

export const fontSize = {
  sm: 12,
  base: 14,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 30,
  "4xl": 38,
};
