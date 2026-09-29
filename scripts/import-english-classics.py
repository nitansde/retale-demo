"""Reproducible, build-independent import of public-domain English originals."""
import hashlib, json, re, urllib.request
from pathlib import Path
root=Path(__file__).resolve().parents[1]
books={}
for key,number,count in [('demo-austen',1342,6),('demo-dracula',345,4)]:
    url=f'https://www.gutenberg.org/cache/epub/{number}/pg{number}.txt'
    cache=Path('/tmp')/f'retale-gutenberg-{number}.txt'
    if not cache.exists():
        req=urllib.request.Request(url,headers={'User-Agent':'ReTaleDemo/1.0 public-domain-excerpts'})
        cache.write_bytes(urllib.request.urlopen(req,timeout=30).read())
    data=cache.read_bytes()
    text=data.decode('utf-8-sig').replace('\r\n','\n')
    starts=list(re.finditer(r'(?m)^CHAPTER ([IVXLCDM]+)\.?\s*$',text))
    if number==1342:
        positions=[(text.index('It is a truth universally acknowledged'),'I')]+[(m.end(),m[1]) for m in starts]
        ends=[m.start() for m in starts]
    else:
        positions=[(m.end(),m[1]) for m in starts]
        ends=[m.start() for m in starts[1:]]
    chapters=[]
    for i in range(count):
        start,roman=positions[i]
        content=text[start:ends[i]]
        while '[Illustration' in content:
            a=content.index('[Illustration');depth=0;b=a
            for b in range(a,len(content)):
                if content[b]=='[': depth+=1
                if content[b]==']': depth-=1
                if depth==0: break
            content=content[:a]+content[b+1:]
        # Reflow print lines and remove plain-text italic markers; preserve wording.
        paragraphs=[' '.join(p.split()).replace('_','') for p in re.split(r'\n\s*\n',content)]
        content='\n\n'.join(p for p in paragraphs if p)
        assert len(content)>1000 and 'Project Gutenberg' not in content
        chapters.append(dict(title=f'Chapter {roman}',text=content,summary='',originalChapter=i+1))
    books[key]={'url':url,'ebook':f'https://www.gutenberg.org/ebooks/{number}','downloadSha256':hashlib.sha256(data).hexdigest(),
      'retrieved':'2026-09-29','chapters':chapters}
    print(key, [(c['title'],len(c['text'].split())) for c in chapters])
(root/'demo/catalog/english-public-domain.json').write_text(json.dumps(books,ensure_ascii=False,indent=2)+'\n')
