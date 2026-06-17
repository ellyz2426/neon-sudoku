# Neon Sudoku VR

A holographic VR Sudoku puzzle game built with [IWSDK](https://iwsdk.dev) (Immersive Web SDK).

## Play

**[▶ Play Now](https://ellyz2426.github.io/neon-sudoku/)** — Works in any browser, with full VR support on Meta Quest.

## Features

- **9×9 Sudoku** with backtracking generator & unique solution verification
- **Seven-segment neon LED** number display per cell (3D BoxGeometry segments)
- **Pencil marks** — 3×3 dot grid per cell for candidate tracking
- **6 game modes**: Classic, Timed, Daily Challenge, Zen, Speed, Practice
- **4 difficulty levels**: Easy (38 clues), Medium (30), Hard (25), Expert (20)
- **Undo/hint/pencil** systems
- **Selection highlighting** — row, column, box, and same-number highlighting
- **Conflict detection** — wrong placements highlighted in red
- **40 achievements** with XP/level progression (50 levels)
- **Top-20 leaderboard** with career stats (12 tracked metrics)
- **5 holodeck themes**: Neon Holodeck, Crimson Arena, Toxic Neon, Ultra Violet, Solar Blaze
- **VR input** — world-space numpad panel, XR controller laser pointer
- **Desktop input** — mouse raycasting, keyboard (1-9, arrows, P/H/Z/ESC)
- **Procedural audio** — 15+ SFX and ambient drone
- **Particle effects** — 120-particle pool with color-coded bursts
- **14 PanelUI spatial panels** — zero HTML DOM overlays

## Tech Stack

- [IWSDK](https://iwsdk.dev) — Immersive Web SDK
- TypeScript
- PanelUI + UIKITML for spatial UI
- Three.js (via IWSDK)

## Development

```bash
npm install
npm run dev
```

## License

MIT
