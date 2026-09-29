"""Local, deterministic SVG book jackets using the existing library cover field."""
from pathlib import Path
from html import escape
books=[
('demo-sect','#101d1b','#b7efc5','玄幻 · 宗门经营',['退婚当天','我继承了反派宗门'],'诸位仙长，先结一下欠款。','seal'),
('demo-heiress','#301720','#ffd7b1','重生 · 宅斗读心',['重生后，侯府全家','能听见我的心声'],'这碗燕窝，上辈子我喝过。','fan'),
('demo-landlord','#231a38','#dec4ff','异世界 · 契约同居',['勇者辞职后','魔王成了我的房东'],'押一付一，不许讨伐房东。','key'),
('demo-loop','#132e49','#bdebf3','校园 · 时间循环',['全校都以为我们在交往','只有她知道明天会重置'],'这是第十七个星期五。','clock'),
('demo-redcliff','#321b16','#efbd83','罗贯中 · 公版原著 · 第43—50回',['三国演义','赤壁'],'江上风起，局中各怀心事。','ships'),
('demo-monkey','#241e12','#f5d68f','吴承恩（传统署名）· 公版原著 · 第4—7回',['西游记','大闹天宫'],'齐天之名，为何无我一席？','staff'),
]
art={
 'seal':'<path d="M940 120v390m-55-220h110m-80-45h50m-72 44 47 65 47-65"/><rect x="817" y="387" width="206" height="142" rx="8"/><path d="M850 422h135v74H850zM886 422v74m50-74v74m-86-36h135"/>',
 'fan':'<path d="M970 470 735 210Q952 26 1160 205Z"/><path d="m970 470-168-300m168 300-84-354m84 354 13-376m-13 376 107-345"/><circle cx="970" cy="470" r="14"/>',
 'key':'<path d="m860 135-36-48-10 74m204-26 36-48 10 74M900 320v230h44v-55h51v-53h-51V320"/><circle cx="923" cy="247" r="78"/><path d="M893 245q30 30 60 0"/>',
 'clock':'<circle cx="975" cy="292" r="170"/><circle cx="975" cy="292" r="150" stroke-dasharray="2 37"/><path d="M975 162v130l96 48m-78-218-20-24-23 21M834 510h273m-243 24h210"/><text x="975" y="585" text-anchor="middle" fill="currentColor" stroke="none" font-size="54">17 : 40</text>',
 'ships':'<path d="M803 412h340l-50 71H855ZM963 412V84L825 361h138m35 51V144l120 216H998M760 520q45-30 90 0t90 0 90 0 90 0m-390 55q45-30 90 0t90 0 90 0 90 0"/>',
 'staff':'<path d="m831 545 213-454m-181 394 58 27m92-241 58 27m-123 128 58 27m-39-318 58 27" stroke-width="22"/><circle cx="961" cy="314" r="184" stroke-width="2"/><path d="M790 548q20-45 65-20 40-63 77-8 75-12 95 40h99" stroke-width="4"/>',
}
root=Path(__file__).resolve().parents[1]/'public/covers'
for id,bg,fg,label,lines,hook,motif in books:
 size=62 if max(map(len,lines))>12 else 76
 title=''.join(f'<text x="74" y="{274+i*102}" font-size="{size}" font-weight="650">{escape(line)}</text>' for i,line in enumerate(lines))
 svg=f'''<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="640" viewBox="0 0 1200 640" role="img" aria-label="{escape(''.join(lines))}">
 <title>{escape(''.join(lines))}</title>
 <rect width="1200" height="640" fill="{bg}"/>
 <g stroke="{fg}" opacity=".1"><path d="M0 64h1200M0 576h1200M64 0v640M1136 0v640"/><circle cx="1060" cy="280" r="350" fill="none"/></g>
 <g style="color:{fg}" fill="none" stroke="{fg}" stroke-width="5" opacity=".19">{art[motif]}</g>
 <g fill="{fg}" font-family="Noto Serif SC,Songti SC,STSong,serif">
 <text x="76" y="116" font-size="26" letter-spacing="3">{escape(label)}</text>
 {title}
 <rect x="76" y="433" width="56" height="3"/>
 <text x="76" y="491" font-size="32">{escape(hook)}</text>
 <text x="76" y="582" font-size="20" letter-spacing="4" opacity=".6">RETALE · STORY COLLECTION</text>
 </g></svg>'''
 (root/f'{id}.svg').write_text(svg)
