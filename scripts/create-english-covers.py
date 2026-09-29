"""English jackets rendered into ReTale's existing coverImage field."""
from pathlib import Path
from html import escape
books = [
 ('demo-safe-room','#10252a','#b5f0d8','LITRPG / PROGRESSION FANTASY',['THE LAST','SAFE ROOM'],'Zero damage. Five lives. Four slots.','door'),
 ('demo-crows','#221d33','#e8c99b','ROMANTASY / A DANGEROUS BARGAIN',['A BARGAIN OF','SALT AND CROWS'],'The wedding knife was meant for him.','crown'),
 ('demo-familiar','#263026','#e9d7a3','COZY FANTASY / A VERY INCONVENIENT GHOST',['A FAMILIAR','KIND OF MURDER'],'Tea. A raven. One unsolved murder.','tea'),
 ('demo-bellwether','#252435','#c9c4e8','DARK ACADEMIA / THE PRICE OF BRILLIANCE',['THE SAINT OF','BELLWETHER HALL'],'Your scholarship comes with a body.','window'),
 ('demo-austen','#e7dfcf','#414c45','JANE AUSTEN / CHAPTERS I–VI',['PRIDE AND','PREJUDICE'],'An excellent income. An unfortunate remark.','letter'),
 ('demo-dracula','#241e23','#e7b7a4','BRAM STOKER / CHAPTERS I–IV',['DRACULA'],'A gracious host. A locked door.','bat'),
]
art = {
 'door':'<path d="M856 510V120h205v390M898 510V161h122v349"/><circle cx="996" cy="336" r="6"/><path d="M852 520h230m-220 26h240M921 230h77m-39-38v77"/>',
 'crown':'<path d="m818 257 42 180h212l42-180-98 64-52-111-51 111ZM860 465h215M890 490h150M940 154l25-38 50 13-36 18 12 29-30-11-21-11m98 15 35-20 42 25-40-2 6 28-23-22"/>',
 'tea':'<path d="M825 320h231v95q-116 140-231 0ZM1056 340q135-22 90 85l-95 26M800 497h302M896 270q-40-40 0-85t0-85m84 170q-40-40 0-85t0-85"/><path d="m1010 180 70-60 55 25-45 13 18 30-44-7-18 44-36-45"/>',
 'window':'<path d="M808 523V271q0-154 154-185 154 31 154 185v252ZM962 90v433M814 272h295M819 411h288M840 513V280q0-100 122-144 122 44 122 144v233"/><path d="m937 285 28-61 23 58-23 64ZM962 342v159"/>',
 'letter':'<path d="m804 273 305-89 77 263-305 89ZM810 279l195 97 108-182M881 531l70-140m231 54-130-83"/><circle cx="1006" cy="374" r="33"/><path d="m884 197 177-87-33 121m-32-102-69 96"/>',
 'bat':'<circle cx="970" cy="279" r="179"/><path d="m804 333 59-127 80 79 27-26 27 26 80-79 59 127-84-20-55 57-27-47-27 47-55-57ZM914 511h112m-56-149v129"/>',
}
root=Path(__file__).resolve().parents[1]/'public/covers'
for key,bg,fg,label,lines,hook,motif in books:
    size=65 if max(map(len,lines))>14 else 78
    title=''.join(f'<text x="72" y="{270+i*97}" font-size="{size}" letter-spacing="-1">{escape(line)}</text>' for i,line in enumerate(lines))
    svg=f'''<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="640" viewBox="0 0 1200 640" role="img" aria-label="{escape(' '.join(lines))}">
<title>{escape(' '.join(lines))}</title><rect width="1200" height="640" fill="{bg}"/>
<g fill="none" stroke="{fg}" opacity=".12"><path d="M40 40h1120v560H40zM760 40v560"/></g>
<g fill="none" stroke="{fg}" stroke-width="4" opacity=".26">{art[motif]}</g>
<g fill="{fg}"><text x="74" y="115" font-family="Arial,sans-serif" font-size="20" letter-spacing="2">{escape(label)}</text>
<g font-family="Georgia,serif">{title}<text x="74" y="481" font-size="29" font-style="italic">{escape(hook)}</text></g>
<path d="M74 422h62" stroke="{fg}" stroke-width="2"/><text x="74" y="574" font-family="Arial,sans-serif" font-size="18" letter-spacing="4" opacity=".7">RETALE / ENGLISH COLLECTION</text></g></svg>'''
    (root/f'{key}.svg').write_text(svg)
