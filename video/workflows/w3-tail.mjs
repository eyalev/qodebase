// The last scene of W3 alone (spliced into a take whose final scene was filmed
// before the new version had propagated). See splice.py.
import { rig } from '../rig.mjs';
const BAD = `https://forq-app-eyal-workers-chat-demo-3.<sub>.workers.dev/api/room/${'0'.repeat(64)}/websocket`;
const r = await rig({ name: 'w3-tail' });
await r.open(BAD);
await r.say('The same request now gets "Invalid room id", a clean 404.', { hold: 4500 });
await r.end({ title: 'Errors that fix themselves', sub: 'Cloudflare Issues → forq → agents → review → deploy' });
