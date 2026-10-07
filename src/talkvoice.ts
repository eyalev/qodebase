// Talk, phase 2: a continuous conversation. The browser streams the mic over a
// WebSocket to this Durable Object (one per person, named by their handle);
// Flux (@cf/deepgram/flux) transcribes and decides when a turn ends, the same
// brain as typed Talk (decideCore / chatCore / statusCore in src/talk.ts)
// decides, the page carries out what it says (custom messages), and the reply
// is spoken with Aura and streamed back. Talking over a reply stops it
// (handled by the voice client). Built on Cloudflare's official voice kit
// (agents/voice, cloudflare/agents), not a hand-rolled pipeline.
//
// Cost (2026-10-07 price list, measured in the gateway for Aura): Flux $0.0077
// per streamed audio minute (silence too), Aura-1 $0.015 / Aura-2 $0.03 per 1k
// characters, plus the brain's calls. Capped per person per day in TalkLog
// (voice_sec) and recorded per turn in the cost ledger (src/costs.ts).
import { Agent, type Connection } from 'agents';
import { withVoice, WorkersAIFluxSTT, WorkersAITTS, type VoiceTurnContext } from 'agents/voice';
import type { Env } from './env';
import { isOwner } from './auth';
import { recordCost } from './costs';
import { chatCore, decideCore, statusCore, talkLog } from './talk';

const log = (event: string, data: Record<string, unknown> = {}) => console.log(JSON.stringify({ ts: new Date().toISOString(), module: 'talkvoice', event, ...data }));
const FLUX_USD_PER_MIN = 0.0077;
const AURA_USD_PER_1K: Record<string, number> = { '@cf/deepgram/aura-1': 0.015, '@cf/deepgram/aura-2-en': 0.03 };
const SPEAKERS: Record<string, string[]> = {
  '@cf/deepgram/aura-1': ['helios', 'angus', 'arcas', 'orion', 'orpheus', 'perseus', 'zeus', 'athena', 'asteria', 'luna', 'hera', 'stella'],
  '@cf/deepgram/aura-2-en': ['draco', 'apollo', 'arcas', 'atlas', 'hermes', 'orion', 'zeus', 'asteria', 'athena', 'aurora', 'cora', 'helena', 'hera', 'iris', 'juno', 'luna', 'minerva', 'thalia'],
};

/** The AI binding with Talk's AI Gateway on every call (the voice kit calls the binding directly). */
function gatewayed(env: Env): Ai {
  const ai = env.AI as any;
  if (!env.TALK_GATEWAY) return ai;
  return { run: (model: string, input: unknown, opts: any = {}) => ai.run(model, input, { ...opts, gateway: { id: env.TALK_GATEWAY } }) } as unknown as Ai;
}

