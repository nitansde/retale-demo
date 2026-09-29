"""Fetch public-domain original Chinese chapters; never runs during site startup/build."""
import json, re, time, subprocess, urllib.parse, urllib.request, urllib.error
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sets = [('demo-redcliff', '三國演義', range(43, 51)), ('demo-monkey', '西遊記', range(4, 8))]
books = {}
for book_id, work, numbers in sets:
    chapters = []
    for number in numbers:
        page = f'{work}/第{number:03d}回'
        endpoint = 'https://zh.wikisource.org/w/api.php?' + urllib.parse.urlencode(dict(action='parse', page=page, prop='wikitext|revid', format='json'))
        request = urllib.request.Request(endpoint, headers={'User-Agent': 'ReTaleDemo/1.0 public-domain-text-research'})
        cache = Path('/tmp') / f'retale-pd-{book_id}-{number}.json'
        if cache.exists():
            parsed = json.loads(cache.read_text())
        else:
            for attempt in range(3):
                try:
                    parsed = json.load(urllib.request.urlopen(request, timeout=30))['parse']
                    break
                except urllib.error.HTTPError as error:
                    if error.code != 429 or attempt == 2: raise
                    time.sleep(max(15, min(int(error.headers.get('Retry-After', '30')), 60)))
            cache.write_text(json.dumps(parsed, ensure_ascii=False))
            time.sleep(3)
        raw = parsed['wikitext']['*']
        heading = re.search(r'\| section\s*=\s*(.+)', raw)
        if heading: title = heading[1].replace('<br>', '　')
        else: title = re.search(r'\{\{Novel\|[^|]+\|([^|]+)', raw)[1].replace("'''", '')
        text = re.sub(r'<ref\b[^>]*>.*?</ref>', '', raw, flags=re.S)
        # Remove navigation and PD templates, including nested templates.
        while '{{' in text:
            cleaned = re.sub(r'\{\{[^{}]*\}\}', '', text)
            if cleaned == text: raise ValueError(f'Unparsed template in {page}')
            text = cleaned
        text = re.sub(r'\[\[([^]|]+)\|([^]]+)\]\]', r'\2', text)
        text = re.sub(r'\[\[([^]]+)\]\]', r'\1', text)
        text = re.sub(r'<[^>]+>', '', text)
        text = re.sub(r"'{2,3}", '', text)
        text = re.sub(r'^[ \t:　]+', '', text, flags=re.M)
        text = re.sub(r'\n{3,}', '\n\n', text).strip()
        assert len(text) > 2500 and '{{' not in text and '[[' not in text
        chapters.append(dict(title=title.strip(), text=text, summary='', originalChapter=number,
          url='https://zh.wikisource.org/wiki/' + urllib.parse.quote(page), revision=parsed.get('revid')))
        print(page, len(text))
    books[book_id] = chapters
(ROOT / 'demo/catalog/public-domain.json').write_text(json.dumps(books, ensure_ascii=False, indent=2) + '\n')

# Keep the displayed edition in simplified Chinese on future source refreshes.
subprocess.run(["node", str(ROOT / "scripts/simplify-chinese-classics.mjs")], check=True)
