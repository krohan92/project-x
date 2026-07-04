// Builds a self-contained Leaflet + OpenStreetMap page (real map tiles, no API key).
// Pins are already anonymized & jittered server-side (±10mi). We never receive
// or render precise coordinates or identities.

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
  .glow{
    width:16px;height:16px;border-radius:50%;
    background:#D68C7A;box-shadow:0 0 0 6px rgba(214,140,122,0.25),0 0 14px rgba(214,140,122,0.6);
  }
  .me{
    width:20px;height:20px;border-radius:50%;
    background:#98A99B;box-shadow:0 0 0 8px rgba(152,169,155,0.3),0 0 20px rgba(152,169,155,0.7);
    animation:pulse 2.4s ease-in-out infinite;
  }
  @keyframes pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.25);opacity:.85}}
  .leaflet-control-attribution{font-size:9px;opacity:.6;}
</style>
</head>
<body>
<div id="map"></div>
<script>
  var anchor=[${anchor.lat},${anchor.lng}];
  var pins=${pinsJson};
  var map=L.map('map',{zoomControl:false,attributionControl:true}).setView(anchor,11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom:19, attribution:'© OpenStreetMap'
  }).addTo(map);
  var glowIcon=L.divIcon({className:'',html:'<div class="glow"></div>',iconSize:[16,16],iconAnchor:[8,8]});
  var meIcon=L.divIcon({className:'',html:'<div class="me"></div>',iconSize:[20,20],iconAnchor:[10,10]});
  pins.forEach(function(p){
    L.marker([p.lat,p.lng],{icon:glowIcon}).addTo(map)
     .bindPopup('A mom is awake nearby'+(p.mins?(' · active '+p.mins+'m'):'')+'<br/><small>Location approximate</small>');
  });
  ${awake ? `L.marker(anchor,{icon:meIcon}).addTo(map).bindPopup('Your beacon (approximate)');` : ``}
</script>
</body>
</html>`;
}