const YES = /^\s*(yes|yeah|yep|yup|sure|ok(ay)?|send( it)?|do it|go( ahead)?|please( do)?|fork( it)?|confirm)\b/i;
const NO = /^\s*(no|nope|nah|cancel|don'?t|stop|never ?mind|not now)\b/i;

/** What the voice says while the page does it (the screen shows the rest). */
function line(c: any): string {
  const name = String(c.label || '').replace(/^[^/]+\//, '').replace(/\s*\(.*\)$/, '');
  switch (c.op) {
    case 'go': return c.href === '/' ? 'Going home.' : `Opening ${name || 'it'}.`;
    case 'back': return 'Going back.';
    case 'press': return 'Done.';
    case 'type': return 'Typed it. Say send it, or change it.';
    case 'scroll': return '';
    default: return '';
  }
}

// The SDK types its env as Cloudflare.Env; ours is src/env.ts.
const VoiceAgent = withVoice(Agent<any>);

export class TalkVoice extends VoiceAgent {
  declare env: Env;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.transcriber = new WorkersAIFluxSTT(gatewayed(env), { keyterms: ['qodebase', 'Talk', 'fork', 'merge', 'router'] });
    this.tts = new WorkersAITTS(gatewayed(env), { model: '@cf/deepgram/aura-1', speaker: 'helios' });
  }
  #ttsModel = '@cf/deepgram/aura-1';
  #screen: any = null;
  #pageText = '';
  #pending: any = null;              // a command waiting for a spoken yes / no
  #callStart = 0;

  get #who() { return { handle: this.name, admin: false }; }
  get #covered() { return !this.env.SELF_HOST && !isOwner(this.env, this.name); }
  #cost(usd: number, project = '') { if (usd > 0) return recordCost(this.env, this.name, 'voice', project, { usd, covered: this.#covered }); }
  #send(connection: Connection, data: unknown) { try { connection.send(JSON.stringify(data)); } catch { /* closed */ } }

  async beforeCallStart(_connection: Connection) {
    const left = await talkLog(this.env).take('voice_sec', this.name, 1);
    if (!left.ok) { log('call_refused', { handle: this.name, why: 'daily minutes used' }); return false; }
    return true;
  }
  async onCallStart(connection: Connection) {
    this.#callStart = Date.now();
    this.#send(connection, { type: 'talk-ready' });
    log('call_start', { handle: this.name });
  }
  async onCallEnd(_connection: Connection) {
    if (!this.#callStart) return;
    const sec = Math.round((Date.now() - this.#callStart) / 1000);
    this.#callStart = 0;
    await talkLog(this.env).take('voice_sec', this.name, Math.max(0, sec - 1)).catch(() => null);
    await this.#cost(sec / 60 * FLUX_USD_PER_MIN);
    log('call_end', { handle: this.name, seconds: sec, flux_usd: Math.round(sec / 60 * FLUX_USD_PER_MIN * 1e5) / 1e5 });
  }

  /** Non-voice messages from the page: what it shows, voice settings, and words to say (late answers). */
  async onMessage(connection: Connection, message: unknown) {
    let m: any;
    try { m = JSON.parse(String(message)); } catch { return; }
    if (m?.type === 'screen') { this.#screen = m.screen || null; this.#pageText = String(m.pageText || '').slice(0, 5000); return; }
    if (m?.type === 'voice') {
      const model = m.model === 'aura-2' ? '@cf/deepgram/aura-2-en' : '@cf/deepgram/aura-1';
      const speaker = SPEAKERS[model].includes(m.speaker) ? m.speaker : SPEAKERS[model][0];
      this.#ttsModel = model;
      this.tts = new WorkersAITTS(gatewayed(this.env), { model, speaker });
      return;
    }
    if (m?.type === 'say' && m.text) {
      const text = String(m.text).slice(0, 600);
      await this.speak(connection, text);
    }
  }

  async onTurn(transcript: string, context: VoiceTurnContext) {
    const t0 = Date.now();
    const connection = context.connection as Connection;
    const said = String(transcript || '').trim();
    if (!said) return '';
    // Over today's minutes mid-call: say so and hang up.
    const used = this.#callStart ? Math.round((Date.now() - this.#callStart) / 1000) : 0;
    const budget = await talkLog(this.env).take('voice_sec', this.name, 0);
    if (!budget.ok || used > budget.left) { this.#send(connection, { type: 'talk-end', why: 'minutes' }); setTimeout(() => this.forceEndCall(connection), 4000); return 'That is all the talking time for today. Typing still works.'; }

    // A spoken yes / no answers the last offer (send this change, fork it, did you mean…).
    if (this.#pending) {
      const p = this.#pending;
      if (YES.test(said)) { this.#pending = null; this.#send(connection, { type: 'talk-confirm', cmd: p }); return p.op === 'change' ? (p.mine ? 'Sending it.' : 'Forking it.') : line(p) || 'Okay.'; }
      if (NO.test(said)) { this.#pending = null; this.#send(connection, { type: 'talk-cancel' }); return 'Okay, I won\'t.'; }
      this.#pending = null;
    }

    this.#send(connection, { type: 'talk-heard', text: said });
    const r: any = await decideCore(this.env, this.#who, { utterance: said, screen: this.#screen || { path: '/', title: '', items: [] } });
    if (!r.ok) return r.why || 'Something went wrong there.';
    const c = r.cmd;
    await this.#cost(0.00032);   // one clef-flash decision (measured mean, gateway logs 2026-10-07)
    log('turn', { handle: this.name, said, path: this.#screen?.path, mode: c.mode, op: c.op, p: c.p, risky: c.risky, why: c.why, decide_ms: Date.now() - t0 });

    if ((c.risky || 0) >= 0.5) { this.#send(connection, { type: 'talk-cmd', cmd: { ...c, refused: true } }); return 'That would change or remove something, so I\'ll leave the doing to you.'; }
    // Speech comes garbled ("Our tasks stored in my to do app"): "not a request" with a concrete
    // reading behind it is not silence. Questions are answered (safe), a change goes to its confirm,
    // a page action becomes "did you mean…?". Only one- or two-word filler stays silent.
    if (c.mode === 'none') {
      const words = said.split(/\s+/).filter(Boolean).length;
      if ((c.op === 'code' || c.op === 'status') && words >= 3) c.mode = 'ask';
      else if (c.op === 'change' && words >= 3) c.mode = 'act';
      else if (!['none', 'explain'].includes(c.op) && (c.p ?? 0) >= 0.3 && words >= 3) {
        this.#pending = c;
        this.#send(connection, { type: 'talk-cmd', cmd: { ...c, offer: true } });
        log('turn_rescued', { handle: this.name, said, op: c.op, as: 'offer' });
        return `Did you mean ${line(c).replace(/\.$/, '').toLowerCase() || 'that'}?`;
      } else {
        log('turn_unclear', { handle: this.name, said, op: c.op, p: c.p, words });
        return words >= 3 ? 'Sorry, I didn\'t catch that. Say it again?' : '';
      }
      log('turn_rescued', { handle: this.name, said, op: c.op, as: c.mode });
    }
    if (c.op === 'status') {
      const s: any = await statusCore(this.env, this.#who, { utterance: said });
      if (!s.ok) return s.why || 'I could not look just now.';
      this.#send(connection, { type: 'talk-status', text: s.text, links: s.links });
      return s.text;
    }
    if (c.op === 'change') {
      this.#pending = c;
      this.#send(connection, { type: 'talk-cmd', cmd: c });
      const name = String(c.label || '').split('/').pop();
      return c.mine ? `Send that to the ${name} agents?` : `${name} isn't yours. Want me to fork it first?`;
    }
    if (c.op === 'code') { this.#send(connection, { type: 'talk-cmd', cmd: c }); return c.mine ? 'Reading the code.' : 'I can only read your own projects\' code, so this is from the page.'; }
    const acts = (c.mode === 'act' || c.mode === 'both') && !['none', 'explain'].includes(c.op);
    if (acts && (c.p == null || c.p >= 0.45)) {
      this.#send(connection, { type: 'talk-cmd', cmd: c });
      if (c.mode !== 'both') return line(c);
    } else if (acts && c.p >= 0.2) {
      this.#pending = c;
      this.#send(connection, { type: 'talk-cmd', cmd: { ...c, offer: true } });
      return `Did you mean ${line(c).replace(/\.$/, '').toLowerCase() || 'that'}?`;
    }
    // Questions, explanations, and the answer half of "both".
    const history = (context.messages || []).slice(-8).map((m: any) => ({ role: m.role, content: String(m.content || '').slice(0, 800) }));
    const ch: any = await chatCore(this.env, this.#who, { utterance: said, screen: this.#screen, pageText: this.#pageText, history, did: c.mode === 'both' && acts ? line(c) : '' });
    if (!ch.ok) return ch.why || 'I could not answer that just now.';
    await this.#cost(0.0006);   // glm-4.7-flash, thinking off: ~1.5k in + 100 out per round, 1-2 rounds
    if (ch.actions?.length) this.#send(connection, { type: 'talk-chat', actions: ch.actions });
    log('answer', { handle: this.name, ms: Date.now() - t0, reply_len: (ch.reply || '').length, actions: (ch.actions || []).map((a: any) => a.name) });
    return ch.reply || '';
  }

  /** Every spoken reply is charged as Aura characters (the kit synthesizes it next). */
  async beforeSynthesize(text: string, _connection: Connection) { await this.#cost(text.length / 1000 * (AURA_USD_PER_1K[this.#ttsModel] || 0.015)); return text; }
}
