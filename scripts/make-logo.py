#!/usr/bin/env python3
"""Builds the Fontexto SVG logo set (mark, lockup, wordmark) from hand-built paths and an outlined font.
Usage: python3 scripts/make-logo.py   (needs fonttools; writes src/web/assets/*.svg)"""
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
import os
OUT=os.path.join(os.path.dirname(__file__),'..','src','web','assets')
os.makedirs(OUT,exist_ok=True)
DEEP='#065F46'; EM='#10B981'
# icon in a 360x320 box (coordinates traced by eye from the approved logo)
F='M281 29 C225 13 195 45 185 115 C175 185 160 255 137 280 C120 300 90 295 70 292'
BRUSH='M20 160 C90 144 210 138 340 146 L347 150 L292 153 L345 161 L250 164 C170 166 92 172 26 192 C10 188 10 168 20 160 Z'
def mark_body():
    return (f'<path d="{F}" fill="none" stroke="{DEEP}" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<path d="{BRUSH}" fill="{EM}"/>')
def write(name,svg): open(os.path.join(OUT,name),'w',encoding='utf-8').write(svg)
write('fontexto-mark.svg',f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 320" role="img" aria-label="Fontexto">{mark_body()}</svg>\n')
# icon on a rounded square for favicons / app icon
write('fontexto-icon.svg',f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#ffffff"/><rect x="8" y="8" width="496" height="496" rx="104" fill="#D1FAE5"/><g transform="translate(76 90) scale(0.99)">{mark_body()}</g></svg>\n')
# outlined wordmark
def outline(text,font_path,size,x0,y0,tracking=0):
    f=TTFont(font_path); gs=f.getGlyphSet(); cmap=f.getBestCmap(); upm=f['head'].unitsPerEm; sc=size/upm
    x=x0; parts=[]
    for ch in text:
        g=cmap[ord(ch)]; pen=SVGPathPen(gs); tp=TransformPen(pen,(sc,0,0,-sc,x,y0)); gs[g].draw(tp)
        parts.append(pen.getCommands()); x+=gs[g].width*sc+tracking
    return ' '.join(parts),x-x0-tracking
FONT='/usr/share/fonts/truetype/sand-box/google/Poppins/Poppins-Medium.ttf'
d,w=outline('fontexto',FONT,120,0,100,-1)
write('fontexto-wordmark.svg',f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 0 {w+4:.0f} 130" role="img" aria-label="Fontexto"><path d="{d}" fill="{DEEP}"/></svg>\n')
# horizontal lockup: mark (height 100) + wordmark
d2,w2=outline('fontexto',FONT,82,0,0,-1)
sc=100/320
write('fontexto-lockup.svg',f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {360*sc+20+w2:.0f} 100" role="img" aria-label="Fontexto"><g transform="scale({sc:.4f})">{mark_body()}</g><path transform="translate({360*sc+20:.1f} 72)" d="{d2}" fill="{DEEP}"/></svg>\n')
print('ok',w,w2)
