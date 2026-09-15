# Tech Society game hub

An offline game hub for the stall. One laptop is the host: it runs this server and drives the projector. Two laptops are the players: they open the host's address in a browser and play with the space bar. Your phone is the control panel. A narrator (rendered offline with Kokoro, British voice) reads the pioneer captions on the projector and talks to the players during rounds.

Everything runs on the host. No internet is needed at the fair.

## Screens

| Screen | Where | Address |
| --- | --- | --- |
| Projector | host laptop, fullscreen | `http://localhost:3000/display` |
| Player 1 | left laptop, kiosk browser | `http://HOST-IP:3000/play?seat=P1` |
| Player 2 | right laptop, kiosk browser | `http://HOST-IP:3000/play?seat=P2` |
| Control | your phone | `http://HOST-IP:3000/control` |

`http://HOST-IP:3000/` shows these links with the host's real address filled in.

## Before the fair (needs internet once)

```bash
npm install -g pnpm   # once, if pnpm is not installed
pnpm install
pnpm build
pnpm test
```

Node 22 or newer. After `pnpm build` nothing is fetched from the network again: fonts, scripts and content are all in the repo.

Windows: PowerShell blocks scripts by default, so run the `.ps1` scripts as `powershell -ExecutionPolicy Bypass -File .\scripts\run-forever.ps1`. The first time the hub starts, Windows asks whether to allow Node through the firewall: allow it on private and public networks, or the player laptops and the phone will not reach the host. If the stall Wi-Fi shows as "Public", either allow Node on public networks or mark the network as private.

## Find the host IP

Connect the host to the stall access point first.

- macOS: `ipconfig getifaddr en0` (Wi-Fi is usually `en0`; try `en1` if empty).
- Windows: `ipconfig`, read "IPv4 Address" under the Wi-Fi adapter.
- Linux: `ip -4 addr show | grep inet`.

The hub also prints every address it is listening on when it starts, and shows them on `/control`.

Give the host a fixed address on the access point (a DHCP reservation for its MAC address, or a static IP) so the player laptops never point at a dead address.

## Start the hub

```bash
pnpm start
```

or, for the whole day, the supervisor loop that restarts the hub within a second if it ever exits:

```bash
./scripts/run-forever.sh                                            # Linux, macOS
powershell -ExecutionPolicy Bypass -File .\scripts\run-forever.ps1  # Windows
```

If the hub keeps failing the loop backs off up to 30 s between attempts and says so; the reason is in `logs/hub.log`.

The server binds to `0.0.0.0:3000`. Change the port in `config/hub.json` (needs a restart).

## Kiosk browsers

Chrome or Edge, one locked-down window per screen, reopened if closed:

```bash
./scripts/kiosk.sh display                                 # host laptop
./scripts/kiosk.sh play P1 http://HOST-IP:3000             # left laptop
./scripts/kiosk.sh play P2 http://HOST-IP:3000             # right laptop
```

Windows: `powershell -ExecutionPolicy Bypass -File .\scripts\kiosk.ps1 display` and `... kiosk.ps1 play P1 http://HOST-IP:3000`. If the hub runs on another port, pass its origin: `./scripts/kiosk.sh display http://localhost:3010`.

The flags the scripts use, if you prefer to launch by hand:

```
--kiosk URL --user-data-dir=/tmp/hub-kiosk-P1 --no-first-run --noerrdialogs
--disable-session-crashed-bubble --disable-infobars --overscroll-history-navigation=0
--disable-pinch --autoplay-policy=no-user-gesture-required
--unsafely-treat-insecure-origin-as-secure=http://HOST-IP:3000
```

The last flag matters: the hub runs on plain http, and Chrome only allows keyboard lock and screen wake lock on "secure" origins. The flag whitelists the host for this profile only; the pages then ask for both (wake lock keeps the screen on, keyboard lock captures Escape, F11 and Tab while fullscreen). Chrome ignores flags it does not know, so the list works across versions.

