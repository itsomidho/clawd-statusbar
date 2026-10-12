"""Render docs/clawd.gif: the bar through one turn, Clawd frying an egg.

The poses follow mascot() and caption() in hooks/register.tsx: same glyphs,
colours and tick (150 ms); the turn thinks, reads, edits, runs a command,
browses, hands work to a background agent and waits on it after the main
turn ends. The long stretches are time-lapsed. Needs Pillow
and the DejaVu fonts (paths below are Debian/Ubuntu).

    python3 docs/clawd_gif.py docs/clawd.gif
"""
import sys
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1]
MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
WIDE = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"   # for ⎇ only
SIZE = 22

BG = (30, 30, 34)
TEXT = (220, 220, 220)
DIM = (120, 120, 128)
BORDER = (90, 90, 98)
CLAUDE = (215, 119, 87)
YELLOW = (229, 192, 123)
GREEN = (120, 200, 120)
RED = (224, 108, 117)
CYAN = (86, 182, 194)
BLUE = (97, 175, 239)
MAGENTA = (198, 120, 221)
FACE = (20, 20, 22)
# The theme's own colours the poses name.
SUGGESTION = (177, 185, 249)
IDE = (71, 150, 228)
MERGED = (175, 135, 255)
WARNING = (255, 193, 7)

mono = ImageFont.truetype(MONO, SIZE)
asc, desc = mono.getmetrics()
CW = round(mono.getlength("M"))
CH = asc + desc
# Block elements drawn as the terminal does: exact quarters of the cell.
QUARTERS = {"█": "1111", "▌": "1010", "▐": "0101", "▘": "1000", "▝": "0100", "▖": "0010",
            "▗": "0001", "▛": "1110", "▜": "1101", "▙": "1011", "▟": "0111", "▀": "1100", "▄": "0011"}
wide = ImageFont.truetype(WIDE, SIZE)
while wide.getlength("⎇") > CW:
    wide = ImageFont.truetype(WIDE, wide.size - 1)

SIZZLE = ["~·~", "·~·", "~ ~", " ~ "]


def yolk(tick):
    ms = (tick - tick % 2) * 150
    return "●" if ms >= 30_000 else "◉" if ms >= 10_000 else "o"


SPIN = "◜◝◞◟"
GLOBE = "◐◓◑◒"
CAPTIONS = {"thinking": "thinking", "reading": "reading", "editing": "editing", "running": "running",
            "browsing": "browsing", "delegating": "spawning", "asking": "asking", "waiting": "waiting",
            "working": "cooking"}


