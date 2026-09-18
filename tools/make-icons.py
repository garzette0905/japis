#!/usr/bin/env python3
"""JAPIS 아이콘 굽기 — web/public/favicon.svg 와 **같은 좌표**로 png 를 만든다.

    python3 tools/make-icons.py        # 설치할 것이 없다(표준 라이브러리만 쓴다)

왜 손으로 그린 png 를 두지 않는가: 아이콘은 네 장이다(192·512·apple-touch·og).
한 장을 고치고 나머지를 잊으면 탭·홈화면·공유카드에 서로 다른 그림이 서고, 그것을
눈으로 알아채는 데는 몇 주가 걸린다. 그래서 **좌표는 한 벌**로 두고 여기서 굽는다.

왜 Pillow·rsvg 를 쓰지 않는가: 이 저장소에는 **빌드 단계가 없다**(README 의 규칙).
그림 한 장 고치려고 라이브러리를 깔아야 한다면, 몇 달 뒤 고치려는 사람 앞에는
"먼저 이걸 설치하세요"가 먼저 선다. 우리가 그리는 것은 네모·동그라미·반고리
다섯 덩어리뿐이고, 그건 zlib 하나로 충분하다.

고치는 곳은 favicon.svg 와 아래 MARK/PLATE/INK 뿐이다. 둘은 같은 512칸 좌표계를
쓴다 — svg 를 고치면 여기도 같이 고친다.
"""

import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / 'web' / 'public'

# 판(바탕)과 글씨의 그라디에이션. favicon.svg 의 <linearGradient> 와 같은 값이다.
#   판   : 왼위 → 오른아래
#   글씨 : 오른위 → 왼아래 (판과 **반대 방향**이어야 글씨가 판에서 떠 보인다)
PLATE = [(0.00, (0x24, 0x50, 0xF2)), (0.55, (0x0F, 0x31, 0xC8)), (1.00, (0x06, 0x1A, 0x97))]
INK = [(0.00, (0xFF, 0xFF, 0xFF)), (1.00, (0xB3, 0xCD, 0xFA))]

# J 의 제자리 중심과, 512칸 안에서 얼마로 줄여 세우는지.
#   0.86 배 → J 의 키가 402*0.86 = 346 (판의 68%). 나머지는 여백으로 남는다.
MARK_CENTER = (257.0, 255.0)
MARK_SCALE = 0.86
# J 의 테두리 상자(512칸 좌표). 글씨 그라디에이션이 흐르는 자리다.
MARK_BOX = (107.0, 54.0, 407.0, 456.0)

SUB = 8        # 한 픽셀을 세로로 몇 줄로 쪼개 볼지(톱니를 지우는 곳)


# ──────────────────────────────────────────────────────────────────────────
# ① 모양 — 전부 **닫힌 여러모꼴**로 만든다
#
# 동그라미도 반고리도 잘게 쪼개면 여러모꼴이다. 모양이 한 가지면 칠하는 코드도
# 한 가지면 된다(아래 fill 하나). 짝홀(even-odd) 규칙으로 칠하므로, 반고리처럼
# 속이 빈 것도 겉을 돌고 속을 되돌아오는 **한 줄**로 적을 수 있다.
# ──────────────────────────────────────────────────────────────────────────


def arc(cx, cy, r, a0, a1, steps):
    """도 단위 a0 → a1 호. y 는 아래로 자라는 화면 좌표다(svg 와 같다)."""
    return [
        (cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / steps)),
         cy + r * math.sin(math.radians(a0 + (a1 - a0) * i / steps)))
        for i in range(steps + 1)
    ]


def rect(x, y, w, h):
    return [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]


def rrect(x, y, w, h, r):
    """모서리를 깎은 네모. r 이 0 이면 그냥 네모다."""
    r = min(r, w / 2, h / 2)
    if r <= 0:
        return rect(x, y, w, h)
    x1, y1 = x + w, y + h
    return (
        arc(x1 - r, y + r, r, -90, 0, 12)        # 오른위
        + arc(x1 - r, y1 - r, r, 0, 90, 12)      # 오른아래
        + arc(x + r, y1 - r, r, 90, 180, 12)     # 왼아래
        + arc(x + r, y + r, r, 180, 270, 12)     # 왼위
    )


def circle(cx, cy, r, steps=96):
    return arc(cx, cy, r, 0, 360, steps)[:-1]


def half_ring(cx, cy, r_out, r_in):
    """아래쪽 반고리. svg 의 `M407 306 A150 … L199 306 A58 … Z` 가 이것이다.

    겉을 왼쪽으로 돌고 속을 오른쪽으로 되돌아오는 **한 줄**이다 — 짝홀 규칙이
    한 줄 안에서 겉과 속을 스스로 가려내므로 따로 파낼 필요가 없다.
    """
    return arc(cx, cy, r_out, 0, 180, 72) + arc(cx, cy, r_in, 180, 0, 72)


