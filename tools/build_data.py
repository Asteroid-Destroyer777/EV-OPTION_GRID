"""Собирает компактный набор данных пилотной территории (ЗИЛ / Даниловский район) из сырых ответов Overpass.
Проекция локальная: x — на восток (м), z — на юг (м) от центра. Данные © участники OpenStreetMap (ODbL).
Запуск: python3 tools/build_data.py  ->  data/zil.json
"""
import json, math, os, re, hashlib, datetime

S, W, N, E = 55.688, 37.608, 55.728, 37.684
LAT0, LON0 = (S + N) / 2, (W + E) / 2
KX = 111320 * math.cos(math.radians(LAT0))
KZ = 110574
HALF_W = (E - W) / 2 * KX
HALF_H = (N - S) / 2 * KZ
RAW = os.path.join(os.path.dirname(__file__), "raw")
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "zil.json")


def load(n):
    p = os.path.join(RAW, n + ".json")
    return json.load(open(p))["elements"] if os.path.exists(p) else []


def prj(p):
    return ((p["lon"] - LON0) * KX, -(p["lat"] - LAT0) * KZ)


def r1(v):
    return round(v, 1)


def flat(pts):
    out = []
    for x, z in pts:
        out.append(r1(x)); out.append(r1(z))
    return out


# ---------- геометрия ----------
def dp(pts, tol):
    if len(pts) < 3 or tol <= 0:
        return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, az = pts[a]; bx, bz = pts[b]
        dx, dz = bx - ax, bz - az
        L = dx * dx + dz * dz
        best, bi = -1, -1
        for i in range(a + 1, b):
            px, pz = pts[i]
            if L == 0:
                d = math.hypot(px - ax, pz - az)
            else:
                t = max(0, min(1, ((px - ax) * dx + (pz - az) * dz) / L))
                d = math.hypot(px - (ax + t * dx), pz - (az + t * dz))
            if d > best:
                best, bi = d, i
        if best > tol:
            keep[bi] = True
            stack.append((a, bi)); stack.append((bi, b))
    return [p for p, k in zip(pts, keep) if k]


def clip_poly(poly, x0=-HALF_W, x1=HALF_W, z0=-HALF_H, z1=HALF_H):
    """Sutherland–Hodgman против прямоугольника."""
    def clip(pts, inside, inter):
        out = []
        for i in range(len(pts)):
            a, b = pts[i - 1], pts[i]
            ia, ib = inside(a), inside(b)
            if ib:
                if not ia:
                    out.append(inter(a, b))
                out.append(b)
            elif ia:
                out.append(inter(a, b))
        return out
    def ix(xc):
        return lambda a, b: (xc, a[1] + (b[1] - a[1]) * (xc - a[0]) / (b[0] - a[0]))
    def iz(zc):
        return lambda a, b: (a[0] + (b[0] - a[0]) * (zc - a[1]) / (b[1] - a[1]), zc)
    pts = poly[:-1] if poly[0] == poly[-1] else poly[:]
    for inside, inter in ((lambda p: p[0] >= x0, ix(x0)), (lambda p: p[0] <= x1, ix(x1)),
                          (lambda p: p[1] >= z0, iz(z0)), (lambda p: p[1] <= z1, iz(z1))):
        if not pts:
            return []
        pts = clip(pts, inside, inter)
    return pts


