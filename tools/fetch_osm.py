"""Загружает открытые данные OpenStreetMap (Overpass API) для пилотной территории ЗИЛ / Даниловский район.
Данные © участники OpenStreetMap, лицензия ODbL. Сырые ответы сохраняются в tools/raw/."""
import json, os, sys, time, urllib.request, urllib.parse
BBOX = (55.688, 37.608, 55.728, 37.684)  # S, W, N, E
b = ",".join(map(str, BBOX))
ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
UA = "ev-option-grid-prototype/0.1 (student project; contact via repo)"
QUERIES = {
 "buildings": f'way["building"]({b});',
 "buildings_rel": f'relation["building"]({b});',
 "roads": f'way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|pedestrian|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|footway|cycleway|path|steps)$"]({b});',
 "rail": f'way["railway"~"^(rail|subway|light_rail|tram|construction)$"]({b});',
 "water": f'way["natural"="water"]({b}); relation["natural"="water"]({b}); way["waterway"="riverbank"]({b}); relation["waterway"="riverbank"]({b}); way["waterway"~"^(river|canal|stream)$"]({b});',
 "landuse": f'way["landuse"~"^(industrial|residential|commercial|retail|forest|grass|railway|garages|construction|brownfield|cemetery|recreation_ground|meadow|flowerbed|greenfield|education|military)$"]({b}); relation["landuse"~"^(industrial|residential|commercial|retail|forest|grass|railway|garages|construction|brownfield|cemetery|recreation_ground|meadow|greenfield|education)$"]({b}); way["leisure"~"^(park|garden|pitch|stadium|sports_centre|playground|recreation_ground|nature_reserve|track)$"]({b}); relation["leisure"~"^(park|garden|nature_reserve|recreation_ground)$"]({b}); way["natural"~"^(wood|scrub|grassland|wetland)$"]({b}); relation["natural"~"^(wood|scrub|grassland|wetland)$"]({b}); way["amenity"="parking"]({b}); relation["amenity"="parking"]({b});',
 "poi": f'nwr["amenity"="charging_station"]({b}); nwr["power"~"^(substation|plant|generator)$"]({b}); nwr["railway"~"^(station|subway_entrance|halt)$"]({b}); nwr["station"="subway"]({b}); nwr["public_transport"="station"]({b}); nwr["shop"="mall"]({b}); nwr["amenity"="bus_station"]({b}); nwr["landuse"="depot"]({b}); nwr["highway"="bus_stop"]["network"]({b}); nwr["tourism"="attraction"]({b}); nwr["man_made"~"^(bridge|chimney|tower)$"]({b}); nwr["name"~"ЗИЛ|Автозавод|Технопарк|Тюфелев"]({b});',
}
def run(name, body):
    q = f"[out:json][timeout:180];({body});out geom;"
    last = None
    for ep in ENDPOINTS:
        for attempt in range(2):
            try:
                req = urllib.request.Request(ep, data=urllib.parse.urlencode({"data": q}).encode(), headers={"User-Agent": UA, "Accept": "application/json"})
                t0 = time.time()
                raw = urllib.request.urlopen(req, timeout=240).read()
                d = json.loads(raw)
                print(f"{name}: {len(d['elements'])} elements, {len(raw)/1e6:.1f} MB, {time.time()-t0:.0f}s via {ep}")
                return d
            except Exception as e:
                last = e; print(f"{name}: retry ({ep}): {e}"); time.sleep(4)
    raise SystemExit(f"failed {name}: {last}")
os.makedirs("tools/raw", exist_ok=True)
only = sys.argv[1:] or list(QUERIES)
for n in only:
    d = run(n, QUERIES[n])
    json.dump(d, open(f"tools/raw/{n}.json", "w"), ensure_ascii=False)
