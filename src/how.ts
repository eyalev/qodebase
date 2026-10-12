// How qodebase works (/how), qb3, 2026-10-12. Eyal: the home page is the product (the build box); the demo, the
// evidence and the numbers live here. Numbers are the README's measured results: change them together.
// Mobbin refs (design-log forq-20261012-2): results as a big number + one line with its source (Airtable, Aqua,
// Duna), steps as a bold lead + one sentence (Beside); numbered step labels are forbidden in DESIGN.md.
import { shell } from './ui';

const REPO = 'https://github.com/eyalev/qodebase';

export function howPage(selfHost = false) {
  const step = (b: string, t: string) => `<li><b>${b}</b><span>${t}</span></li>`;
  const tool = (job: string, won: string, why: string, src: string, href = '') => `<li><span class="tj">${job}</span><b>${won}</b><span class="tw">${why}</span><small>${href ? `<a href="${href}">${src}</a>` : src}</small></li>`;
  const num = (n: string, t: string, src: string) => `<li><b class="n">${n}</b><span>${t}</span><small>${src}</small></li>`;
  const demo = selfHost ? '' : `<section class="hw-sec">
<a class="hw-demo" href="/p/eyal/corner-cafe"><span class="hw-k">A demo you can start, no sign-in. About 2 minutes.</span>
<b class="hw-t">Watch 6 scripted agents change one app at once</b>
<span class="hw-pic" aria-hidden="true"><span class="hw-row"><i class="a1">2</i><i class="a2">4</i><span>both changed <span class="hw-f">style.css</span></span></span><span class="hw-tags"><span class="hw-x">collided</span><span>replayed</span><span>tested</span><span class="hw-ok">landed</span></span></span>
<span class="hw-d">Real commits and real tests on a real copy of a café website. The agents follow a script, so there is no AI cost.</span>
<span class="hw-go">Watch a run</span></a></section>`;
  return shell('How qodebase works', `<h1>How qodebase works</h1>
<p class="desc">Many agents can change one codebase at the same time. Here is what happens when their changes meet, and what we measured.</p>
${demo}
<section class="hw-sec"><h2>Land by intent</h2>
<ul class="hw-steps">
${step('Every agent works on its own copy', 'Each agent edits its own copy of the code, so nobody overwrites anybody while they work.')}
${step('Finished work waits in one line', 'Changes are tested together before they join the main code. Nothing lands untested.')}
${step('A collision is redone, not sent back', 'When two changes touch the same lines, the later one is applied again on the newest code, from what it was asked to do. The agent keeps working.')}
${step('Every change keeps its record', 'What it was asked to do, the diff, the review and the tests, stored with the code in git.')}
</ul></section>
<section class="hw-sec"><h2>The agent board</h2>
<ul class="hw-nums one">${num('40% less time', 'with two teams on one repo: every run with the board was faster, and tasks built twice fell from 3–4 to 0–1.', '6 Claude Haiku agents, 3 runs with the board and 3 without, on qodebase')}</ul>
<p class="desc">Each agent says what it is doing and which files it touches, and a duplicate check runs before work starts, so two agents do not build the same thing.</p></section>
<section class="hw-sec"><h2>What we measured</h2>
<ul class="hw-nums">
${num('12 of 12', 'changes landed in 6 min 43 s from one request on the phone: 12 Claude agents, 7 collisions, none sent back. $0.16 of container time.', 'Real AI agents (Claude Haiku), eyal/cafe-team')}
${num('48%', "of the last 346 pull requests of Hono (a popular open-source web framework) needed another one to land first, when replayed as 100 at once. Git reported no conflicts. The problem is order.", 'Replay of real PRs, no model calls')}
${num('3.5×', 'as many changes landed per hour with land by intent as when each change waits for review and merges one at a time, on real code (403 files) with 500 scripted agents.', 'Simulation: scripted agents, real git and tests')}
${num('7,033', 'git pushes from 500 agents at once, each with its own copy of the code, 280 ms median.', 'Run on Cloudflare: Durable Objects + Artifacts')}
</ul></section>
<section class="hw-sec"><h2>Different jobs need different ways to run agents</h2>
<p class="desc">No one way won everywhere. What won, per job, and how we know:</p>
<ul class="hw-tool">
${tool('Small-to-mid apps (bakery and club sites, 15-minute jobs with several pieces)', 'One strong agent', 'One Opus agent finished 1.9× and 1.6× faster than an Opus planner with a Haiku crew; the crew cost about half at standard API prices.', 'Measured, real AI agents, 2–3 runs each', '/lab')}
${tool('A shared task list with hidden duplicates (60 tasks, 20 agents)', 'The board and a duplicate check up front', 'The only setup with no task built twice (0 of 10 pairs, against 3, 7 and 8 for the others), and the lowest median time and cost.', 'Measured, 20 Claude Haiku agents, 3 runs each')}
${tool('Tasks that arrive during the run', 'A duplicate check on every new task', '88 of 90 arrivals classified right; pairs built twice fell from 10 to 4 to 1.', 'Measured, 10 Claude Haiku agents, 3 runs each')}
${tool('How many agents (150 tasks)', 'A controller that grows the team while landings rise', 'It settled at 10–14 agents and used about a quarter of the agent-minutes and half the cost of a fixed team of 40, and was not slower. With the board it was best: 1,284 s, $4.73, all 150 hidden tests in every run.', 'Measured, Claude Haiku agents, 3 runs each; fixed teams of 8 and 20 were cut by the weekly usage limit, so whether it finds the best fixed size is untested')}
${tool('Two teams on one repo', "The board's check across both lists", '40% less time, 22% cheaper; tasks built twice fell from 3–4 to 0–1.', 'Measured on qodebase, on Cloudflare, 3 runs each')}
${tool("A chain-shaped port (Bun's Zig to Rust: 89% of commits edit lines an earlier commit wrote)", 'Own line ranges, land at once, check behind each commit, fix forward', "Kept Bun's 26.2 hours and cut the time the build was broken by 59–73%; a check that blocks each commit cost 23–92% more time; past 64 agents, no gain.", "Replayed: Bun's real patches; breaks in the middle phases modelled")}
${tool("The same port, cut by module (one owner per file; Bun's line chains stay inside one agent)", "Order modules by the code's own structure, interfaces before bodies", 'The same work in 3.4–5.2 hours at 64 agents instead of 26.2 (5–8×); past 64 agents, no gain. Waiting for whole dependencies instead took 89 hours: 74% of the work is one cycle of modules using each other.', "Simulated from Bun's real structure (108 crates, 1,160 modules, 9,881 use edges); module order checked against the names Bun's real patches use across files (strict order misses 3%; two-phase interfaces-first meets them by construction at no time cost); not replayed; one owner per file and the interface share (10–30%) are assumptions")}
${tool('A big codebase, thousands of agents', 'Lanes by dependency, a controller per lane', 'At 2,000 agents after 6 hours: 1,271 landed an hour against 896 for one queue, a median wait of 10 min against 130, and main never broken. At 10,000 agents over 2 hours: 7,433 an hour against 896 (8×, an upper bound: at 2,000 agents the 2-hour figure overstated the 6-hour one by 1.5×). Lanes that test only their own area left main broken 20–88% of the time, and 8 lanes did worse than one queue.', 'Simulated: real git and real tests, scripted agents, one run per setup')}
${tool('The same, on Cloudflare (Durable Objects and Artifacts)', 'Eight lanes and one door onto main', '2,000 agents for 10 minutes: 30,066 landed against 14,336 for one lane, a median wait of 8 s against 500 s. 16 and 32 lanes landed the same (29,941 and 30,096): from 8 lanes up, the work, not the queue, was the limit, as at 500 agents (about 7,530 with one lane or eight). Main stayed whole and passed its tests in all of these. With 20% of changes crossing areas (16 lanes), the first run broke main twice: a lane that restarted came back without what it had not yet saved. That is fixed; the rerun landed about 29,800 and main passed its tests. 63 of its changes landed twice (the same files, main unaffected); the door onto main should refuse a repeat, and does not yet. One door that takes every lane\'s tested changes into one commit beat each lane pushing to main itself: at 500 agents none of its pushes was refused for a stale main, against 24% of theirs.', 'Run on Cloudflare, scripted agents, one run per setup; landed changes checked against the commits on main')}
${tool('When to switch', 'When one queue saturates', 'One queue lands about 830–900 changes an hour in both simulators, at 500, 2,000 and 10,000 agents alike; past that, more agents only lengthen the wait.', 'Simulated')}
</ul>
<p class="hw-next"><b>Next, not built yet:</b> choose the way per job. qodebase would profile a job first (how many pieces, how much they overlap, which files are hot, how long the chains are, how long a check takes) and pick from this toolbox. When the stakes are high it would run a cheap pilot first, a simulation or a replay of the repo's own history, then adapt live (switch tactics when a queue saturates), compare its estimate with what happened so the next project starts from a better guess, and follow your choice of speed, cost or safety. Today qodebase runs one landing queue per project, with the board and the duplicate check as options.</p></section>
<section class="hw-sec"><h2>See for yourself</h2>
<nav class="hw-doors">
<a href="/lab"><b>The lab</b><span>One strong agent or many? Real jobs, scored by tests the agents never saw.</span></a>
<a href="/sim/"><b>The simulation</b><span>Up to 100,000 agents on a virtual clock.</span></a>
<a href="${REPO}" target="_blank" rel="noopener"><b>The code</b><span>Open source on GitHub (Apache-2.0), with every number and how it was measured.</span></a>
</nav></section>
<p class="hw-back"><a class="chipbtn" href="/">Build something</a></p>
<style>
.hw-sec{margin:28px 0 0}
.hw-sec h2{margin:0 0 8px;font-size:20px;font-weight:600;letter-spacing:-.01em}
/* One green button per screen: Watch a run; the header's Build steps down here. */
body:has(.hw-demo) .gbuild{background:var(--chip);color:var(--fg)}
.hw-demo{display:grid;gap:4px;padding:14px 16px;border-radius:14px;background:var(--card);box-shadow:inset 0 0 0 1px var(--line);color:var(--fg);text-decoration:none;-webkit-tap-highlight-color:transparent;transition:background-color .12s}
.hw-k{font-size:13px;color:var(--dim)}
.hw-t{font-size:19px;font-weight:600;letter-spacing:-.01em;line-height:1.25;color:var(--acc)}
.hw-d{font-size:14px;color:var(--dim)}
.hw-pic{display:grid;gap:8px;margin:6px 0 4px}
.hw-row{display:flex;align-items:center;gap:6px;font-size:14px}
.hw-row i{display:inline-grid;place-items:center;width:26px;height:26px;border-radius:50%;font-style:normal;font-size:13px;font-weight:600;background:var(--busy);color:var(--acc-fg)}
.hw-row i.a2{background:var(--fg);color:var(--bg);margin-left:-10px;box-shadow:0 0 0 2px var(--bg)}
.hw-row>span{margin-left:4px}
.hw-f{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:13px}
.hw-tags{display:flex;flex-wrap:wrap;gap:4px;align-items:flex-start}
.hw-tags span{display:inline-block;flex:none;font-size:12px;line-height:1.4;padding:2px 6px;border-radius:4px;background:var(--chip);color:var(--fg)}
.hw-tags .hw-x{background:color-mix(in srgb,var(--warn) 14%,transparent);color:var(--warn)}
.hw-tags .hw-ok{background:color-mix(in srgb,var(--acc) 14%,transparent);color:var(--acc)}
.hw-go{justify-self:start;display:inline-flex;align-items:center;min-height:44px;padding:0 16px;margin-top:8px;border-radius:10px;background:var(--acc);color:var(--acc-fg);font-size:15px;font-weight:500}
.hw-steps,.hw-nums{list-style:none;padding:0;margin:0}
.hw-steps li,.hw-nums li{display:grid;gap:2px;padding:12px 0;border-bottom:1px solid var(--line)}
.hw-steps li:last-child,.hw-nums li:last-child{border-bottom:0}
.hw-steps b{font-weight:600;font-size:16px}
.hw-steps span,.hw-nums span{color:var(--dim);font-size:15px;line-height:1.45}
.hw-nums.one li{padding-top:4px}
.hw-nums .n{font-size:30px;font-weight:600;letter-spacing:-.02em;line-height:1.1;font-variant-numeric:tabular-nums}
.hw-nums span{color:var(--fg)}
.hw-nums small{font-size:13px;color:var(--dim)}
.hw-tool{list-style:none;padding:0;margin:0}
.hw-tool li{display:grid;gap:2px;padding:12px 0;border-bottom:1px solid var(--line)}
.hw-tool li:last-child{border-bottom:0}
.hw-tool .tj{font-size:13px;color:var(--dim)}
.hw-tool b{font-size:16px;font-weight:600}
.hw-tool .tw{font-size:15px;line-height:1.45}
.hw-tool small{font-size:13px;color:var(--dim)}
.hw-tool small a{color:var(--acc)}
.hw-next{margin:12px 0 0;padding:12px 14px;border-radius:14px;background:var(--card);box-shadow:inset 0 0 0 1px var(--line);font-size:15px;line-height:1.5;color:var(--fg)}
.hw-next b{font-weight:600}
.hw-doors{display:grid;gap:8px}
.hw-doors a{display:grid;gap:2px;padding:12px 14px;border-radius:14px;background:var(--card);box-shadow:inset 0 0 0 1px var(--line);color:var(--fg);text-decoration:none;min-height:44px}
.hw-doors b{font-size:16px;font-weight:600}
.hw-doors span{font-size:14px;color:var(--dim);line-height:1.4}
.hw-back{margin:28px 0 8px}
@media (hover:hover){.hw-demo:hover,.hw-doors a:hover{background:var(--chip)}}
@media (min-width:900px){.hw-nums{display:grid;grid-template-columns:repeat(2,1fr);gap:0 24px}.hw-nums.one{display:block}.hw-nums li{border-bottom:0;border-top:1px solid var(--line)}.hw-doors{grid-template-columns:repeat(3,1fr)}}
</style>`);
}