def clip_line(pts, x0=-HALF_W, x1=HALF_W, z0=-HALF_H, z1=HALF_H):
    """Liang–Barsky по сегментам; возвращает список ломаных."""
    res, cur = [], []
    for i in range(len(pts) - 1):
        (ax, az), (bx, bz) = pts[i], pts[i + 1]
        dx, dz = bx - ax, bz - az
        t0, t1 = 0.0, 1.0
        ok = True
        for p, q in ((-dx, ax - x0), (dx, x1 - ax), (-dz, az - z0), (dz, z1 - az)):
            if p == 0:
                if q < 0:
                    ok = False; break
            else:
                r = q / p
                if p < 0:
                    if r > t1: ok = False; break
                    t0 = max(t0, r)
                else:
                    if r < t0: ok = False; break
                    t1 = min(t1, r)
        if not ok:
            if len(cur) > 1: res.append(cur)
            cur = []
            continue
        sa = (ax + t0 * dx, az + t0 * dz); sb = (ax + t1 * dx, az + t1 * dz)
        if cur and abs(cur[-1][0] - sa[0]) < 1e-6 and abs(cur[-1][1] - sa[1]) < 1e-6:
            cur.append(sb)
        else:
            if len(cur) > 1: res.append(cur)
            cur = [sa, sb]
    if len(cur) > 1: res.append(cur)
    return res


def area(pts):
    a = 0
    for i in range(len(pts)):
        x1, z1 = pts[i - 1]; x2, z2 = pts[i]
        a += x1 * z2 - x2 * z1
    return a / 2


def centroid(pts):
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def assemble(ways):
    pool = [w[:] for w in ways if len(w) > 1]
    rings = []
    while pool:
        cur = pool.pop()
        while cur[0] != cur[-1]:
            found = False
            for i, w in enumerate(pool):
                if w[0] == cur[-1]: cur = cur + w[1:]
                elif w[-1] == cur[-1]: cur = cur + w[::-1][1:]
                elif w[-1] == cur[0]: cur = w + cur[1:]
                elif w[0] == cur[0]: cur = w[::-1] + cur[1:]
                else: continue
                pool.pop(i); found = True; break
            if not found: break
        if cur[0] == cur[-1] and len(cur) >= 4:
            rings.append(cur)
    return rings


def pip(pt, ring):
    x, z = pt; inside = False
    for i in range(len(ring)):
        x1, z1 = ring[i - 1]; x2, z2 = ring[i]
        if (z1 > z) != (z2 > z) and x < (x2 - x1) * (z - z1) / (z2 - z1) + x1:
            inside = not inside
    return inside


def rel_polys(e):
    """multipolygon -> [(outer, [holes])] в локальных метрах."""
    outers, inners = [], []
    for m in e.get("members", []):
        if m.get("type") != "way" or "geometry" not in m: continue
        g = [prj(p) for p in m["geometry"]]
        (inners if m.get("role") == "inner" else outers).append(g)
    outs = assemble(outers); ins = assemble(inners)
    res = []
    for o in outs:
        holes = [i for i in ins if pip(i[0], o)]
        res.append((o, holes))
    return res


def h32(s):
    return int(hashlib.md5(str(s).encode()).hexdigest()[:8], 16)


def num(v):
    if v is None: return None
    m = re.match(r"^\s*(\d+(?:[.,]\d+)?)", str(v))
    return float(m.group(1).replace(",", ".")) if m else None


# ---------- здания ----------
RES = {"apartments", "residential", "house", "detached", "dormitory", "terrace", "semidetached_house", "bungalow"}
COM = {"office", "commercial", "retail", "hotel", "supermarket", "kiosk", "mall"}
IND = {"industrial", "warehouse", "factory", "manufacture", "hangar", "storage_tank", "cargo"}
PUB = {"school", "kindergarten", "hospital", "church", "cathedral", "chapel", "civic", "university", "college", "public", "government", "clinic", "religious", "train_station", "transportation", "sports_hall", "stadium", "museum", "theatre"}
SMALL = {"service", "garage", "garages", "shed", "roof", "carport", "hut", "container", "transformer_tower", "parking"}


