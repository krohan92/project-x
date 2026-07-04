import React from "react";
import { View } from "react-native";
import { buildMapHtml, Pin, Anchor } from "./presence-map-html";

// Web: render the Leaflet page directly in an iframe via srcDoc.
export function PresenceMap({
  anchor,
  pins,
  awake,
  height = 320,
}: {
  anchor: Anchor;
  pins: Pin[];
  awake: boolean;
  height?: number;
}) {
  const html = buildMapHtml(anchor, pins, awake);
  return (
    <View style={{ height, borderRadius: 20, overflow: "hidden" }}>
      {/* @ts-ignore web-only iframe */}
      <iframe
        title="presence-map"
        srcDoc={html}
        style={{ border: "none", width: "100%", height: "100%" }}
      />
    </View>
  );
}
