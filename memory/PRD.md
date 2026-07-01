# Aura — Postpartum Companion (PRD)

## Original Problem Statement
An intuitive, empathetic postpartum companion app for new moms. Builds history (kids, delivery, feeding, support), applies research-backed risk scoring (never auto-diagnosing), offers 24x7 empathetic "Talk" support, daily mood check-ins tapering over time, connects nearby moms for urgent talks, surfaces insurance-covered breast pump providers, and helps reduce depression. Soothing on open (quote + beautiful animations). Not a doctor; scores from validated research. "Better than Beacon."

## User Choices (v1)
- Talk AI: **Claude Sonnet 4.6** (empathetic companion)
- Risk scoring: **EPDS** (Edinburgh Postnatal Depression Scale, Cox et al. 1987) + daily mood check-ins — informational, non-diagnostic
- Connect moms: local community feed + peer chat (seeded moms)
- Breast pump: curated insurance-covered provider directory
- Accounts: simple **local device profile** (no login)

## Architecture
- **Frontend**: Expo Router (SDK 54), custom fonts (Fraunces display, Quicksand text), reanimated animations, expo-image, expo-linear-gradient, expo-haptics. Bottom tabs: Today / Talk / Circle / Journey / Care. Design: "Hand-Drawn / Journal" — warm oat/terracotta/sage palette, no blues/purples, solid surfaces.
- **Backend**: FastAPI + MongoDB (motor). Endpoints: profile, mood(+today), epds(questions/submit/history), chat (Claude via emergentintegrations), community(feed/post/like/comments), quote/tips/helplines/pump-providers. Seeds community posts on startup.
- **Personas**: New mother (0–12 months postpartum) seeking support, self-awareness, and connection.

## Implemented (2026-07-01)
- 8-step gentle onboarding (name, history: children/weeks postpartum, delivery type, birth experience, feeding, support level, first mood + concerns) → local profile.
- Today dashboard: daily quote hero (watercolor + scrim), daily mood check-in CTA/done card, quick actions, gentle care tips.
- Talk: empathetic Claude Sonnet 4.6 chat with profile context, prompt chips, persistent history, safety escalation persona.
- Journey: mood stats + 14-check-in chart, EPDS latest result + band interpretation, journal notes, log-mood/EPDS entry.
- EPDS screener: 10 validated questions, banded result (low/possible/likely), **self-harm safety card (988)**, resource links.
- Daily check-in modal: mood, energy, sleep, tags, note.
- Circle (community): seeded feed, topic filter chips, create post, like, thread + peer comments.
- Care: crisis + maternal support helplines (988, PPSI, National Hotline), insurance-covered breast pump directory (Aeroflow/Byram/Edgepark/1NW), profile summary, disclaimer.
- Breathe: animated 4-4-6 breathing exercise.
- Tested: 18/18 backend pytest + full frontend e2e, all passing. Live Claude confirmed.

## Backlog
- **P1**: Real geolocation-based mom matching (permission-gated); direct 1:1 peer messaging; adaptive check-in cadence (daily → every few days) with reminders; save/bookmark tips.
- **P1**: Timezone-aware mood-today query; toast on profile-save failure.
- **P2**: Partner/family support mode; lactation consultant directory; audio-guided meditations (expo-audio); trend insights/weekly summary; export wellbeing report for provider; multi-language.
- **P2**: Streaming chat responses (SSE via expo/fetch).

## Next Tasks
- Adaptive daily check-in cadence + gentle reminders.
- 1:1 peer messaging in Circle.
