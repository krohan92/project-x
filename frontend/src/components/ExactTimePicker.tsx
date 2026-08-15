import React from "react";
import { Platform } from "react-native";
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
      display={Platform.OS === "ios" ? "spinner" : "default"}
      onChange={(_, selected) => {
        if (selected) onChange(selected);
      }}
    />
  );
}
