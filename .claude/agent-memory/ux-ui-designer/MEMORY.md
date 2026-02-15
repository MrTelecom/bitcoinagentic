# Bitcoin Agentic - UX/UI Designer Memory

## Project Overview
Bitcoin-native mobile carrier. Phone plans pay Bitcoin cashback in satoshis.
World Mobile infrastructure. Express + SQLite + React 18 SPA (client-side Babel).

## Key Files
- `/root/bitcoinagentic/public/index.html` - Landing page (~1525 lines, vanilla HTML/CSS/JS)
- `/root/bitcoinagentic/public/dashboard.html` - User dashboard SPA (React 18, client-side Babel)
- `/root/bitcoinagentic/public/admin.html` - Admin panel (React 18, client-side Babel)
- `/root/bitcoinagentic/server.js` - Express server on port 5001
- `/root/bitcoinagentic/public/img/` - Image assets directory

## Design System Tokens (from :root variables)
- **Primary:** `--orange: #F7931A`, `--orange-dark: #e07f0e`, `--orange-light: #fbb03b`
- **Navy palette:** `--navy: #0D1B2A`, `--navy-light: #1B2838`, `--navy-lighter: #243447`
- **Grays:** 50/100/200/400/600/800 scale
- **Radius:** `--radius: 12px`, `--radius-lg: 20px`, `--radius-xl: 24px`
- **Max width:** `--max-width: 1200px`
- **Font:** Inter (weights: 400-900)
- **Shadows:** sm/md/lg/xl scale
- **Transition:** `0.3s cubic-bezier(0.4, 0, 0.2, 1)`

## Landing Page Sections (index.html, current state)
1. Nav (fixed, navy bg, blur backdrop, hamburger mobile)
2. Hero (navy, 100vh, 2-col grid: text left + phone right)
3. Trust Bar (white strip, 4 items)
4. How It Works (3-step grid with flat vector illustrations)
5. Stats (bg image overlay, 3 animated counters)
6. Plans (Basic $15 / Pro $30, gray-50 bg with lifestyle bg image)
7. Bitcoin Education (6-card 3-col grid, dark section)
8. Why Bitcoin Mobile (4-card 2-col grid, dark section)
9. FAQ (accordion, light bg)
10. CTA Banner (bg image + dark overlay)
11. Footer

## Image Assets (verified Feb 2026)
- `hero-phone.png` (229KB) - 3D phone, dark bg, orange glow, wallet UI
- `bitcoin-macro-bg.jpg` (376KB) - Macro Bitcoin coin on stone, bokeh
- `cta-network-bg.jpg` (348KB) - Orange network nodes on dark bg
- `plans-lifestyle-bg.jpg` (470KB) - Person in cafe with Bitcoin phone app
- `step-*.png` (3 files, ~100KB each) - Flat 2D vector illustrations
- `icon-*.svg` (4 files) - Recraft-style icons for why-cards
- `hero.png` (5.7MB) - UNUSED, too large
- `bitcoin-cashback.png` / `esim-activate.png` - UNUSED older assets
- `empty-*.png` (2 files) - Dashboard empty state illustrations
- `logo.svg` (24KB) - Brand mark

## Style Issue: step-*.png are flat vector vs hero-phone.png photorealistic. They clash.

## Dashboard: React 18, client-side Babel, mobile-first, bottom tabs
## Admin: Sidebar 240px, topbar 56px, tables/stat cards

## Apple-Level Redesign Spec (delivered Feb 2026)
See detailed spec in conversation. Key: centered hero, 96px headlines, 140-180px section padding, blur reveal animations, glass cards, ambient glow pseudo-elements.

## Image Gen Rules
- Photorealistic -> Replicate `google/nano-banana-pro`
- Text/typography -> Replicate `openai/gpt-image-1.5`
- Icons/logos/SVG -> Recraft V3 (icon or vector_illustration)
- UI illustrations/flat art -> Recraft V3 (digital_illustration)
