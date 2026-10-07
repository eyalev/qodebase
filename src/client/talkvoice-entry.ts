// Browser entry for /talk-voice.js: Cloudflare's voice client (agents/voice/client),
// exposed for the Talk layer (src/talkclient.ts), which loads it only when a
// conversation starts. Bundled by scripts/build-talk-voice.mjs into src/talkvoicejs.gen.ts.
import { VoiceClient } from 'agents/voice/client';
(globalThis as any).TalkVoiceKit = { VoiceClient };
