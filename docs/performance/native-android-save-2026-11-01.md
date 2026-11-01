# Native Android capture save, 2026-11-01 (S2)

Task perf-save-s2-20261101-26. Follow-up to [native Android startup and interactions](native-android-startup-2026-10-26.md).
Raw files: `/home/dd/scratch/logs/perf-save-s2-20261101-26/`.

## Result

- **Native already shows the saved row sooner than RN: 124 ms vs 189 ms** (medians, 5,000 tasks, n = 18 each).
- **Native's "settled" (338 ms) is the keyboard's hide animation, not the save.** The system slides the keyboard down from about
  22 to 335 ms, and the app draws a frame with each step. RN's keyboard does not slide: it vanishes in two frames at about 170 ms,
  when RN's modal window closes.
- **The exact incremental save (S2b) was not built.** The full-snapshot walk it would remove costs about 12 ms of a 52–88 ms save.
  It cannot move "settled", and it would change persistence in core that RN, desktop and iOS share.
- No code changed. This report corrects the save comparison and closes S2.

## Setup

- Phone: Galaxy S23 `RFCW10JBP0Y`, Android 16. Benchmark builds only, seeded through their debuggable twins.
- Native: main `9cce7e496`, clean (`base`, app SHA-256 `486ca7dd…37ee`). RN: `b27d017a0` with the benchmark-scheme patch, the
  same APK as the 10-26 head to head (`f540d01b…d47e`).
- Fixture: `large-5000-newest.db` (sha256 `7ddda14c…9b64`), newest first, so the new row is in view.
- Runner `save.mjs` (from the 10-26 `h2h.mjs`): per round a fresh seed, then 3 cold starts, and 3 captures saved in each process.
  Each Save tap is traced on its own. After each save, a UI dump checks that the new row is on screen.
- The batch held `gates.lock` and `s23.lock`. Nothing else ran on the phone or the build host. Load 0.56 at the start, 0.17 at
  the end. Battery 79%, thermal status 0.

Metrics, all from the tap's input event in the app:
- **Settled:** the end of the app's last frame before a 250 ms pause (the 10-26 rule).
- **Keyboard hidden:** the last frame of the system's IME insets animation (`system_server`).
- **Row on screen, native:** the end of the first app frame that starts after `core:menuRead` (the visible list read after the
  save) ends.
- **Row on screen, RN:** the end of the frame of the largest UI-thread `animation` callback 100–300 ms after the tap. That is
  Fabric's mount after the JS thread finishes. RN has no markers, so this one is inferred. It equals RN's settled in every sample.

## Where the save's time goes (S2a)

A probe build (main plus trace sections, `probe.patch`, not committed) split `core:captureSubmit`. 9 saves: 3 cold starts × 3 saves.

| Step | ms (9 saves) |
| --- | ---: |
| `core:captureSubmit`, whole | 52–88 |
| Plan the capture (parse) | 1.7–3.5 |
| Store write: `addTasks` before the store update | 4.7–6.1 |
| Store write: the store update and its listeners | 6.6–17.5 (first save in a process: 16–17.5) |
| Other write work (owned context before, parse options rebuilt after) | about 11 |
| Save, whole (`saveData` through COMMIT) | 17.7–45 |
| — rows for every entity (from the row cache) | 2.7–2.9 |
| — task fingerprints and row versions, plus the one changed row's upsert | 5.8–6.4 |
| — omission check over every task id | 4.2–4.3 |
| — COMMIT (fsync) | 3.0–26.4 |

The walk over every row is about 12.5 ms (rows + fingerprints + id check). That is the most an exact incremental save could remove.
The 10-27 first-save warm already removed the large part (row cache and fingerprints, about 180 ms).

## Head to head (interleaved native, RN, RN, native)

| Metric (ms) | Native `9cce7e496` | RN `b27d017a0` |
| --- | ---: | ---: |
| Row on screen, median [min–max] | **124** [104–167] | 189 [171–205] |
| — first save after a cold start | 144 [142–167] | 189 [171–198] |
| — later saves in the same process | 118 [104–153] | 187 [179–205] |
| Settled, median [min–max] | 338 [326–349] | **189** [171–205] |
| Keyboard hidden, median [min–max] | 335 [325–348] | 170 [154–181] |
| `core:captureSubmit` ends | 74 [60–114] | |
| n | 18 | 18 |

New row visible after every save: 36 of 36. Per-round medians agree: native 121 and 129, RN 191 and 189.

Native's settled equals its keyboard-hidden time in every sample (also at 1,000 tasks on 10-26, 335 ms, before any save fix).
The 10-27 warm cut the save by about 165 ms and settled did not move (336 → 338). So settled measures the keyboard's slide.

## Judgment calls

1. **No incremental save.** It saves at most about 12.5 ms of the native row's 124 ms, and nothing of settled. Its fallback set
   (deletes, purges, reference repair, settings, migrations, first save, sync merges) touches the write path of every platform.
   The risk is not worth 12 ms. If the row's time matters later, cheaper work sits outside persistence (next section).
2. **Compare the row, not settled, for save.** The 10-26 report already stopped comparing capture-open "settled" for the same
   reason: native lays out with every keyboard frame. Save has the same cause.
3. **The keyboard's slide is not a performance fix.** Native uses the system's standard animated keyboard hide. RN's instant hide
   comes from closing its modal window. Making native snap the keyboard away would be a UI change, so it is dd's call.
4. **The RN row time is inferred** from its Fabric mount frame. It matches RN's settled in all 18 samples, and the JS thread is busy
   until just before it. A screen recording would confirm it; none was made.

## Remaining save work, if wanted

Ranked by size, none of it in persistence:
- The store update and its listeners: 6.6–17.5 ms, most on the first save in a process.
- `addTasks` builds two id sets and copies the task list before the update: about 5 ms at 5,000 tasks.
- The 7 ms after the store write and before the save, inside `captureSubmit` (mostly the parse options rebuild, inferred: the probe
  had no section for it).
- `core:menuRead` after the save: 22–35 ms before the row's frame.

## Limits

- One phone, n = 18 per app, one batch. The probe build adds trace sections; its timings are not pooled with the head to head.
- The RN build is from 10-26 and was not rebuilt from current main.
