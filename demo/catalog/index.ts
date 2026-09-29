import { webnovels } from './webnovels';
import { lightnovels } from './lightnovels';
import { classics } from './classics';
export const demoBooks = [...webnovels, ...lightnovels, ...classics];
export const demoBookById = Object.fromEntries(demoBooks.map(book => [book.id, book]));
export const catalogVersion = 2;
