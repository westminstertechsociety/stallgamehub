Runtime data lives next to this folder and is not committed:

- `leaderboard.json`: every scored run (name, score, game, variant, mode).
- `game-data.json`: per-game persisted data. For Morse this is the fastest recorded run per word (the ghosts).
- `session.json`: selected game, mute and high-contrast flags, so a restart lands where you left off.

Each file gets a `.bak` copy before every write. To reset everything, stop the hub and delete the three files.
To seed ghosts for the fair, play a few Time attack rounds yourself: the best run per word is kept automatically.