What the browser cannot swallow: Alt+F4, Alt+Tab, the Windows key, Cmd+Space, Ctrl+Alt+Del. The kiosk script reopens the page in a second if someone closes it, and the page reclaims its seat on reload. On Windows, turn off Sticky Keys and Filter Keys shortcuts (Settings, Accessibility, Keyboard) so five taps of Shift do not pop a dialog. On a Mac, disable the Spotlight shortcut (System Settings, Keyboard, Keyboard Shortcuts, Spotlight).

## Disable sleep

macOS: System Settings, Displays, Advanced, "Prevent automatic sleeping on power adapter when the display is off" on; Lock Screen, "Turn display off" to Never. Or run `caffeinate -dims` in a terminal and leave it open.

Windows: `powercfg /change standby-timeout-ac 0` and `powercfg /change monitor-timeout-ac 0` in an admin prompt; Settings, System, Power, "Lid close" to "Do nothing".

Linux: `systemd-inhibit --what=idle:sleep:handle-lid-switch sleep infinity` in a terminal, or the desktop's power settings.

Plug every laptop in. Forget every other Wi-Fi network on the three laptops and the phone so nothing roams off the stall access point when it notices there is no internet. On the phone also turn mobile data off while you use `/control`, otherwise the phone may quietly route around the "no internet" Wi-Fi and lose the hub.

## How a round starts

Press space on a laptop to wake the projector, then press space again to confirm the seat. Eight seconds later the round starts: one confirmed seat plays **Learn** (one letter at a time, narrated), two confirmed seats play **head-to-head**. A second player confirming during the countdown turns a solo start into a race. This is `lobby.quickStart` in `config/hub.json`; set `soloVariant` to `timeattack` or `ghost` to change what a lone player gets, or set `quickStart` to `false` to bring back the on-screen picker.

## The narrator

`config/narration.json` holds every line the projector says, grouped by moment (`lobby.wake`, `countdown.versus`, `trivia`, `wrong`, `results.learn` and so on; several variants per key rotate). Pioneer bios come from `speak` in `public/attract/manifest.json`. After editing either file, with internet available once:

```bash
pnpm voice        # renders changed lines with Kokoro into public/voice (MP3 if ffmpeg is installed)
```

The first run downloads the Kokoro model (about 90 MB) into the Hugging Face cache; later runs are offline. The voice is `bf_emma`; `bf_isabella`, `bf_alice` and `bf_lily` are the other British options. Clips play from the host laptop's speakers through the projector page, so plug the host into the hall speakers if you have them. The kiosk launch flag lets audio start without a click; on a plain Chrome window click the projector page once when it asks. "Mute" on `/control` silences the narrator and the key beeps together. If a clip is missing the browser's own British voice reads the line instead.

## Portraits

`pnpm portraits` downloads a portrait for every card in the manifest that names a Wikipedia page (`wiki`) and fills in the Commons credit. The nine are committed already; to swap one, change `wiki` (or point `image` at your own file) and rerun. Each card's `headline` is the sentence on screen and `speak` is what the narrator reads.

## Control panel

`/control` on your phone: pick the game, start, skip, end round, force attract mode, reset a stuck seat, mute, high contrast, reload content, clear the leaderboard, clear the ghosts and hard reset (the last three need a press-and-hold). It shows which laptops are connected, their latency, the content status and the last error count.

On the projector, `Ctrl+Alt+Shift+R` also hard-resets the session.

`/control` has no password. Anyone on the stall Wi-Fi who knows the address can open it. The access point is yours, so that is acceptable; keep the network name unremarkable.

## Files you can edit on the day

No code. Save the file, then press "Reload content" on `/control`.

- `config/hub.json`: phase timings (solo countdown, results hold, idle time to attract, pause grace), hold lengths, attract card time, reduced-motion flag, beep pitches, high-contrast flag, leaderboard sizes. Port and host need a restart.
- `config/morse.json`: Morse timings and the word list (see below).
- `public/attract/manifest.json`: the pioneers. Each card has `name`, `year`, `headline` (the on-screen sentence, name included, keep it under 20 words), `speak` (the narration), `image`, `wiki` and `credit`. A missing image shows a typographic card instead of breaking the loop. A card stays up for as long as its narration runs.
- `config/narration.json`: everything the narrator says. Rerun `pnpm voice` after editing.