# ──────────────────────────────────────────────────────────────────────────
# ② 칠하기 — 가로는 자로 재고, 세로만 쪼갠다
#
# 한 픽셀을 16칸으로 쪼개 세어 보는 흔한 방법은 가로·세로 둘 다 어림한다.
# 여기서는 **가로는 어림하지 않는다** — 한 줄에서 모양이 차지하는 구간의 양 끝은
# 소수점까지 정확히 알 수 있으므로 그대로 더한다. 세로만 여덟 줄로 쪼갠다.
# 같은 품이 들고 테두리가 더 곱다.
# ──────────────────────────────────────────────────────────────────────────


def fill(cov, w, h, polys):
    """여러모꼴을 하나하나 칠해 cov 에 **합친다**(겹친 자리는 큰 쪽).

    규칙이 두 겹이다.
      · 한 덩어리 **안**에서는 짝홀(even-odd)이다 — 반고리가 겉을 돌고 속을
        되돌아오는 한 줄로 적히는 것이 그 덕이다.
      · 덩어리 **끼리**는 짝홀로 세지 않는다. 가로대와 기둥처럼 겹쳐 놓은 둘을
        한 번에 세면 겹친 자리가 서로를 지워 구멍이 뚫린다(실제로 그랬다 —
        J 가 조각조각 났다).

    ⚠️ 겹친 자리를 **더하지** 않는 이유: 가로대와 기둥은 위 테두리(y=54)가 같은
       줄에 있다. 더하면 그 줄만 덮임 정도가 두 배가 되어 1에서 끊기고, 기둥이
       선 구간만 테두리가 반 픽셀 위로 삐져 나가 **가느다란 밝은 줄**이 그어진다
       (실제로 그랬다 — 가로대 오른쪽 위에 줄이 하나 났다).

       그래서 큰 쪽만 남긴다. 대신 두 덩어리가 **맞닿기만** 하는 자리는 좌표에서
       미리 겹쳐 둔다 — 기둥의 키가 252 가 아니라 254 인 것이 그 때문이다
       (맞닿으면 둘이 각각 반 픽셀씩 덮어 그 줄이 반투명하게 남는다).
    """
    for pts in polys:
        edges = []
        for i in range(len(pts)):
            (ax, ay), (bx, by) = pts[i], pts[(i + 1) % len(pts)]
            if ay == by:
                continue                                  # 가로줄은 만나지 않는다
            edges.append((min(ay, by), max(ay, by), ax, (bx - ax) / (by - ay), ay))
        if not edges:
            continue

        y_lo = max(0, int(math.floor(min(e[0] for e in edges))))
        y_hi = min(h - 1, int(math.ceil(max(e[1] for e in edges))))
        part = 1.0 / SUB

        for py in range(y_lo, y_hi + 1):
            acc = {}
            for sub in range(SUB):
                ys = py + (sub + 0.5) / SUB
                xs = sorted(ax + slope * (ys - ay0) for ylo, yhi, ax, slope, ay0 in edges if ylo <= ys < yhi)
                for i in range(0, len(xs) - 1, 2):
                    xa, xb = xs[i], xs[i + 1]
                    if xb <= 0 or xa >= w:
                        continue
                    xa, xb = max(xa, 0.0), min(xb, float(w))
                    for px in range(int(xa), min(int(math.ceil(xb)), w)):
                        overlap = min(xb, px + 1) - max(xa, px)
                        if overlap > 0:
                            acc[px] = acc.get(px, 0.0) + overlap * part
            row = cov[py]
            for px, v in acc.items():
                if v > row[px]:
                    row[px] = 1.0 if v > 1.0 else v


def subtract(a, b, w, h):
    """a 에서 b 를 파낸다(종이에서 글줄을 파내는 자리)."""
    for y in range(h):
        ra, rb = a[y], b[y]
        for x in range(w):
            if rb[x]:
                ra[x] = max(0.0, ra[x] - rb[x])


def blank(w, h):
    return [[0.0] * w for _ in range(h)]


# ──────────────────────────────────────────────────────────────────────────
# ③ 색과 파일
# ──────────────────────────────────────────────────────────────────────────


def ramp(stops, t):
    """0~1 을 색 하나로. stop 사이를 곧게 잇는다(svg 와 같다)."""
    t = 0.0 if t < 0 else 1.0 if t > 1 else t
    for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
        if t <= p1:
            u = 0.0 if p1 == p0 else (t - p0) / (p1 - p0)
            return tuple(int(round(c0[i] + (c1[i] - c0[i]) * u)) for i in range(3))
    return stops[-1][1]


