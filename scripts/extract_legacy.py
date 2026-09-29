#!/usr/bin/env python3
"""One-off: split the legacy single-file index.html into project assets.

Outputs:
  web/public/img/<KEY>.webp|.svg   decoded from `var IMG={...}`
  web/src/data/images.json         { KEY: {src, w, h} }
  web/src/styles/main.css          the <style> block, verbatim
Data arrays (MENU, SINAMONI, AUTUMN, REV) are converted by extract_data.mjs.
"""
import base64, io, json, re, sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "index.html"
SKIP = {"CHATGPT1", "CHATGPT2", "CHATGPT3"}  # not referenced anywhere

html = SRC.read_text(encoding="utf-8")

img_dir = ROOT / "web/public/img"
img_dir.mkdir(parents=True, exist_ok=True)
manifest = {}
for key, mime, b64 in re.findall(r'"([A-Z_0-9]+)":"data:image/([a-z+]+);base64,([A-Za-z0-9+/=]+)"', html):
    if key in SKIP:
        continue
    raw = base64.b64decode(b64)
    if mime == "svg+xml":
        name = f"{key.lower()}.svg"
        svg = raw.decode("utf-8")
        vb = re.search(r'viewBox="\s*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)', svg)
        w, h = (round(float(vb.group(1))), round(float(vb.group(2)))) if vb else (0, 0)
    else:
        name = f"{key.lower()}.{mime}"
        w, h = Image.open(io.BytesIO(raw)).size
    (img_dir / name).write_bytes(raw)  # bytes as-is: no re-encoding, pixel-identical
    manifest[key] = {"src": f"/img/{name}", "w": w, "h": h}

data_dir = ROOT / "web/src/data"
data_dir.mkdir(parents=True, exist_ok=True)
(data_dir / "images.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

css = re.search(r"<style>\n(.*?)</style>", html, re.S).group(1)
styles = ROOT / "web/src/styles"
styles.mkdir(parents=True, exist_ok=True)
(styles / "main.css").write_text(css, encoding="utf-8")

print(f"{len(manifest)} images, css {len(css)} bytes", file=sys.stderr)

# ---- markup: legacy <body> markup -> web/index.html with real <img src> ----
head = html[: html.index("<style>")]
body = html[html.index("<!-- NAV -->") : html.index("<script>\n/* ---------- palettes")]
first_screen_end = body.index("<!-- MENU -->")  # header + hero load eagerly


def to_img(m):
    key = m.group(1)
    info = manifest[key]
    lazy = "" if m.start() < first_screen_end else ' loading="lazy"'
    return f'src="{info["src"]}" width="{info["w"]}" height="{info["h"]}"{lazy}'


body = re.sub(r'data-donut="([A-Z_0-9]+)"', to_img, body)
page = (
    head
    + '<script type="module" src="/src/main.ts"></script>\n'
    + "</head>\n<body>\n"
    + body
    + "</body>\n</html>\n"
)
(ROOT / "web/index.html").write_text(page, encoding="utf-8")
print("web/index.html written", file=sys.stderr)
