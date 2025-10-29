## Ghost Diamonds — Solo Mode

Designed for the Decentraland Regenesis Lab Hackathon (2025), Ghost Diamonds is a stealth-collection experience focused on tight, readable mechanics and instant player feedback. This repository contains the Solo Mode build.

### Core Idea
Collect diamonds scattered on the ground and save them safely in the central chest — while avoiding ghosts that spot you only when they face you. Movement matters: the more you move, the easier you are to detect.

### Solo Mode Features
- **One diamond per run**: Carry a single diamond at a time; validate it in the chest to score.
- **Instant UI feedback**: Diamond counter updates immediately with a quick flash and synchronized sound.
- **Clear stealth rules**: Ghosts detect you primarily when they face you; vertical hitboxes tuned for fairness.
- **Safe zones**: Platforms with blue flames are safe; you need at least 1 life to collect diamonds.
- **Life system with regeneration**: Lose a life on ghost contact; lives regenerate over time (with catch‑up on reload).
- **Leaderboard display**: Shows top diamond counts. In solo mode, this can still surface your runs if the backend is connected.

### Tech Notes
- Built on Decentraland SDK 7 using an ECS architecture (entity components, frame systems, triggers, and avatar attachments).
- Everything in gameplay/UI was vibe‑coded (from scratch using cursor) specifically for this project — **except the background soundtrack**.

### What’s Next (Planned)
- **Multiplayer synchronization**: Real‑time diamond states and shared leaderboards across players.
- **Special quests**: Time‑limited and location‑based mini‑objectives layered on top of the core loop.

### Credits & Special Thanks
- Soundtrack by Silvio De Candia — Audio Hot Lab. Thank you for the music and support.


