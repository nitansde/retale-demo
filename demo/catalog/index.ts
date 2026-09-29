import { webnovels } from './webnovels';
import { lightnovels } from './lightnovels';
import { classics } from './classics';
import { englishSerials } from './english-serials';
import { englishMysteries } from './english-mysteries';
import { englishClassics } from './english-classics';
export const chineseBooks = [...webnovels, ...lightnovels, ...classics];
export const englishBooks = [...englishSerials, ...englishMysteries, ...englishClassics];
export const demoBooks = [...chineseBooks, ...englishBooks];
export const demoBookById = Object.fromEntries(demoBooks.map(book => [book.id, book]));
export const catalogVersion = 4;
export function bookLocale(id: string): 'zh' | 'en' | undefined {
  if (demoBookById[id]) return demoBookById[id].locale || 'zh';
}
export const introducedVersion = (id: string) => bookLocale(id) === 'en' ? 3 : 2;

// Exact IDs only: visitor imports with matching titles are unrelated.
export const retiredNovelIds = ['demo-mist', 'demo-star'];