def gradient(w, h, stops, start, end):
    """start(x,y) 에서 end(x,y) 로 흐르는 선형 그라디에이션. 좌표는 픽셀이다.

    ⚠️ 흐르는 자리는 **그림의 테두리 상자**로 잡는다. 판은 판 전체, 글씨는 J 의
       상자다 — og 카드(1200x630)처럼 판이 넓은 곳에서 글씨까지 판 기준으로
       흐르게 하면, 글씨가 놓인 가운데 토막에서는 색이 거의 변하지 않아
       그라디에이션이 **사라져 보인다**(실제로 그랬다).
    """
    x0, y0 = start
    dx, dy = end[0] - x0, end[1] - y0
    denom = dx * dx + dy * dy or 1.0
    # 같은 t 는 같은 색이다 — 256 칸으로 미리 구워 두면 픽셀마다 계산하지 않는다.
    table = [ramp(stops, i / 255.0) for i in range(256)]
    rows = []
    for y in range(h):
        base = (y + 0.5 - y0) * dy
        row = []
        for x in range(w):
            t = ((x + 0.5 - x0) * dx + base) / denom
            row.append(table[0 if t < 0 else 255 if t > 1 else int(t * 255 + 0.5)])
        rows.append(row)
    return rows


def write_png(path, w, h, pixels):
    """RGBA png 한 장. 줄마다 필터 0(그대로)으로 적고 zlib 으로 묶는다."""
    raw = bytearray()
    for row in pixels:
        raw.append(0)
        for r, g, b, a in row:
            raw += bytes((r, g, b, a))

    def chunk(tag, data):
        body = tag + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xFFFFFFFF)

    png = (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
        + chunk(b'IEND', b'')
    )
    path.write_bytes(png)
    print(f'  {path.name}  {w}x{h}  {len(png) / 1024:.1f}KB')


def compose(path, w, h, plate_cov, ink_cov, ink_span):
    """판 위에 글씨를 얹어 한 장으로 굽는다."""
    plate_rgb = gradient(w, h, PLATE, (0, 0), (w, h))
    ink_rgb = gradient(w, h, INK, ink_span[0], ink_span[1])

    pixels = []
    for y in range(h):
        row = []
        for x in range(w):
            pa = min(1.0, plate_cov[y][x])
            ia = min(1.0, ink_cov[y][x])
            pr, pg, pb = plate_rgb[y][x]
            if ia > 0:
                ir, ig, ib = ink_rgb[y][x]
                # 글씨를 판 위에 올린다. 판이 없는 자리(테두리 밖)에서도 글씨가
                # 스스로 서야 하므로 알파는 둘 중 큰 쪽이다.
                r = int(round(pr * (1 - ia) + ir * ia))
                g = int(round(pg * (1 - ia) + ig * ia))
                b = int(round(pb * (1 - ia) + ib * ia))
                row.append((r, g, b, int(round(max(pa, ia) * 255))))
            else:
                row.append((pr, pg, pb, int(round(pa * 255))))
        pixels.append(row)
    write_png(path, w, h, pixels)


# ──────────────────────────────────────────────────────────────────────────
# ④ 앱 아이콘 — 파란 판 위의 J
# ──────────────────────────────────────────────────────────────────────────


def bake(path, w, h, radius, scale, center=None):
    center = center or (w / 2, h / 2)

    def P(x, y):
        """512칸 좌표 → 이 판의 픽셀 좌표"""
        return (center[0] + scale * (x - MARK_CENTER[0]), center[1] + scale * (y - MARK_CENTER[1]))

    def box(x, y, bw, bh):
        x0, y0 = P(x, y)
        x1, y1 = P(x + bw, y + bh)
        return (x0, y0, x1 - x0, y1 - y0)

    plate = blank(w, h)
    fill(plate, w, h, [rrect(0, 0, w, h, radius)])

    ink = blank(w, h)
    cx, cy = P(257, 306)
    fill(ink, w, h, [
        half_ring(cx, cy, 150 * scale, 58 * scale),              # 아래 고리
        circle(*P(153, 306), 46 * scale),                        # 고리 왼쪽 끝을 막는 구슬
        rrect(*box(150, 54, 257, 92), 46 * scale),               # 위 가로대(알약)
        rect(*box(315, 54, 92, 254)),                            # 오른쪽 기둥(고리 속으로 두 칸)
        circle(*P(257, 296), 40 * scale),                        # 고리 안의 구슬
    ])

    bx0, by0, bx1, by1 = MARK_BOX
    compose(path, w, h, plate, ink, (P(bx1, by0), P(bx0, by1)))   # 글씨는 오른위 → 왼아래


