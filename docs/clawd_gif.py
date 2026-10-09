"""Render docs/clawd.gif: the bar through one turn, Clawd frying an egg.

The poses follow mascot() in hooks/register.tsx: same glyphs, colours and
tick (150 ms); the long stretches of the turn are time-lapsed. Needs Pillow
and the DejaVu and Noto Color Emoji fonts (paths below are Debian/Ubuntu).

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

mono = ImageFont.truetype(MONO, SIZE)
asc, desc = mono.getmetrics()
CW = round(mono.getlength("M"))
CH = asc + desc
# Block elements drawn as the terminal does: exact quarters of the cell.
QUARTERS = {"█": "1111", "▌": "1010", "▐": "0101", "▘": "1000", "▝": "0100", "▖": "0010",
            "▗": "0001", "▛": "1110", "▜": "1101", "▙": "1011", "▟": "0111", "▀": "1100", "▄": "0011"}
emoji = ImageFont.truetype("/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf", 109)
EMOJI = "⏳"   # two cells wide, as in a terminal


def paste_emoji(img, ch, x, y):
    glyph = Image.new("RGBA", (136, 128), (0, 0, 0, 0))
    ImageDraw.Draw(glyph).text((0, 0), ch, font=emoji, embedded_color=True)
    glyph = glyph.crop(glyph.getbbox())
    h = CH - 4
    glyph = glyph.resize((round(glyph.width * h / glyph.height), h), Image.LANCZOS)
    img.paste(glyph, (x + (2 * CW - glyph.width) // 2, y + 2), glyph)


wide = ImageFont.truetype(WIDE, SIZE)
while wide.getlength("⎇") > CW:
    wide = ImageFont.truetype(WIDE, wide.size - 1)

SIZZLE = ["~·~", "·~·", "~ ~", " ~ "]


def yolk(tick):
    ms = tick * 150
    return "●" if ms >= 30_000 else "◉" if ms >= 10_000 else "o"


def mascot(working, tick, blink, served):
    eyes = "█████" if blink else "▛███▜"
    if working:
        if tick < 4:
            return f" ▐{eyes}▌▗", " o ", CLAUDE, "_"
        left = (tick // 2) % 2 == 0
        head = f"▖▐{eyes}▌ " if left else f" ▐{eyes}▌▗"
        return head, SIZZLE[tick % 4], CLAUDE, yolk(tick)
    if served:
        mark, y = served
        return f" ▐{eyes}▌▗", f" {mark} ", GREEN if mark == "✓" else RED, y
    return f" ▐{eyes}▌ ", "   ", CLAUDE, "_"


BOX = 72              # the frame's width in cells
INNER = BOX - 4       # less border and padding
MASCOT = 13
GAP = 2
INDENT = 2
COLS = INDENT + BOX + 2
ROWS = 5
PAD = 18


def parts_line(parts):
    """[(text, colour)] joined by a dim ' · '."""
    out = []
    for i, (t, c) in enumerate(parts):
        if i:
            out.append((" · ", DIM))
        out.append((t, c))
    return out


def frame(working, tick, blink, served, ctx, dirty, review):
    head, steam, steam_c, y = mascot(working, tick, blink, served)
    figures = parts_line([("◆ Opus 5.5", CYAN), (f"CTX {ctx}% {ctx * 10}k", DIM),
                          ("5h 18% ↻ 2h 14m", DIM)])
    project = [("~/code/shop", BLUE), ("⎇ feature/cart", MAGENTA), (f"●{dirty}", YELLOW), ("↑2", GREEN)]
    if review:
        project.append(review)
    project = parts_line(project)

    room = INNER - MASCOT - GAP
    rows = []
    hint = "esc to interrupt" if working else "? for shortcuts"
    rows.append([(" " * INDENT + hint, DIM)])
    rows.append([(" " * INDENT + "╭" + "─" * (BOX - 2) + "╮", BORDER)])

    def body(line, m):
        used = sum(len(t) + t.count(EMOJI) for t, _ in line)
        return ([(" " * INDENT + "│ ", BORDER)] + line + [(" " * (room - used + GAP), TEXT)]
                + m + [(" │", BORDER)])

    rows.append(body(figures, [(head, CLAUDE), (" " + steam, steam_c)]))
    pan = [(" \\", DIM), ("_" if y == "_" else y, DIM if y == "_" else YELLOW), ("/", DIM)]
    rows.append(body(project, [("▝▜█████▛▘", CLAUDE)] + pan))
    rows.append([(" " * INDENT + "╰" + "─" * (BOX - 2) + "╯", BORDER)])

    img = Image.new("RGB", (COLS * CW + 2 * PAD, ROWS * CH + 2 * PAD), BG)
    draw = ImageDraw.Draw(img)
    for r, line in enumerate(rows):
        col = 0
        for text, colour in line:
            for ch in text:
                x, base = PAD + col * CW, PAD + r * CH + asc
                top = PAD + r * CH
                if ch in QUARTERS:
                    hw, hh = CW / 2, CH / 2
                    for q, on in enumerate(QUARTERS[ch]):
                        if on == "1":
                            qx, qy = x + (q % 2) * hw, top + (q // 2) * hh
                            draw.rectangle([round(qx), round(qy), round(qx + hw) - 1, round(qy + hh) - 1], fill=colour)
                elif ch == EMOJI:
                    paste_emoji(img, ch, x, top)
                    col += 1
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

# The turn: crack, then frying, time-lapsed through the yolk setting.
for start, count, ctx in [(0, 22, 6), (67, 16, 8), (200, 16, 11)]:
    for tick in range(start, start + count):
        add(150, working=True, tick=tick, blink=False, served=None, ctx=ctx, dirty=4, review=("CI ⏳", YELLOW))

done = dict(working=False, tick=0, ctx=11, dirty=5, review=("!171 ✓", GREEN))
add(2000, blink=False, served=("✓", "●"), **done)
add(900, blink=False, served=None, **done)
add(160, blink=True, served=None, **done)
add(900, blink=False, served=None, **done)

frames[0].save(OUT, save_all=True, append_images=frames[1:], duration=durations, loop=0,
               optimize=True, disposal=1)
print(OUT, frames[0].size, len(frames), "frames", sum(durations) / 1000, "s")