def loop(tick, every, frames):
    return frames[(tick // every) % len(frames)]


# Clawd as figure() draws him: the welcome screen's grid, 17 wide and 5 tall,
# two of its cells to a quarter-block cell, so three rows of nine cells.
BODY = "..#############.."
GLYPHS = " ▗▖▄▝▐▞▟▘▚▌▙▀▜▛█"   # by quarters: TL 8, TR 4, BL 2, BR 1
EYES = {"open": (1, (4, 12)), "shut": (1, ()), "wide": (0, (4, 12)),
        "left": (1, (3, 11)), "right": (1, (5, 13)), "down": (2, (4, 12))}


def blocks(grid):
    at = lambda r, c: 1 if r < len(grid) and c < len(grid[r]) and grid[r][c] == "#" else 0
    return ["".join(GLYPHS[at(r, c) * 8 + at(r, c + 1) * 4 + at(r + 1, c) * 2 + at(r + 1, c + 1)]
                    for c in range(0, 18, 2)) for r in (0, 2, 4)]


def figure(eyes, left, right, step=False):
    """His three rows: eye holes cut, a raised arm moved up a row, legs stepped."""
    rows = [list(BODY), list(BODY), list("#" * 17), list(BODY), list("." * 17)]
    row, cols = EYES[eyes]
    for c in cols:
        rows[row][c] = "."
        if eyes == "wide":
            rows[1][c] = "."
    for side, start in ((left, 0), (right, 15)):
        if side:
            rows[2][start] = rows[2][start + 1] = "."
            rows[1][start] = rows[1][start + 1] = "#"
    for c in ((3, 5, 11, 13) if step else (2, 4, 12, 14)):
        rows[4][c] = "#"
    return blocks(["".join(r) for r in rows])


def mascot(working, tick, blink, served, doing=None, agents=0):
    """(three rows of him, top, steam, steam colour, yolk) as mascot() draws them."""
    eyes = lambda open="open": "shut" if blink else open
    glance = lambda: eyes(loop(tick, 8, ["open", "left", "open", "right"]))
    if working:
        if tick < 4:
            high = tick < 2
            return figure(eyes("wide"), False, True), " o " if high else "   ", "   " if high else " o ", CLAUDE, "_"
        y = yolk(tick)
        if doing == "thinking":
            return figure(glance(), False, False), "   ", loop(tick, 4, ["   ", "·  ", "·· ", "···"]), CLAUDE, y
        if doing == "reading":
            return figure(eyes(), False, True), "   ", loop(tick, 4, ["≡  ", " ≡ ", "  ≡", " ≡ "]), SUGGESTION, y
        if doing == "running":
            return figure(eyes(), True, False, loop(tick, 2, [False, True])), "   ", loop(tick, 4, [">_ ", ">  "]), GREEN, y
        if doing == "browsing":
            return figure(eyes(), False, True), "   ", f" {loop(tick, 2, GLOBE)} ", IDE, y
        if doing in ("delegating", "waiting"):
            count = "  " if agents == 0 else "9+" if agents > 9 else f"×{agents}"
            return figure(glance(), False, False, loop(tick, 4, [False, True])), "   ", loop(tick, 2, SPIN) + count, MERGED, y
        if doing == "asking":
            return figure(eyes("wide"), True, True), "   ", loop(tick, 4, [" ! ", "   "]), WARNING, y
        left = (tick // 4) % 2 == 0
        return figure(eyes(), left, not left), "   ", loop(tick, 2, SIZZLE), CLAUDE, y
    if served:
        mark, y = served
        done = mark == "✓"
        return figure(eyes() if done else "down", False, done), "   ", f" {mark} ", GREEN if done else RED, y
    return figure(eyes(), False, False), "   ", "   ", CLAUDE, "_"


def caption(working, doing, tool, agents):
    if not working:
        return "", ""
    count = f"{agents} agent{'' if agents == 1 else 's'}" if agents else ""
    return CAPTIONS.get(doing or "working", ""), count or tool


BOX = 85              # the frame's width in cells, on a 91-column terminal
INNER = BOX - 4       # less border and padding
MASCOT = 13
CAPTION = 8
GAP = 2
INDENT = 2
COLS = INDENT + BOX + 2
ROWS = 6
PAD = 18


def parts_line(parts):
    """[(text, colour)] joined by a dim ' · '."""
    out = []
    for i, (t, c) in enumerate(parts):
        if i:
            out.append((" · ", DIM))
        out.append((t, c))
    return out


def frame(working, tick, blink, served, ctx, dirty, review, doing=None, tool="", agents=0, main=None):
    (head, figure_body, legs), top, steam, steam_c, y = mascot(working, tick, blink, served, doing, agents)
    word, detail = (part[:CAPTION] for part in caption(working, doing, tool, agents))
    main = working if main is None else main
    figures = parts_line([("◆ Opus 5.5", CYAN), (f"CTX {ctx}% {ctx * 10}k", DIM),
                          ("5h 18% ↻ 2h 14m", DIM)])
    project = [("~/code/shop", BLUE), ("⎇ feature/cart", MAGENTA), (f"●{dirty}", YELLOW), ("↑2", GREEN)]
    if review:
        project.append(review)
    project = parts_line(project)

    room = INNER - MASCOT - GAP - CAPTION - GAP
    rows = []
    hint = "esc to interrupt" if main else "? for shortcuts"
    rows.append([(" " * INDENT + hint, DIM)])
    rows.append([(" " * INDENT + "╭" + "─" * (BOX - 2) + "╮", BORDER)])

    def body(line, words, m):
        used = sum(len(part[0]) for part in line)
        return ([(" " * INDENT + "│ ", BORDER)] + line + [(" " * (room - used + GAP), TEXT)]
                + words + [(" " * GAP, TEXT)] + m + [(" │", BORDER)])

    rows.append(body(figures, [(word.rjust(CAPTION), steam_c)], [(head, CLAUDE), (" " + top, steam_c)]))
    rows.append(body(project, [(detail.rjust(CAPTION), DIM)], [(figure_body, CLAUDE), (" " + steam, steam_c)]))
    pan = [(" \\", DIM), ("_" if y == "_" else y, DIM if y == "_" else YELLOW), ("/", DIM)]
    rows.append(body([], [(" " * CAPTION, TEXT)], [(legs, CLAUDE)] + pan))
    rows.append([(" " * INDENT + "╰" + "─" * (BOX - 2) + "╯", BORDER)])

    img = Image.new("RGB", (COLS * CW + 2 * PAD, ROWS * CH + 2 * PAD), BG)
    draw = ImageDraw.Draw(img)
    for r, line in enumerate(rows):
        col = 0
        for text, colour, *back in line:
            for ch in text:
                x, base = PAD + col * CW, PAD + r * CH + asc
                top = PAD + r * CH
                if back:
                    draw.rectangle([x, top, x + CW - 1, top + CH - 1], fill=back[0])
                if ch in QUARTERS:
                    hw, hh = CW / 2, CH / 2
                    for q, on in enumerate(QUARTERS[ch]):
                        if on == "1":
                            qx, qy = x + (q % 2) * hw, top + (q // 2) * hh
                            draw.rectangle([round(qx), round(qy), round(qx + hw) - 1, round(qy + hh) - 1], fill=colour)
                elif ch != " ":
                    draw.text((x, base), ch, font=wide if ch == "⎇" else mono, fill=colour, anchor="ls")
                col += 1
    return img


frames, durations = [], []


def add(ms, **kw):
    frames.append(frame(**kw))
    durations.append(ms)


idle = dict(working=False, tick=0, served=None, ctx=5, dirty=3, review=None)
add(900, blink=False, **idle)
add(160, blink=True, **idle)
add(700, blink=False, **idle)

# The turn: crack, then each kind of work, the yolk setting as it runs long.
busy = dict(blink=False, served=None, dirty=4, review=("CI ◔", YELLOW))
tick = 0
for count, ctx, doing, tool, agents, main in [
    (10, 6, "thinking", "", 0, True),
    (12, 7, "reading", "Grep", 0, True),
    (12, 8, "editing", "Edit", 0, True),
    (12, 9, "running", "Bash", 0, True),
    (12, 10, "browsing", "WebFetch", 0, True),
    (12, 11, "delegating", "Agent", 1, True),
    # The main turn is over; Clawd keeps going while the background agent works.
    (16, 11, "waiting", "", 1, False),
    (12, 12, "reading", "Read", 1, False),
]:
    for _ in range(count):
        add(150, working=True, tick=tick, ctx=ctx, doing=doing, tool=tool, agents=agents, main=main, **busy)
        tick += 1
    # Time-lapse: the yolk sets over the long stretches between.
    tick += 25

done = dict(working=False, tick=0, ctx=11, dirty=5, review=("!171 ✓", GREEN))
add(2000, blink=False, served=("✓", "●"), **done)
add(900, blink=False, served=None, **done)
add(160, blink=True, served=None, **done)
add(900, blink=False, served=None, **done)

frames[0].save(OUT, save_all=True, append_images=frames[1:], duration=durations, loop=0,
               optimize=True, disposal=1)
print(OUT, frames[0].size, len(frames), "frames", sum(durations) / 1000, "s")
