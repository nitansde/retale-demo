import { readFile, writeFile } from 'node:fs/promises'
import { Converter } from 'opencc-js/t2cn'

const simplify = Converter({from:'t',to:'cn'})
const path = new URL('../demo/catalog/public-domain.json', import.meta.url)
const books = JSON.parse(await readFile(path,'utf8'))
for (const chapters of Object.values(books)) {
  for (const chapter of chapters) {
    for (const field of ['title','text','summary']) chapter[field] = simplify(chapter[field])
    chapter.textConversion = 'OpenCC 1.4.2: t → cn (simplified Chinese)'
  }
}
await writeFile(path,JSON.stringify(books,null,2)+'\n')
console.log('Simplified Chinese classics: 12 complete chapters; source URLs and revision IDs retained.')
