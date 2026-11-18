"""Builds Benchtop Sans (Regular, Bold): Noto Sans Latin/Greek/Cyrillic + Noto Sans Devanagari, unhinted."""
import sys
from fontTools import subset
from fontTools.merge import Merger
from fontTools.ttLib import TTFont

src, out = sys.argv[1], sys.argv[2]
LATIN = "U+0020-007E,U+00A0-024F,U+0300-036F,U+0370-03FF,U+0400-04FF,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+2200-22FF,U+25A0-25FF,U+2713-2718,U+FB01-FB02"
DEVA = "U+0900-097F,U+1CD0-1CFF,U+200C-200D,U+20B9,U+25CC,U+A8E0-A8FF"

def cut(path, unicodes, target):
    options = subset.Options()
    options.layout_features = ['*']
    options.hinting = False
    options.drop_tables += ['DSIG']
    options.name_IDs = ['*']
    font = TTFont(path)
    sub = subset.Subsetter(options)
    sub.populate(unicodes=subset.parse_unicodes(unicodes))
    sub.subset(font)
    font.save(target)

for weight in ['Regular', 'Bold']:
    a = f"{out}/latin-{weight}.ttf"
    b = f"{out}/deva-{weight}.ttf"
    cut(f"{src}/NotoSans-{weight}.ttf", LATIN, a)
    cut(f"{src}/NotoSansDevanagari-{weight}.ttf", DEVA, b)
    merged = Merger().merge([a, b])
    name = merged['name']
    family = 'Benchtop Sans'
    for record in list(name.names):
        if record.nameID in (1, 16):
            record.string = family
        elif record.nameID == 4:
            record.string = f"{family} {weight}" if weight != 'Regular' else family
        elif record.nameID == 6:
            record.string = f"BenchtopSans-{weight}"
        elif record.nameID == 3:
            record.string = f"BenchtopSans-{weight};built from Noto Sans 2.004 and Noto Sans Devanagari 2.001"
    merged.save(f"{out}/BenchtopSans-{weight}.ttf")
    cmap = TTFont(f"{out}/BenchtopSans-{weight}.ttf").getBestCmap()
    print(weight, 'glyph map', len(cmap), 'A', 0x41 in cmap, 'ka', 0x915 in cmap, 'rupee', 0x20B9 in cmap)