def building_from(tags, ring):
    b = tags.get("building", "yes")
    kind = 0
    if b in RES: kind = 1
    elif b in COM: kind = 2
    elif b in IND: kind = 3
    elif b in PUB: kind = 4
    elif b in SMALL: kind = 5
    a = abs(area(ring))
    h = num(tags.get("height"))
    lv = num(tags.get("building:levels"))
    if h is None and lv is not None: h = lv * 3.1 + 1.5
    seed = h32(tuple(round(c) for c in ring[0]))
    if h is None:
        if kind == 1: h = [15.5, 27, 27, 36, 43, 51, 27, 19][seed % 8] if a > 350 else 9 + (seed % 3) * 3
        elif kind == 2: h = 12 + (seed % 5) * 4
        elif kind == 3: h = 9 + (seed % 4) * 3.5
        elif kind == 4: h = 12 + (seed % 3) * 4
        elif kind == 5: h = 3.5 + (seed % 2) * 2
        else: h = 9 if a < 200 else 9 + (seed % 5) * 5
    if b == "roof" or b == "carport": h = min(h, 5)
    flags = 0
    sd = num(tags.get("start_date"))
    if b == "construction" or (sd is not None and sd >= 2012) or (lv is not None and lv >= 22):
        flags |= 1  # новая / строящаяся застройка
    if b == "construction": flags |= 2
    return kind, round(h, 1), flags


def build_buildings():
    out = []
    els = load("buildings")
    for e in els:
        g = [prj(p) for p in e.get("geometry", [])]
        if len(g) < 4 or g[0] != g[-1]: continue
        if not (-HALF_W < centroid(g)[0] < HALF_W and -HALF_H < centroid(g)[1] < HALF_H): continue
        ring = dp(g[:-1], 0.35)
        ring = clip_poly(ring)
        if len(ring) < 3 or abs(area(ring)) < 14: continue
        if area(ring) > 0: ring = ring[::-1]  # единая ориентация (по часовой в x/z)
        k, h, f = building_from(e["tags"], ring)
        out.append([k, h, f, flat(ring), e["tags"].get("name", "")[:40]])
    for e in load("buildings_rel"):
        for o, holes in rel_polys(e):
            ring = clip_poly(dp(o[:-1], 0.5))
            if len(ring) < 3 or abs(area(ring)) < 30: continue
            if area(ring) > 0: ring = ring[::-1]
            k, h, f = building_from(e.get("tags", {}), ring)
            out.append([k, h, f, flat(ring), e.get("tags", {}).get("name", "")[:40]])
    return out


# ---------- дороги ----------
CLS = {"motorway": 0, "trunk": 0, "motorway_link": 1, "trunk_link": 1, "primary": 1, "primary_link": 2,
       "secondary": 2, "secondary_link": 3, "tertiary": 3, "tertiary_link": 3, "unclassified": 4,
       "residential": 4, "living_street": 4, "service": 5, "pedestrian": 6, "footway": 6, "cycleway": 6}