Reloaded game timings apply from the next round, never mid-round. A manifest with a typo is ignored and the projector keeps the previous cards; `/control` shows the error. Content edits never need a build. Only code changes do: stop the hub first (`pnpm build` while the hub is running will crash it), build, start again.

## Playtesting the Morse timings

Everything is in `config/morse.json`, in units of `unitMs` (200 ms by default).

| Constant | Default | Effect |
| --- | --- | --- |
| `unitMs` | 200 | The base unit. Bigger is easier everywhere. |
| `dotMaxUnits` | 1 | A press shorter than this many units is a dot, otherwise a dash. |
| `letterGapUnits` | 3 | Silence this long ends the letter. |
| `wordGapUnits` | 7 | Silence this long highlights the next letter on the cheat sheet. |
| `maxSymbolsPerLetter` | 6 | A letter with this many symbols is committed whatever it is. |
| `stuckPressUnits` | 10 | A press longer than this is thrown away (a bag on the space bar). |
| `bestOf` | 10 | Words per match (head-to-head ends when one player has won six). |
| `wordTimeLimitMs` | 45000 | Nobody finishes in this time: the word ends. |
| `betweenWordsMs` | 2500 | Pause after a word before the next one. |
| `learn.letterGapUnits` | 5 | Learn mode gets longer gaps. |
| `learn.count` | 10 | Letters per Learn session. |
| `words` | 49 words | 3 to 5 capital letters each. |

Too hard, people keep getting dashes they meant as dots or letters commit while they are still thinking: raise `unitMs` to 250 or 300 (this scales everything), or raise `letterGapUnits` to 4.

Too easy, or good players are waiting for letters to commit: lower `letterGapUnits` to 2 or `unitMs` to 160.

Dots and dashes feel inverted for fast tappers: lower `dotMaxUnits` to 0.8. For slow, careful people raise it to 1.2.

Rounds drag: lower `bestOf` to 5 or `wordTimeLimitMs` to 30000.

A wrong letter is never appended: it flashes on the player's screen with the letter they made, and their word resets to nothing, so progress on the projector is always a correct prefix keyed without a mistake. Play a round in Learn mode with someone who has never seen Morse before you tune anything: that is the audience.

To seed ghosts, play a few Time attack rounds yourself before the fair. The fastest run per word is kept in `data/game-data.json` and replayed in the second lane of Ghost race.

## Game two: Human or AI

A short piece of text on the projector, written by a person in 1999–2002 or generated by a model. Space is the AI buzzer; silence means "a human wrote this". Correct buzz +1, wrong buzz −1 and locked out for that item, silence 0. Head-to-head adds +1 for the first correct buzz. Nine items a match, one shared clock per item shown as a draining bar, a six-second reveal with one authored sentence explaining the tell. Learn mode has no clock: tap space for AI, hold space for human, the tell shows at once.

Pick it on `/control` (the quick-start lobby works the same way). Settings live in `config/human-or-ai.json`; the deck is `decks/human-or-ai.json`.

### The deck pipeline

The human half comes from the CMU Enron corpus (email from 1999–2002, so provably written before language models existed): only mail people sent themselves, bodies only, anonymised with neutral first names, and anything dated, personal, financial, jargon-heavy or sensitive is skipped rather than redacted. The AI half is one counterpart per human item, matched on purpose, length, register and formatting, written by a rotation of cheap models at varied temperature. Difficulty is estimated by asking several cheap models to guess, and a small Claude model drafts a first tell for each item.

```bash
pnpm deck               # everything that has no cache yet (downloads ~420 MB once into .deckwork/)
pnpm deck --humans      # reselect the human half
pnpm deck --generate    # regenerate AI counterparts
pnpm deck:review        # print every item as a checklist to read and veto
```

