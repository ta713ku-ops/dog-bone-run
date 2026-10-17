export const CONTACT_EFFECT_MS = 520;
export const CONTACT_FLINCH_MS = 280;

// All cues use game time: pause freezes the reaction; resume continues it.
export function sampleContactReaction(effects, activeMs, reducedMotion = false) {
  let effect;
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    if (e.visualType === 'streetContact' && !e.ignored
      && e.activeMs <= activeMs && activeMs - e.activeMs < CONTACT_EFFECT_MS) { effect = e; break; }
  }
  if (!effect) return { active: false, age: Infinity, flinch: 0, alpha: 0, side: 1 };
  const age = activeMs - effect.activeMs;
  const flinch = reducedMotion || age >= CONTACT_FLINCH_MS ? 0
    : Math.sin(Math.PI * age / CONTACT_FLINCH_MS);
  return { active: true, age, flinch, side: effect.lane < (effect.x ?? effect.lane) ? 1 : -1,
    alpha: reducedMotion || age < 340 ? 1 : (CONTACT_EFFECT_MS - age) / (CONTACT_EFFECT_MS - 340) };
}
