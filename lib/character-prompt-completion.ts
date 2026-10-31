export type PromptCharacter = {
  name: string
  aliases?: string[]
}

export type CharacterCompletion = {
  start: number
  end: number
  characters: PromptCharacter[]
}

export function getCharacterCompletion(
  value: string,
  start: number,
  end: number,
  characters: PromptCharacter[],
  browse = false,
): CharacterCompletion | null {
  const seen = new Set<string>()
  const options = characters.filter((character) => {
    const name = character.name.trim()
    if (!name || seen.has(name)) return false
    seen.add(name)
    return true
  })
  if (!options.length) return null
  if (browse) return { start, end, characters: options }
  if (start !== end) return null

  const before = value.slice(0, start)
  const mention = /[@＠]([\p{L}\p{M}\p{N} _·.'’-]{0,80})$/u.exec(before)
  const names = (character: PromptCharacter) => [character.name, ...(character.aliases ?? [])].map((name) => name.trim().toLowerCase()).filter(Boolean)
  if (mention) {
    const query = mention[1].trim().toLowerCase()
    const matches = options.filter((character) => names(character).some((name) => name.includes(query)))
    return matches.length ? { start: start - mention[0].length, end, characters: matches } : null
  }

  // Chinese names commonly touch the preceding sentence without a word boundary.
  // Match the longest suffix before the caret; Latin names still need a boundary.
  const tail = before.slice(-80)
  for (let length = tail.length; length > 0; length -= 1) {
    const query = tail.slice(-length).toLowerCase()
    if (!/^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} ·.'’-]*$/u.test(query)) continue
    const previous = before[start - length - 1]
    if (/^[\p{Script=Latin}\p{N}]/u.test(query) && previous && /[\p{Script=Latin}\p{N}]/u.test(previous)) continue
    const matches = options.filter((character) => names(character).some((name) => name.includes(query)))
    if (matches.length) {
      // A completed name should not keep prompting for its own last character.
      if (matches.some((character) => character.name.trim().toLowerCase() === query)) return null
      return { start: start - length, end, characters: matches }
    }
  }
  return null
}
