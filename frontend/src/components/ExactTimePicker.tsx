import React from "react";
import DateTimePicker from "@react-native-community/datetimepicker";

/**
 * Native (iOS/Android) exact time picker. A separate .web.tsx sibling
 * handles web, since @react-native-community/datetimepicker is a native
 * module and isn't safe to bundle into the web build at all.
 */
export function ExactTimePicker({
  value,
  onChange,
}: {
  value: Date;
  onChange: (d: Date) => void;
}) {
  return (
    <DateTimePicker
      value={value}
      mode="time"
      display="spinner"
      // The app's own theme is always light, regardless of the phone's
      // system Dark Mode setting — without this, iOS can render the
      // picker's text for a dark background (near-white) while it's
      // actually sitting on this app's light cream card, making it look
      // washed out/illegible rather than genuinely "blurry."
      themeVariant="light"
      onChange={(_, selected) => {
        if (selected) onChange(selected);
      }}
    />
  );
}
