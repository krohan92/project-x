import React from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import { buildMapHtml, Pin, Anchor } from "./presence-map-html";

// Native: render the Leaflet page inside a WebView.
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
      <WebView
        originWhitelist={["*"]}
        source={{ html }}
        style={{ flex: 1, backgroundColor: "#F4EFE6" }}
        scrollEnabled={false}
      />
    </View>
  );
}