# ──────────────────────────────────────────────────────────────────────────
# ⑤ 바로가기 아이콘 — 안드로이드 홈화면에 **한 화면씩** 세우는 것들
#
# 안드로이드에는 PWA 가 쓸 수 있는 위젯 API 가 없다(자세한 사정은 README 참고).
# 대신 manifest 의 shortcuts 가 있다 — 앱 아이콘을 길게 누르면 뜨는 목록이고,
# 그 한 줄을 끌어다 홈화면에 놓으면 그 화면으로 바로 들어가는 아이콘이 선다.
# 런처가 아이콘을 동그랗게 잘라내므로 **판은 모서리를 깎지 않고**(radius 0)
# 그림은 가운데 70% 안에 둔다.
#
# 넷은 한 벌로 읽혀야 한다 — 판은 모두 같은 파란 판이고 안의 덩어리만 다르다
# (런처가 이름표를 같이 보여 주므로 색까지 다르게 할 이유가 없다).
# ──────────────────────────────────────────────────────────────────────────


def glyph_dashboard(u):
    """대시보드 — 칸 넷(카드가 늘어선 화면)"""
    return [rrect(gx * u, gy * u, 16 * u, 16 * u, 5 * u)
            for gx, gy in ((28, 28), (52, 28), (28, 52), (52, 52))], []


def glyph_bookmark(u):
    """북마크 — 아래가 갈라진 띠"""
    pts = [(32, 24), (64, 24), (64, 72), (48, 60), (32, 72)]
    return [[(x * u, y * u) for x, y in pts]], []


def glyph_note(u):
    """Jaden wiki — 종이 한 장과 적어 둔 줄 셋(줄은 종이에서 파낸다)"""
    page = [rrect(28 * u, 22 * u, 40 * u, 52 * u, 6 * u)]
    lines = [rrect(36 * u, (34 + i * 12) * u, wd * u, 5 * u, 2.5 * u)
             for i, wd in enumerate((22, 22, 13))]
    return page, lines


def glyph_music(u):
    """Play Lists — 이어 붙인 음표 둘"""
    return [
        circle(35 * u, 65 * u, 9 * u),                                   # 왼쪽 음표 머리
        circle(61 * u, 59 * u, 9 * u),                                   # 오른쪽 음표 머리
        rect(38 * u, 26 * u, 6 * u, 40 * u),                             # 왼쪽 기둥
        rect(64 * u, 22 * u, 6 * u, 38 * u),                             # 오른쪽 기둥
        [(38 * u, 26 * u), (70 * u, 22 * u), (70 * u, 34 * u), (38 * u, 38 * u)],   # 잇는 띠
    ], []


SHORTCUTS = [
    ('shortcut-dashboard.png', glyph_dashboard),
    ('shortcut-bookmarks.png', glyph_bookmark),
    ('shortcut-wiki.png', glyph_note),
    ('shortcut-playlists.png', glyph_music),
]


def bake_shortcut(path, glyph, size=96):
    u = size / 96.0
    plate = blank(size, size)
    fill(plate, size, size, [rect(0, 0, size, size)])

    add, cut = glyph(u)
    ink = blank(size, size)
    fill(ink, size, size, add)
    if cut:
        hole = blank(size, size)
        fill(hole, size, size, cut)
        subtract(ink, hole, size, size)

    # 그림은 24~74 칸 사이에 산다 — 그 상자를 그라디에이션이 흐르는 자리로 쓴다.
    compose(path, size, size, plate, ink, ((74 * u, 22 * u), (26 * u, 74 * u)))


def main():
    print('JAPIS 아이콘을 굽습니다 →', OUT)
    # 512칸 원본. 라운드 반지름 115 도 svg 와 같다.
    bake(OUT / 'icon-512.png', 512, 512, 115, MARK_SCALE)
    bake(OUT / 'icon-192.png', 192, 192, 115 * 192 / 512, MARK_SCALE * 192 / 512)
    # apple-touch-icon 은 **모서리를 깎지 않는다** — iOS 가 알아서 깎는다.
    #   (manifest 의 maskable 로도 이 장을 쓰므로 글씨가 안전지대 안에 있어야 한다)
    bake(OUT / 'apple-touch-icon.png', 180, 180, 0, MARK_SCALE * 180 / 512)
    # 공유 카드. 넓은 판 가운데에 같은 마크 하나만 세운다(글자는 넣지 않는다 —
    # 카드 제목이 이미 'JAPIS' 라 같은 말을 두 번 적을 이유가 없다).
    bake(OUT / 'og-japis.png', 1200, 630, 0, MARK_SCALE * 0.771 * 630 / 512)
    # 홈화면 바로가기(manifest.json 의 shortcuts)
    for name, glyph in SHORTCUTS:
        bake_shortcut(OUT / name, glyph)
    print('끝. favicon.svg 와 같은 좌표입니다.')


if __name__ == '__main__':
    main()
