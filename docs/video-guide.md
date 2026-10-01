# Making forq's workflow videos

From a research pass on 2026-10-02 (sources: BBC and Netflix subtitle guides,
ShowTime, Tella, Screen Studio, Arcade benchmarks, Wistia retention data, W3C WAI,
UIST'98 video guide, ffmpeg H.264 wiki). The spec forq's videos follow:

- **Capture:** 390×844 viewport, deviceScaleFactor 2, 30 fps.
- **Master:** 1920×1080. The phone at full height on the left, a thin rounded
  frame (no device skin), quiet solid background. Captions and chapter titles
  in the empty space to the right, never over the UI.
- **Taps:** a 44 px circle (in 390-wide space), 3 px outline in the accent,
  ~45% fill, white edge; appears on press, holds ~300 ms, shrinks and fades
  over ~250 ms. No drawn hands. Typing: fill the field and say so in the caption.
- **Pacing:** captions stay max(1.2 s, 0.33 s/word, ~15 chars/s), at most 7 s;
  hold 1.5–2 s on each result; ≥ 0.5 s of still frame between chapters.
- **Zoom:** at most 1.5–2×, eased 400–600 ms, only to read a detail, one per
  step, no panning while zoomed.
- **Waits:** cut what is static; speed up agent work 4–16× with a visible badge
  ("×8, real time 3:40"); over ~2 minutes, a "4 minutes later" card. Never hide
  that time was compressed.
- **Captions:** ~30 px semibold at 1080p, ≤ 2 lines of ≤ 42 characters, white
  on a 75% dark box; burned in, plus an .srt.
- **Structure:** a 3 s title card showing the end result, 3–6 chapters, a 3 s
  end card with the URL; 60–90 s per workflow, 9–12 steps, never over 3 min.
- **Encode:** `-c:v libx264 -preset slow -crf 18 -tune stillimage -pix_fmt yuv420p -profile:v high -r 30 -movflags +faststart`
  (`-tune animation` for scroll-heavy or sped-up clips); even dimensions.
- **Amateur tells to avoid:** idle or jumping pointers, real-time typing or
  loading, deep or lingering zooms, important things at the frame edge,
  captions over the UI, saying the same thing twice, no script.
