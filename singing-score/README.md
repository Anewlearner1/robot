# 唱歌評分 (singing-score)

Mobile-first PWA that scores an a cappella take on 音準 / 節奏 / 氣息 / 顫音 and charts progress per song.
Everything runs on the phone: no backend, audio is analysed in a Web Worker and discarded; only scores are kept in IndexedDB.

```bash
npm install
npm run dev        # http://localhost:5173 (microphone needs localhost or HTTPS)
npm test           # vitest: unit + synthetic end-to-end pipeline tests
npm run build      # tsc + vite build + service worker → dist/
```

## Layout

| Path | What |
| --- | --- |
| `src/types.ts` | Shared contracts between all modules |
| `src/analysis/` | Pitch (pitchy/MPM), voicing, note segmentation, onsets, key detection — thresholds in `config.ts` |
| `src/scoring/` | Four scores, weighted total, problem passages — thresholds in `config.ts` |
| `src/pipeline.ts` | `analyze()` = analysis → scoring → 50 ms pitch summary |
| `src/audio/` | Raw-voice recorder (AudioWorklet), tap tempo, analysis Web Worker |
| `src/storage/` | Dexie/IndexedDB records, JSON export/import |
| `src/pages/`, `src/components/` | 練唱 flow, report, 進步 page, charts (uPlot) |

## Deploy

`.github/workflows/singing-score.yml` tests and builds on every PR and deploys `dist/` to GitHub Pages from the repo's default branch
(one-time: repo Settings → Pages → Source: GitHub Actions).

## Still to do by hand (PRD milestones)

- **M1** – record on a real iPhone (Safari) and Android (Chrome); check a steady tone against a tuner (≤ 10 cents).
- **M2** – collect ~20 real takes, tune `src/analysis/config.ts` and `src/scoring/config.ts` until 5 good vs 5 bad takes rank as they sound.
- **M4** – two weeks of personal use, ≥ 5 takes of one song.
