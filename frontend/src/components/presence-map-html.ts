// Builds a self-contained Leaflet + OpenStreetMap page (real map tiles, no API key).
// Locations are anonymized, jittered, and snapped to a coarse grid server-side
// (~15mi randomization, ~2.5mi grid cells). We render them as soft translucent
// zones rather than pins, so nothing on screen implies a precise, live position.

export type Pin = { id: string; lat: number; lng: number; mins?: number };
export type Anchor = { lat: number; lng: number };

export function buildMapHtml(anchor: Anchor, pins: Pin[], awake: boolean): string {
  const pinsJson = JSON.stringify(pins || []);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html,body,#map{height:100%;margin:0;padding:0;background:#F4EFE6;}
  .leaflet-container{background:#F4EFE6;font-family:sans-serif;}
  .leaflet-control-attribution{font-size:9px;opacity:.6;}
</style>
</head>
<body>
<div id="map"></div>
<script>
  var anchor=[${anchor.lat},${anchor.lng}];
  var pins=${pinsJson};
  // Zoomed out a bit further than a street-level view, reinforcing "general area".
  var map=L.map('map',{zoomControl:false,attributionControl:true}).setView(anchor,10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom:19, attribution:'© OpenStreetMap'
  }).addTo(map);
  // Soft translucent zone, ~2.5mi radius, instead of a precise dot — communicates
  // "somewhere around here" rather than an exact spot.
  pins.forEach(function(p){
    L.circle([p.lat,p.lng],{
      radius: 4000, color:'#D68C7A', weight:1, fillColor:'#D68C7A', fillOpacity:0.18
    }).addTo(map).bindPopup('A mom is awake somewhere in this area'+(p.mins?(' · active '+p.mins+'m'):'')+'<br/><small>Approximate area, not an exact location</small>');
  });
  ${awake ? `L.circle(anchor,{radius: 4000, color:'#98A99B', weight:1, fillColor:'#98A99B', fillOpacity:0.22}).addTo(map).bindPopup('Your general area — not your exact location');` : ``}
</script>
</body>
</html>`;
}
