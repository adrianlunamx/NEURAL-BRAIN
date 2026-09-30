"""Generates the Neural Brain logo as SVG: docs/brand/logo-{mark,dark,light}.svg and frontend/public/favicon.svg.

Run: python3 docs/brand/make_logo.py  (deterministic: same seed, same logo)
"""
import math, random
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE
PUB = HERE.parent.parent / "frontend" / "public"

# lateral brain, frontal lobe to the right (viewBox 0..100)
CEREBRUM = [(30,68),(18,68,10,58,12,47),(13,34,22,23,34,19),(42,12,56,9,67,13),(79,14,89,22,91,35),
            (94,45,90,55,83,59),(80,65,72,67,65,65),(61,71,54,73,48,70),(43,68,38,69,34,69),(32,69,31,68,30,68)]
CEREBELLUM = [(26,66),(20,66,15,70,16,76),(17,82,26,84,33,81),(38,79,40,74,36,70),(33,67,29,66,26,66)]
STEM = [(40,68),(41,74,42,80,46,86),(47,88,51,88,51,85),(49,79,48,73,47,68)]

def path_d(pts):
    d = f"M{pts[0][0]},{pts[0][1]}"
    for c in pts[1:]:
        d += f" C{c[0]},{c[1]} {c[2]},{c[3]} {c[4]},{c[5]}"
    return d + " Z"

def flatten(pts, n=24):
    out = []; x0, y0 = pts[0]
    for c in pts[1:]:
        for i in range(1, n + 1):
            t = i / n; u = 1 - t
            x = u**3*x0 + 3*u*u*t*c[0] + 3*u*t*t*c[2] + t**3*c[4]
            y = u**3*y0 + 3*u*u*t*c[1] + 3*u*t*t*c[3] + t**3*c[5]
            out.append((x, y))
        x0, y0 = c[4], c[5]
    return out

def inside(poly, x, y):
    c = False; j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]; xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            c = not c
        j = i
    return c

def dist_to_poly(poly, x, y):
    return min(math.hypot(px - x, py - y) for px, py in poly)

cer, cbl = flatten(CEREBRUM), flatten(CEREBELLUM)
rng = random.Random(7)
nodes = []
for _ in range(20000):
    if len(nodes) >= 30: break
    x, y = rng.uniform(10, 92), rng.uniform(9, 84)
    ok = (inside(cer, x, y) and dist_to_poly(cer, x, y) > 4.5) or (inside(cbl, x, y) and dist_to_poly(cbl, x, y) > 3.5)
    if ok and all(math.hypot(x - a, y - b) > 10 for a, b, _ in nodes):
        nodes.append((x, y, rng.choice([1.6, 2.0, 2.4, 3.0])))

# edges: each node to its 2 nearest, plus a few long "fibers"
edges = set()
for i, (x, y, _) in enumerate(nodes):
    near = sorted(range(len(nodes)), key=lambda j: math.hypot(nodes[j][0] - x, nodes[j][1] - y))[1:3]
    for j in near: edges.add(tuple(sorted((i, j))))
for _ in range(5):
    i, j = rng.sample(range(len(nodes)), 2)
    if math.hypot(nodes[i][0] - nodes[j][0], nodes[i][1] - nodes[j][1]) > 30: edges.add(tuple(sorted((i, j))))

STOPS = [(0.0, (143, 123, 255)), (0.5, (41, 211, 230)), (1.0, (255, 77, 141))]
def color(x):
    t = min(1, max(0, (x - 12) / 80))
    for (t0, c0), (t1, c1) in zip(STOPS, STOPS[1:]):
        if t <= t1:
            k = (t - t0) / (t1 - t0)
            return "#%02x%02x%02x" % tuple(round(a + (b - a) * k) for a, b in zip(c0, c1))
    return "#ff4d8d"

def mark(uid, bg=True):
    """Inner <g> of the mark in a 0..100 box."""
    lines = "".join(
        f'<path d="M{nodes[i][0]:.1f},{nodes[i][1]:.1f} Q{(nodes[i][0]+nodes[j][0])/2+ (50-(nodes[i][0]+nodes[j][0])/2)*0.25:.1f},{(nodes[i][1]+nodes[j][1])/2 + (45-(nodes[i][1]+nodes[j][1])/2)*0.25:.1f} {nodes[j][0]:.1f},{nodes[j][1]:.1f}" stroke="{color((nodes[i][0]+nodes[j][0])/2)}"/>'
        for i, j in sorted(edges))
    dots = "".join(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="{color(x)}"/>' for x, y, r in nodes)
    cores = "".join(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r*0.45:.2f}" fill="#fff"/>' for x, y, r in nodes if r >= 2.4)
    back = (f'<rect width="100" height="100" rx="22" fill="url(#bg{uid})"/>' if bg else "")
    return f'''<defs>
    <radialGradient id="bg{uid}" cx="55%" cy="42%" r="70%"><stop offset="0" stop-color="#1c1a4a"/><stop offset="1" stop-color="#070918"/></radialGradient>
    <linearGradient id="rim{uid}" x1="0" x2="1"><stop offset="0" stop-color="#8f7bff"/><stop offset=".5" stop-color="#29d3e6"/><stop offset="1" stop-color="#ff4d8d"/></linearGradient>
    <filter id="glow{uid}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  {back}
  <g transform="translate(4 3) scale(0.92)">
    <g fill="none" stroke="url(#rim{uid})" stroke-width="2.2" stroke-linejoin="round" opacity=".95" filter="url(#glow{uid})">
      <path d="{path_d(CEREBRUM)}"/><path d="{path_d(CEREBELLUM)}"/><path d="{path_d(STEM)}"/>
    </g>
    <g fill="none" stroke-width=".9" opacity=".75">{lines}</g>
    <g filter="url(#glow{uid})">{dots}</g>
    {cores}
  </g>'''

def svg(w, h, body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">{body}</svg>\n'

(OUT / "logo-mark.svg").write_text(svg(100, 100, mark("m")))
PUB.joinpath("favicon.svg").write_text(svg(100, 100, mark("f")))

def lockup(text_color, sub_color, uid):
    return svg(520, 120, f'''<g transform="translate(10 10)"><svg width="100" height="100" viewBox="0 0 100 100">{mark(uid)}</svg></g>
  <text x="132" y="66" font-family="Inter, Segoe UI, Helvetica, Arial, sans-serif" font-size="46" font-weight="800" letter-spacing="3" fill="{text_color}">NEURAL<tspan fill="url(#word{uid})"> BRAIN</tspan></text>
  <text x="134" y="96" font-family="Inter, Segoe UI, Helvetica, Arial, sans-serif" font-size="17" font-weight="500" letter-spacing="4.5" fill="{sub_color}">EL CEREBRO DE TU AGENTE</text>
  <defs><linearGradient id="word{uid}" x1="0" x2="1"><stop offset="0" stop-color="#8f7bff"/><stop offset=".55" stop-color="#29d3e6"/><stop offset="1" stop-color="#ff4d8d"/></linearGradient></defs>''')

(OUT / "logo-dark.svg").write_text(lockup("#f2f4ff", "#9aa3c7", "d"))   # for dark backgrounds
(OUT / "logo-light.svg").write_text(lockup("#12152b", "#5b6283", "l"))  # for light backgrounds
print(len(nodes), "nodes", len(edges), "edges")
