import { PickupBark } from './pickup-bark.js';

export const CONTACT_WHINE_URL = new URL('../art/audio/contact-whine.mp3', import.meta.url);

// Shares decoding, one-voice playback and pause/mute cleanup with the bark.
export class ContactWhine extends PickupBark {
  constructor(options = {}) {
    super({ url: CONTACT_WHINE_URL, gain: .55, cooldownMs: 850, ...options });
  }
}
