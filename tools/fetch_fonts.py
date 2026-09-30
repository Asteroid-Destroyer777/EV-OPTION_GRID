"""Скачивает шрифты (Cyrillic + Latin) с Google Fonts и генерирует fonts/fonts.css (self-hosted)."""
import re, urllib.request, urllib.parse, os, sys
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
FAMILIES = [
    "family=Onest:wght@300..800",
    "family=Unbounded:wght@300..700",
    "family=IBM+Plex+Mono:wght@400;500;600",
]
OUT = os.path.join(os.path.dirname(__file__), "..", "fonts")
url = "https://fonts.googleapis.com/css2?" + "&".join(FAMILIES) + "&display=swap"
css = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA})).read().decode()
blocks = re.findall(r"/\* ([\w-]+) \*/\s*(@font-face \{.*?\})", css, re.S)
out, seen = [], {}
for subset, block in blocks:
    if subset not in ("cyrillic", "latin"):
        continue
    src = re.search(r"url\((https://[^)]+\.woff2)\)", block).group(1)
    fam = re.search(r"font-family: '([^']+)'", block).group(1)
    wt = re.search(r"font-weight: ([^;]+);", block).group(1).replace(" ", "-")
    name = f"{fam.replace(' ', '')}-{wt}-{subset}.woff2"
    if name not in seen:
        data = urllib.request.urlopen(urllib.request.Request(src, headers={"User-Agent": UA})).read()
        open(os.path.join(OUT, name), "wb").write(data)
        seen[name] = len(data)
    block = re.sub(r"url\(https://[^)]+\.woff2\)", f"url(./{name})", block)
    out.append(f"/* {subset} */\n{block}")
open(os.path.join(OUT, "fonts.css"), "w").write("\n".join(out) + "\n")
print(seen)
