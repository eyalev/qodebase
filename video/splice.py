#!/usr/bin/env python3
"""Replace the end of a recording with another short recording.

  python3 splice.py frames/<main> frames/<tail> "<caption that starts the replaced part>" [lead_s]

Everything in <main> from `lead_s` seconds (default 1.5) before that caption
onward is dropped; <tail>'s frames and events follow, shifted in time. Used when
a final scene was filmed wrong and the state that produced the rest cannot be
recreated (W3: the fixed URL was opened before the new version propagated).
"""
import json, os, shutil, sys

def main(main_dir, tail_dir, caption, lead=1.5):
    m = json.load(open(os.path.join(main_dir, 'timeline.json')))
    t = json.load(open(os.path.join(tail_dir, 'timeline.json')))
    cut = next(e['t'] for e in m['events'] if e['type'] == 'caption' and e['text'].startswith(caption)) - lead
    m['events'] = [e for e in m['events'] if e['t'] < cut]
    m['frames'] = [f for f in m['frames'] if f['t'] < cut]
    # Start the tail at its first frame that shows the page (skip about:blank).
    t0 = t['frames'][min(1, len(t['frames']) - 1)]['t']
    shift = cut - t0
    for f in t['frames']:
        if f['t'] < t0: continue
        name = 'tail-' + f['file']
        shutil.copy(os.path.join(tail_dir, f['file']), os.path.join(main_dir, name))
        m['frames'].append({'t': f['t'] + shift, 'file': name})
    for e in t['events']:
        m['events'].append({**e, 't': max(e['t'] + shift, cut)})
    json.dump(m, open(os.path.join(main_dir, 'timeline.json'), 'w'), indent=1)
    print(f'spliced at {cut:.1f}: {len(t["frames"])} frames, {len(t["events"])} events from {tail_dir}')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4]) if len(sys.argv) > 4 else 1.5)