def bridge_ys(pts):
    """Профиль высоты моста/эстакады по вершинам ломаной (м)."""
    cum = [0.0]
    for i in range(1, len(pts)):
        cum.append(cum[-1] + math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
    L = cum[-1]
    if L < 10: return None
    H = 4.6 + min(4.6, L / 70)
    ramp = max(8.0, min(80.0, L * 0.38))
    ys = []
    for c in cum:
        t = max(0.0, min(1.0, min(c, L - c) / ramp))
        ys.append(round(H * t * t * (3 - 2 * t), 2))
    return ys


def build_roads():
    out = []
    for e in load("roads"):
        t = e["tags"]; hw = t.get("highway")
        if hw not in CLS: continue
        if hw in ("path", "steps"): continue
        g = [prj(p) for p in e["geometry"]]
        cls = CLS[hw]
        if t.get("access") in ("private", "no") and cls >= 5: continue
        if t.get("service") in ("parking_aisle", "driveway") and cls == 5:
            pass
        flags = 0
        if t.get("bridge") not in (None, "no"): flags |= 1
        if t.get("tunnel") not in (None, "no"): flags |= 2
        if t.get("oneway") in ("yes", "1", "true"): flags |= 4
        name = t.get("name", "")
        if "Третье транспортное" in name: flags |= 8
        for piece in clip_line(g):
            piece = dp(piece, 1.4)
            L = sum(math.hypot(piece[i + 1][0] - piece[i][0], piece[i + 1][1] - piece[i][1]) for i in range(len(piece) - 1))
            if L < (12 if cls <= 4 else 25): continue
            lanes = int(num(t.get("lanes")) or 0)
            row = [cls, flags, flat(piece), name[:40] if cls <= 3 else "", lanes]
            if flags & 1:
                ys = bridge_ys(piece)
                row.append(ys if ys else 0)
            out.append(row)
    return out


def build_graph():
    """Топологически корректный граф улично-дорожной сети (только проезжие классы) для маршрутизации потоков."""
    ways = []
    for e in load("roads"):
        t = e["tags"]; hw = t.get("highway")
        if hw not in CLS or CLS[hw] > 4: continue
        if t.get("tunnel") not in (None, "no"): continue
        if t.get("access") in ("no", "private"): continue
        ids = e["nodes"]; g = [prj(p) for p in e["geometry"]]
        if len(ids) != len(g): continue
        ways.append((e, ids, g))
    use = {}
    for e, ids, g in ways:
        for i, n in enumerate(ids):
            use[n] = use.get(n, 0) + (2 if i in (0, len(ids) - 1) else 1)
    inside = lambda p: -HALF_W < p[0] < HALF_W and -HALF_H < p[1] < HALF_H
    nid, nodes, edges = {}, [], []
    def node(n, p, y):
        if n not in nid:
            nid[n] = len(nodes); nodes.append([r1(p[0]), r1(p[1]), y])
        return nid[n]
    for e, ids, g in ways:
        t = e["tags"]; cls = CLS[t["highway"]]
        bridge = t.get("bridge") not in (None, "no")
        ys = bridge_ys(g) if bridge else None
        ow = 1 if t.get("oneway") in ("yes", "1", "true") else (-1 if t.get("oneway") == "-1" else 0)
        if t.get("junction") == "roundabout": ow = 1
        start = 0
        for i in range(1, len(ids)):
            if not (inside(g[i]) and inside(g[i - 1])):
                start = i; continue
            if use[ids[i]] >= 2 or i == len(ids) - 1:
                if start < i and inside(g[start]):
                    seg = g[start:i + 1]
                    yy = ys[start:i + 1] if ys else None
                    a = node(ids[start], g[start], round(yy[0], 2) if yy else 0)
                    b = node(ids[i], g[i], round(yy[-1], 2) if yy else 0)
                    if a != b:
                        L = sum(math.hypot(seg[k + 1][0] - seg[k][0], seg[k + 1][1] - seg[k][1]) for k in range(len(seg) - 1))
                        mid = flat(seg[1:-1]) if len(seg) > 2 else []
                        my = [round(v, 2) for v in yy[1:-1]] if (yy and len(seg) > 2) else []
                        edges.append([a, b, cls, ow, round(L, 1), mid, my])
                start = i
    # наибольшая компонента связности
    adj = {}
    for k, ed in enumerate(edges):
        adj.setdefault(ed[0], []).append(ed[1]); adj.setdefault(ed[1], []).append(ed[0])
    seen, best = set(), []
    for n0 in adj:
        if n0 in seen: continue
        comp, st = [], [n0]; seen.add(n0)
        while st:
            u = st.pop(); comp.append(u)
            for v in adj[u]:
                if v not in seen: seen.add(v); st.append(v)
        if len(comp) > len(best): best = comp
    keep = set(best)
    remap = {n: i for i, n in enumerate(sorted(keep))}
    nn = [nodes[n] for n in sorted(keep)]
    ee = [[remap[a], remap[b], c, o, l, m, my] for a, b, c, o, l, m, my in edges if a in keep and b in keep]
    return {"nodes": nn, "edges": ee}


def build_rail():
    out = []
    for e in load("rail"):
        t = e["tags"]; k = t.get("railway"); name = t.get("name", "")
        if k == "construction": continue
        if t.get("service") in ("yard", "siding", "crossover") and k in ("rail",): kind = 5  # станционные пути
        elif "Малое кольцо" in name: kind = 3   # МЦК
        elif k == "rail": kind = 0
        elif k == "subway": kind = 1
        elif k in ("tram", "light_rail"): kind = 2
        else: continue
        if kind == 2 and t.get("service") in ("yard",): continue
        flags = 0
        if t.get("bridge") not in (None, "no"): flags |= 1
        if t.get("tunnel") not in (None, "no"): flags |= 2
        g = [prj(p) for p in e["geometry"]]
        for piece in clip_line(g):
            piece = dp(piece, 1.6)
            if len(piece) < 2: continue
            row = [kind, flags, flat(piece), name[:40]]
            if flags & 1:
                ys = bridge_ys(piece)
                row.append(ys if ys else 0)
            out.append(row)
    return out


def build_water():
    polys = []
    for e in load("water"):
        t = e.get("tags", {})
        if e["type"] == "way":
            if t.get("waterway") in ("river", "canal", "stream"): continue
            g = [prj(p) for p in e.get("geometry", [])]
            if len(g) >= 4 and g[0] == g[-1]: polys.append((g, []))
        else:
            polys.extend(rel_polys(e))
    out = []
    for o, holes in polys:
        oc = clip_poly(dp(o[:-1], 1.5))
        if len(oc) < 3 or abs(area(oc)) < 400: continue
        hs = []
        for h in holes:
            hc = clip_poly(dp(h[:-1], 1.5))
            if len(hc) >= 3 and abs(area(hc)) > 100: hs.append(flat(hc))
        out.append({"o": flat(oc), "h": hs})
    # линии рек (для подписи/эффектов)
    lines = []
    for e in load("water"):
        t = e.get("tags", {})
        if e["type"] == "way" and t.get("waterway") in ("river", "canal") and e.get("geometry"):
            g = [prj(p) for p in e["geometry"]]
            for piece in clip_line(g):
                lines.append(flat(dp(piece, 3)))
    return out, lines


LAND = {"residential": 1, "commercial": 2, "retail": 2, "industrial": 3, "brownfield": 3, "construction": 3, "garages": 3,
        "railway": 4, "military": 3, "park": 5, "garden": 5, "nature_reserve": 5, "recreation_ground": 5,
        "forest": 6, "wood": 6, "scrub": 6, "grass": 6, "meadow": 6, "grassland": 6, "greenfield": 6, "flowerbed": 6, "wetland": 6,
        "parking": 7, "education": 8, "pitch": 9, "stadium": 9, "sports_centre": 9, "track": 9, "playground": 9, "cemetery": 10}


def land_cat(t):
    for key in ("landuse", "leisure", "natural", "amenity"):
        v = t.get(key)
        if v in LAND: return LAND[v]
    return None


def build_land():
    items = []
    for e in load("landuse"):
        t = e.get("tags", {}); c = land_cat(t)
        if c is None: continue
        if e["type"] == "way":
            g = [prj(p) for p in e.get("geometry", [])]
            if len(g) >= 4 and g[0] == g[-1]: polys = [(g, [])]
            else: continue
        else:
            polys = rel_polys(e)
        for o, holes in polys:
            oc = clip_poly(dp(o[:-1], 2.0))
            if len(oc) < 3: continue
            a = abs(area(oc))
            if a < (250 if c == 7 else 900): continue
            hs = []
            for h in holes:
                hc = clip_poly(dp(h[:-1], 2.0))
                if len(hc) >= 3 and abs(area(hc)) > 200: hs.append(flat(hc))
            items.append((a, [c, flat(oc), hs, t.get("name", "")[:40]]))
    items.sort(key=lambda x: -x[0])
    return [i[1] for i in items]


# ---------- POI ----------
def ctr(e):
    if e["type"] == "node": return prj(e)
    if e["type"] == "way" and e.get("geometry"):
        g = [prj(p) for p in e["geometry"]]; return centroid(g)
    b = e.get("bounds")
    if b: return prj({"lat": (b["minlat"] + b["maxlat"]) / 2, "lon": (b["minlon"] + b["maxlon"]) / 2})
    return None


def build_poi():
    P = {"charging": [], "substations": [], "stations": [], "chimneys": [], "malls": [], "plants": [], "bridges": [], "towers": []}
    seen = set()
    for e in load("poi"):
        t = e.get("tags", {}); c = ctr(e)
        if not c: continue
        x, z = c
        if not (-HALF_W < x < HALF_W and -HALF_H < z < HALF_H): continue
        key = (e["type"], e["id"])
        if key in seen: continue
        seen.add(key)
        name = t.get("name", "")
        if t.get("amenity") == "charging_station":
            P["charging"].append({"x": r1(x), "z": r1(z), "op": t.get("operator", t.get("brand", "")), "cap": t.get("capacity", "")})
        elif t.get("power") == "substation":
            poly = None
            if e["type"] == "way" and e.get("geometry"):
                poly = flat([prj(p) for p in e["geometry"]][:-1])
            P["substations"].append({"x": r1(x), "z": r1(z), "name": name, "volt": t.get("voltage", ""), "kind": t.get("substation", ""), "poly": poly})
        elif t.get("power") == "plant":
            if e["type"] != "node":
                poly = None
                if e["type"] == "way" and e.get("geometry"):
                    poly = flat([prj(p) for p in e["geometry"]][:-1])
                P["plants"].append({"x": r1(x), "z": r1(z), "name": name, "poly": poly})
        elif t.get("railway") in ("station", "halt") or t.get("station") == "subway":
            op = t.get("operator", "").lower()
            kind = "metro" if (t.get("railway") == "station" and "метрополитен" in op) else ("mcc" if ("метрополитен" in op and "ржд" in op) else "rail")
            P["stations"].append({"x": r1(x), "z": r1(z), "name": name, "kind": kind})
        elif t.get("man_made") == "chimney":
            P["chimneys"].append({"x": r1(x), "z": r1(z), "h": num(t.get("height")) or 0})
        elif t.get("man_made") == "tower" and name:
            P["towers"].append({"x": r1(x), "z": r1(z), "name": name})
        elif t.get("man_made") == "bridge" and name:
            P["bridges"].append({"x": r1(x), "z": r1(z), "name": name})
        elif t.get("shop") == "mall":
            poly = None
            if e["type"] == "way" and e.get("geometry"):
                poly = flat([prj(p) for p in e["geometry"]][:-1])
            P["malls"].append({"x": r1(x), "z": r1(z), "name": name, "poly": poly})
    return P


def main():
    B = build_buildings()
    R = build_roads()
    RL = build_rail()
    WT, WL = build_water()
    L = build_land()
    P = build_poi()
    GR = build_graph()
    data = {
        "meta": {"lat0": LAT0, "lon0": LON0, "halfW": round(HALF_W, 1), "halfH": round(HALF_H, 1), "kx": KX, "kz": KZ,
                 "source": "© участники OpenStreetMap (ODbL), выгрузка Overpass API",
                 "generated": datetime.date.today().isoformat()},
        "buildings": B, "roads": R, "rail": RL, "water": WT, "waterLines": WL, "land": L, "poi": P, "graph": GR,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    s = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    open(OUT, "w").write(s)
    print(f"buildings={len(B)} roads={len(R)} rail={len(RL)} water={len(WT)} land={len(L)} poi={ {k: len(v) for k, v in P.items()} }")
    print(f"graph nodes={len(GR['nodes'])} edges={len(GR['edges'])}")
    print(f"halfW={HALF_W:.0f} halfH={HALF_H:.0f}  size={len(s)/1e6:.2f} MB")


if __name__ == "__main__":
    main()
