// One way to turn Web Speech results into text, for every in-page mic (home prompt box, /build).
// Android Chrome sends cumulative results ('I', 'I want', 'I want to', … as separate entries) and can repeat a
// final; desktop Chrome sends separate pieces ('I want to build', ' a shopping list'). Rebuild from all results
// on every event: a result whose start matches most of the text so far (a revision: 'I want to be' -> 'I want to build') replaces it, one already inside it is skipped,
// anything else is a new piece (Eyal, 2026-10-12: the box filled with 'II wantI want to…').
// Inlined as source into the pages' scripts; tested in src/speechjoin.test.mjs.
export const JOIN_SPEECH = `function joinSpeech(results){let out='';for(let i=0;i<results.length;i++){const tr=((results[i][0]||{}).transcript||'').trim();if(!tr)continue;const lo=out.toLowerCase(),lt=tr.toLowerCase();let cp=0;while(cp<lo.length&&cp<lt.length&&lo[cp]===lt[cp])cp++;if(!out||cp>=0.6*Math.min(lo.length,lt.length))out=lt.length>=lo.length||!lo.startsWith(lt)?tr:out;else if(lo.includes(lt))continue;else out=out+' '+tr;}return out;}`;
