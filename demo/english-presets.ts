import { createDefaultPresetCompatLibrary } from '@/lib/preset-compat/surface-contract';
import { normalizePresetCompatPresetImport } from '@/lib/preset-compat/normalize';

export function makeEnglishPresets() {
  const library = createDefaultPresetCompatLibrary();
  const prompt = 'You are a fiction writing partner. Preserve the supplied viewpoint, voice, character motives and world rules. Use only facts available at the current chapter. Make changed choices produce concrete consequences. Return story prose without commentary.';
  const { preset } = normalizePresetCompatPresetImport({
    name: 'ReTale · English fiction',
    prompts: [{ identifier: 'main', name: 'Story voice and continuity', role: 'system', content: prompt, enabled: true }],
    prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
    temperature: 0.8,
  }, { idFactory: () => 'retale-demo-en', now: '1970-01-01T00:00:00.000Z' });
  library.presets = { [preset.id]: preset };
  for (const binding of Object.values(library.surfaceBindings)) {
    if (binding.presetId) binding.presetId = preset.id;
  }
  library.builtinSystemPrompts.rewrite.content = prompt;
  library.builtinSystemPrompts.roleplay.content = 'Continue the scene as the selected counterpart. Respect each character’s knowledge, motives and established voice. Do not decide the player’s actions. Return JSON blocks containing narration and counterpart dialogue.';
  library.builtinSystemPrompts.future_jump.content = 'Write the target scene from the supplied divergence, causal bridge and future context. Keep the cost of earlier choices visible. Return a JSON object containing generatedTargetText, with no commentary.';
  return library;
}