Needs `OPENROUTER_API_KEY` in `.env` for the generation, calibration and tell stages; a full run costs a few cents. Hand edits to `tell`, `durationMs` and `difficulty` in the deck survive re-runs. Duration starts at `min(15, max(6, 3 + words × 0.25))` seconds. To veto an item, delete it from the deck file.

## Leaderboard and data

No initials or names are collected: the leaderboard holds anonymous times only (`leaderboard.names` in `config/hub.json` turns the three-letter entry back on if you ever want it). `data/leaderboard.json`, `data/game-data.json` (ghost runs) and `data/session.json` survive restarts. Every write goes to a temp file, is synced, then renamed into place, with the previous version kept as `.bak`. If a file is ever damaged the backup is loaded and the damaged copy is kept as `.corrupt-<time>`. "Clear leaderboard" and "Clear ghosts" on `/control` reset them; deleting a file while the hub is stopped also resets it (a missing file is treated as deliberate, so the backup is not restored). `http://HOST-IP:3000/api/leaderboard` returns the whole leaderboard as JSON if you want to show it elsewhere.

## Pre-fair checklist

1. Host on the stall access point with a fixed IP. Player laptops and the phone on the same network. Other networks forgotten.
2. Sleep, screen-off and lid-close sleep disabled on all three laptops. Everything on mains power.
3. `pnpm build` done on the host with the final content. `pnpm start` or the supervisor loop running. `http://localhost:3000/health` answers `{"ok":true}`.
4. Projector: `/display` in kiosk mode. Check the attract loop cycles and the type is readable from the back of the hall. If the projector washes out, turn on "High contrast" on `/control`.
5. Each player laptop: `/play?seat=P1` and `?seat=P2` in kiosk mode. The seat chip on screen matches the laptop's position. Press space: a beep and the projector waking are the sign the whole chain works. Volume up.
6. Phone: `/control` shows both seats connected with a latency under about 50 ms.
7. `node scripts/smoke.mjs http://HOST-IP:3000` passes (run it from the host before opening the player kiosks: it takes both seats, plays fake rounds on its own and cleans up after itself when the leaderboard was empty).
8. Play one Learn round, one Time attack and one head-to-head yourself. Enter names. Check the leaderboard card in the attract loop.
9. Close a player laptop's lid mid-round and open it again: the projector should say who is reconnecting, then resume.
10. Know the recovery moves: "Reset P1/P2" on `/control` for a confused seat, "Hard reset" for a confused session, the kiosk scripts reopen a closed browser, the supervisor loop restarts a crashed hub. Logs are in `logs/hub.log`.

## Adding a game

A game is one folder under `games/` and one line in each registry.

- `games/<id>/server.ts` exports a `GameModule` (see `games/types.ts`): `init`, `onInput`, `onTick`, `outcome`, `displayView` and a per-seat `playerView`. Pure functions over your own state; the hub owns the clock, the seats, pauses, results and the leaderboard. Declare `variants` (solo flavours and a versus variant) and `keys`, the `KeyboardEvent.code` values you want. Put `serverMarker: SERVER_MARKER` on the module; the build fails if it ever reaches the browser.
- `games/<id>/views.tsx` exports `{ Display, Player }` React components typed to the two view payloads.
- `games/<id>/shared.ts` holds the types and constants both sides need. Never import `server.ts` from a view; the lint rule and the post-build check will catch it.
- `config/<id>.json` is validated with the module's `configSchema` and handed to `init` as a frozen snapshot each round.
- Register in `games/registry.server.ts` and `games/registry.client.ts`.

`games/press-space` is the smallest possible example; `games/morse` shows recording, ghosts and a per-seat view.

Seat identity on any screen is colour plus fixed position plus a text label, never colour alone.

## Development

```bash
pnpm dev          # tsx watch + Next dev on 0.0.0.0:3000 (LAN devices allowed via allowedDevOrigins)
pnpm test         # reducer, decoder and game-flow tests
pnpm lint
pnpm typecheck
pnpm build        # production build + server-code-in-browser tripwire
pnpm smoke        # socket-level end-to-end check against a running hub
```

Run the production build at the stall, never `pnpm dev`.
