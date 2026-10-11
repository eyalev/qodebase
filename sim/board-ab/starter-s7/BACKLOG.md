# Backlog

Each task: implement the function in its own module `src/<function name>.js` (named export), re-export it from
`src/index.js` (one line per module, alphabetical), add a test in `test/`, and add a line to `CHANGELOG.md`.
Keep `npm test` green. A task is done when its code is on `main`.

- **T1** In `src/pad10.js`: `pad10(n)` takes a non-negative integer and returns it as a string with leading zeros up to 10 digits (longer numbers unchanged).
- **T2** In `src/roundTo6.js`: `roundTo6(x)` returns the multiple of 6 nearest to the number x; exactly half-way goes up (towards +∞).
- **T3** In `src/everyNth3.js`: `everyNth3(text)` returns the characters at positions 0, 3, 6, … of the text, as a string.
- **T4** In `src/clamp2.js`: `clamp2(x)` returns x limited to the range -2…2 (values below become -2, above become 2).
- **T5** In `src/echo9.js`: `echo9(text)` repeats every word 9 times (words separated by any whitespace) and joins all of them with single spaces.
- **T6** In `src/shiftBy6.js`: `shiftBy6(text)` moves every letter 6 places forward in the alphabet, wrapping around after z (and Z), keeping upper and lower case; every other character stays as it is.
- **T7** In `src/clamp1.js`: `clamp1(x)` returns x limited to the range -1…1 (values below become -1, above become 1).
- **T8** In `src/roundTo2.js`: `roundTo2(x)` returns the multiple of 2 nearest to the number x; exactly half-way goes up (towards +∞).
- **T9** In `src/chunks10.js`: `chunks10(arr)` splits an array into consecutive arrays of 10 elements; the last one may be shorter; an empty array gives `[]`.
- **T10** In `src/clamp6.js`: `clamp6(x)` returns x limited to the range -6…6 (values below become -6, above become 6).
- **T11** In `src/multiplesOf8.js`: `multiplesOf8(n)` returns an array of the first n positive multiples of 8 (`[8, 16, …]`; `[]` for 0).
- **T12** In `src/rotateLeft6.js`: `rotateLeft6(arr)` returns a new array rotated left by 6 positions (by 6 modulo the length; an empty array stays empty).
- **T13** In `src/clamp4.js`: `clamp4(x)` returns x limited to the range -4…4 (values below become -4, above become 4).
- **T14** In `src/chunks9.js`: `chunks9(arr)` splits an array into consecutive arrays of 9 elements; the last one may be shorter; an empty array gives `[]`.
- **T15** In `src/shiftBy2.js`: `shiftBy2(text)` moves every letter 2 places forward in the alphabet, wrapping around after z (and Z), keeping upper and lower case; every other character stays as it is.
- **T16** In `src/maskTail3.js`: `maskTail3(s)` replaces every character with `*` except the last 3 (strings of 3 characters or fewer are unchanged).
- **T17** In `src/firstWords5.js`: `firstWords5(text)` returns the first 5 words of the text (words are separated by any run of whitespace) joined by single spaces; fewer if the text has fewer.
- **T18** In `src/shiftBy7.js`: `shiftBy7(text)` moves every letter 7 places forward in the alphabet, wrapping around after z (and Z), keeping upper and lower case; every other character stays as it is.
- **T19** In `src/roundTo4.js`: `roundTo4(x)` returns the multiple of 4 nearest to the number x; exactly half-way goes up (towards +∞).
- **T20** In `src/roundTo7.js`: `roundTo7(x)` returns the multiple of 7 nearest to the number x; exactly half-way goes up (towards +∞).
- **T21** In `src/limit2.js`: Volume control: `limit2(v)` keeps a number between minus 2 and plus 2, cutting anything outside to the nearest end.
- **T22** In `src/hardWrap3.js`: `hardWrap3(text)` inserts a newline after every 3 characters of the text (none at the very end).
- **T23** In `src/longWords9.js`: `longWords9(text)` counts the words with more than 9 letters, where a word is a maximal run of the letters a-z / A-Z.
- **T24** In `src/clamp5.js`: `clamp5(x)` returns x limited to the range -5…5 (values below become -5, above become 5).
- **T25** In `src/multiplesOf9.js`: `multiplesOf9(n)` returns an array of the first n positive multiples of 9 (`[9, 18, …]`; `[]` for 0).
- **T26** In `src/ngrams8.js`: `ngrams8(text)` returns every substring of exactly 8 characters, in order of position (`[]` if the text is shorter).
- **T27** In `src/firstWords6.js`: `firstWords6(text)` returns the first 6 words of the text (words are separated by any run of whitespace) joined by single spaces; fewer if the text has fewer.
- **T28** In `src/cycleBy6.js`: Turn order: `cycleBy6(list)` moves the first 6 elements to the end, one by one (so the shift wraps around for short lists), returning a new list.
- **T29** In `src/pad5.js`: `pad5(n)` takes a non-negative integer and returns it as a string with leading zeros up to 5 digits (longer numbers unchanged).
- **T30** In `src/shiftBy10.js`: `shiftBy10(text)` moves every letter 10 places forward in the alphabet, wrapping around after z (and Z), keeping upper and lower case; every other character stays as it is.
