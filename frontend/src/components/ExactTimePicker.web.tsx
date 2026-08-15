import React from "react";

/**
 * Web version — a plain browser time input. The native community
 * datetimepicker package isn't usable on web, so this sibling file (picked
 * up automatically by Metro's .web.tsx convention) keeps the web build from
 * ever trying to bundle that native module at all.
 */
export function ExactTimePicker({
  value,
  onChange,
}: {
  value: Date;
  onChange: (d: Date) => void;
}) {
  const hh = String(value.getHours()).padStart(2, "0");
  const mm = String(value.getMinutes()).padStart(2, "0");

  return React.createElement("input", {
    type: "time",
    value: `${hh}:${mm}`,
    onChange: (e: any) => {
      const [h, m] = e.target.value.split(":").map(Number);
      if (Number.isFinite(h) && Number.isFinite(m)) {
        const next = new Date(value);
        next.setHours(h, m, 0, 0);
        onChange(next);
      }
    },
    style: {
      fontSize: 16,
      padding: 10,
      borderRadius: 10,
      border: "1px solid #E5DFD3",
      background: "#FAF7F0",
      width: "100%",
      boxSizing: "border-box",
    },
  });
}
