#!/usr/bin/python3 -I
"""Build the 'I Found You' cursor: slim dark arrow, warm outline, crimson tip."""
import cairo, struct, os, sys

OUT = sys.argv[1]
SIZES = [24, 32, 48, 64, 96]

def arrow_path(ctx, s):
    # Slim arrow in a 32-unit design grid, tip at (2,2)
    pts = [(2, 2), (2, 24.5), (8.0, 19.2), (12.2, 28.6), (15.6, 27.1), (11.4, 17.9), (19.4, 17.6)]
    ctx.move_to(pts[0][0] * s, pts[0][1] * s)
    for x, y in pts[1:]:
        ctx.line_to(x * s, y * s)
    ctx.close_path()

def render(size):
    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, size, size)
    ctx = cairo.Context(surf)
    s = size / 32.0
    ctx.set_line_join(cairo.LINE_JOIN_ROUND)
    # soft shadow
    ctx.save(); ctx.translate(0.6 * s, 1.0 * s); arrow_path(ctx, s)
    ctx.set_source_rgba(0, 0, 0, 0.28); ctx.fill(); ctx.restore()
    # body
    arrow_path(ctx, s)
    body = cairo.LinearGradient(0, 2 * s, 0, 28 * s)
    body.add_color_stop_rgb(0, 0.10, 0.085, 0.085)
    body.add_color_stop_rgb(1, 0.055, 0.047, 0.047)
    ctx.set_source(body); ctx.fill_preserve()
    # crimson tip: clip to arrow, paint top-left triangle region
    ctx.save(); ctx.clip()
    tip = cairo.LinearGradient(2 * s, 2 * s, 8 * s, 10 * s)
    tip.add_color_stop_rgba(0.0, 0.82, 0.38, 0.42, 1)    # #d0606a
    tip.add_color_stop_rgba(0.55, 0.69, 0.27, 0.30, 1)   # #b1444d
    tip.add_color_stop_rgba(1.0, 0.69, 0.27, 0.30, 0)
    ctx.set_source(tip); ctx.rectangle(0, 0, 11 * s, 12 * s); ctx.fill()
    ctx.restore()
    # warm outline
    arrow_path(ctx, s)
    ctx.set_line_width(max(1.0, 1.15 * s))
    ctx.set_source_rgba(0.925, 0.894, 0.863, 0.95)   # #ece4dc
    ctx.stroke()
    surf.flush()
    return surf, (max(0, int(round(2 * s)) - 0), max(0, int(round(2 * s)) - 0))

def xcursor(path, sizes):
    images = []
    for sz in sizes:
        surf, hot = render(sz)
        data = bytes(surf.get_data())  # premultiplied ARGB32, native (little-endian) = Xcursor layout
        stride = surf.get_stride()
        rows = b"".join(data[y * stride: y * stride + sz * 4] for y in range(sz))
        images.append((sz, hot, rows))
    ntoc = len(images)
    header = struct.pack("<4sIII", b"Xcur", 16, 0x10000, ntoc)
    pos = 16 + ntoc * 12
    toc, chunks = b"", b""
    for sz, (hx, hy), rows in images:
        toc += struct.pack("<III", 0xFFFD0002, sz, pos)
        chunk = struct.pack("<IIIIIIIII", 36, 0xFFFD0002, sz, 1, sz, sz, hx, hy, 50) + rows
        chunks += chunk
        pos += len(chunk)
    with open(path, "wb") as f:
        f.write(header + toc + chunks)

os.makedirs(os.path.join(OUT, "cursors"), exist_ok=True)
main = os.path.join(OUT, "cursors", "default")
xcursor(main, SIZES)
for alias in ["left_ptr", "arrow", "top_left_arrow", "x-cursor", "context-menu"]:
    link = os.path.join(OUT, "cursors", alias)
    if os.path.lexists(link): os.remove(link)
    os.symlink("default", link)
with open(os.path.join(OUT, "index.theme"), "w") as f:
    f.write("[Icon Theme]\nName=I Found You\nComment=Slim dark cursor with a crimson tip\nInherits=Yaru\n")
# preview
prev = cairo.ImageSurface(cairo.FORMAT_ARGB32, 360, 120); c = cairo.Context(prev)
c.set_source_rgb(0.055, 0.047, 0.047); c.rectangle(0, 0, 180, 120); c.fill()
c.set_source_rgb(0.85, 0.82, 0.78); c.rectangle(180, 0, 180, 120); c.fill()
for i, x in enumerate((50, 230)):
    s, _ = render(96); c.set_source_surface(s, x, 12); c.paint()
prev.write_to_png(os.path.join(OUT, "cursor-preview.png"))
print("ok")
