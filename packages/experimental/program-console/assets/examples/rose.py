"""Draw a mathematical rose in the terminal."""
import math

W, H = 79, 41
DXR = 2.6 / W
DYR = 2 * DXR
TOP = H * DYR / 2

K = 2.5                          # |cos(K*theta)| has 2K = 5 petals
CX, CY, R = 0.0, 0.42, 0.86

RED = [88, 124, 160, 196, 203, 210, 217]      # outer whorl: dark base -> pink tip
DEEP = [52, 88, 124, 160, 196]                # inner whorl: shadowed
GREEN = [22, 28, 34, 40, 46]
YELLOW = [184, 220, 226]

RESET = "\x1b[0m"
grid = [[(" ", None)] * W for _ in range(H)]


def put(i, j, ch, color):
    if 0 <= i < W and 0 <= j < H:
        grid[j][i] = (ch, color)


def petal_t(x, y, cx, cy, rmax, rot=0.0):
    dx, dy = x - cx, y - cy
    if rot:
        c, s = math.cos(rot), math.sin(rot)
        dx, dy = dx * c + dy * s, -dx * s + dy * c
    r = math.hypot(dx, dy)
    if r <= rmax * abs(math.cos(K * math.atan2(dy, dx))):
        return min(1.0, r / rmax)
    return None


def paint(fn, ch, palette):
    for j in range(H):
        y = TOP - (j + 0.5) * DYR
        for i in range(W):
            x = -W * DXR / 2 + (i + 0.5) * DXR
            t = fn(x, y)
            if t is not None:
                put(i, j, ch, palette[min(len(palette) - 1, int(t * len(palette)))])


def col(x):
    return int((x + W * DXR / 2) / DXR)


LEAVES = ((-0.50, -0.76, 0.36, 0.13, -0.55), (0.46, -1.10, 0.32, 0.12, 0.55))

# stem
for j in range(H):
    y = TOP - (j + 0.5) * DYR
    if -TOP <= y <= -0.34:
        put(col(0.09 * math.sin(4.4 * (y + TOP))), j, "\u2588", 28)

# leaves: dithered blade with a brighter midrib
for lx, ly, a, b, ang in LEAVES:
    for j in range(H):
        y = TOP - (j + 0.5) * DYR
        for i in range(W):
            x = -W * DXR / 2 + (i + 0.5) * DXR
            u0, v0 = x - lx, y - ly
            c, s = math.cos(ang), math.sin(ang)
            u, v = u0 * c + v0 * s, -u0 * s + v0 * c
            q = (u / a) ** 2 + (v / b) ** 2
            if q <= 1.0:
                if abs(v) / b < 0.22:
                    put(i, j, "\u2588", 46)
                else:
                    t = q ** 0.5
                    put(i, j, "\u2592", GREEN[min(len(GREEN) - 1, int(t * len(GREEN)))])

# sepals cupping the bloom
for sx, sy, sa, sb, sang in ((-0.17, -0.40, 0.17, 0.045, 0.65),
                             (0.17, -0.40, 0.17, 0.045, -0.65)):
    for j in range(H):
        y = TOP - (j + 0.5) * DYR
        for i in range(W):
            x = -W * DXR / 2 + (i + 0.5) * DXR
            u0, v0 = x - sx, y - sy
            c, s = math.cos(sang), math.sin(sang)
            u, v = u0 * c + v0 * s, -u0 * s + v0 * c
            if (u / sa) ** 2 + (v / sb) ** 2 <= 1.0:
                put(i, j, "\u2592", 40)

# layered whorls of petals
paint(lambda x, y: petal_t(x, y, CX, CY, R, rot=math.pi / 5), "\u2588", RED)
paint(lambda x, y: petal_t(x, y, CX, CY, R * 0.66), "\u2593", DEEP)

# yellow heart
for j in range(H):
    y = TOP - (j + 0.5) * DYR
    for i in range(W):
        x = -W * DXR / 2 + (i + 0.5) * DXR
        r = math.hypot(x - CX, y - CY)
        if r <= 0.042:
            put(i, j, "\u2588", 226)
        elif r <= 0.070:
            put(i, j, "\u2593", 220)

def line_text(cells):
    """Serialise one row, trimming blanks and emitting colour only on change."""
    cells = list(cells)
    while cells and cells[-1][0] == " " and cells[-1][1] is None:
        cells.pop()
    out, cur = [], None
    for ch, c in cells:
        if c != cur:
            out.append(RESET if c is None else f"\x1b[38;5;{c}m")
            cur = c
        out.append(ch)
    if cur is not None:
        out.append(RESET)
    return "".join(out)


rows = [line_text(row) for row in grid]

print()
print("\n".join(rows))
print("\x1b[1m\x1b[38;5;204m   r(\u03b8) = cos(5\u03b8/2)  \u00b7  five petals, two whorls" + RESET)
