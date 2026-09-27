export type RewriteProviderPromptInput = {
  systemPrompt?: string
  userPrompt?: string
  mode: string
  tone: string
  scope: string
  keepCanon?: boolean
  autoContinue?: boolean
  thoughtLevel?: string
  prompt?: string
  sourceText: string
}

// Keep provider fallbacks/whitespace normalization visible in prompt previews.
export function resolveRewriteProviderPrompts(input: RewriteProviderPromptInput) {
  return {
    systemPrompt: input.systemPrompt?.trim() || [
      'You are a novel rewriting assistant.',
      'Return JSON only.',
      'Produce one rewrite result in Chinese.',
      'The result should be a coherent prose passage.',
    ].join(' '),
    userPrompt: input.userPrompt?.trim() || JSON.stringify({
      task: 'rewrite', mode: input.mode, tone: input.tone, scope: input.scope,
      keepCanon: input.keepCanon, autoContinue: input.autoContinue, thoughtLevel: input.thoughtLevel,
      prompt: input.prompt, sourceText: input.sourceText, outputSchema: { result: 'rewritten text' },
    }),
  }
}
