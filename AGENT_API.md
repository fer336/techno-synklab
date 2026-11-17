# Agent control API

An AI agent (or any script) can drive the mixer through the local server. The audio lives in the
browser tab, so the server only relays commands.

1. Start the server and open the app in the browser (keep the tab visible; background tabs throttle timers).
2. Tick **PERMITIR CONTROL POR AGENTE (API local)** in the Auto DJ panel. It is off by default and remembered.
3. Send commands with HTTP. Local only: loopback clients, `localhost` Host header, same-origin checks.

```bash
curl -s localhost:8000/api/agent/status
curl -s -X POST localhost:8000/api/agent/command -H 'content-type: application/json' \
  -d '{"action":"set_control","args":{"deck":"A","name":"Low","value":-12,"ms":4000}}'
```

Response: `{"ok":true,"result":...}` or `{"ok":false,"error":"..."}`. Optional `"timeout"` (seconds, default 30).

## Events (agent reads)

`GET /api/agent/events?after=<seq>&wait=25` returns `{"events":[{seq,type,data}],"last":N}` (long-poll).
Types: `track_ending` (~70 s before the end, with `next`), `transition_start`, `transition_end`,
`set_ended`, `prepared`.

## Actions

| action | args | notes |
|---|---|---|
| `state` | – | decks, controls, queue, tracks, transition progress |
| `list_tracks` | – | per track: bpm, key, beatgrid reliability, tonal (key/bass), intro |
| `analyze` | `force?` | decodes every file track: BPM, beatgrid, key, bass, intro |
| `plan_set` | – | suggested order with per-pair notes (BPM delta, key compat, bass delta) and opener candidates; does not apply |
| `apply_plan` / `set_order` | – / `ids[]` | reorder the queue |
| `start` | `first_id?`, `prepare?` | analyze (default) then start Auto DJ |
| `stop`, `next` | `next` accepts `plan?`, `fade?` | `next` mixes now, bar-aligned when a beatgrid exists |
| `plan_transition` | `fade` 4–60, `eq` off/bass/blend, `fx` off/echo/reverb/flanger/random, `fx_amount` 0–100, `filter`, `next_id`, `from_id`, `repeat` | applies to the **next** transition only (unless `repeat`); `next_id` moves that track next in the queue; `from_id` (the ending track) rejects the plan with an error if that track's transition already started, and a pending plan made for another track is discarded |
| `clear_plan` | – | |
| `set_auto` | `fade` 8/16/24/32/48, `eq`, `fx`, `filter`, `sync`, `phrase`, `auto_gain` | defaults used when no plan is set |
| `load` / `play` / `pause` / `seek` | `deck`, `id` / `deck` / `deck` / `deck`,`seconds` | |
| `set_control` | `deck`, `name` (Hp Lp Low Mid High Echo Reverb Flanger Rate), `value`, `ms?` | `ms` ramps smoothly |
| `kill` | `deck`, `band` low/mid/high, `on` | |
| `pad` | `deck`, `name` throw/sweep/brake/echo_out | |
| `crossfade` | `value` 0–100, `ms?` | stops Auto DJ, like moving the fader by hand |
| `loop` / `jump` / `cue` | `deck`, `beats` / `deck`,`beats` / `deck`,`index`,`delete?` | |
| `set_track` | `id`, `bpm?`, `key?`, `energy?` | typing a BPM recomputes the beatgrid |

## Typical agent loop

1. `analyze`, `plan_set`, review, `apply_plan`, `set_auto`, `start`.
2. Wait for `track_ending`; read `state` and the next track's `list_tracks` entry; decide
   `plan_transition` (long blend for compatible keys/BPM, short echo-out for a BPM clash, bass-swap when both are bass heavy...).
3. During a transition, optionally add `set_control` ramps or `pad` effects on top.

## Phrase mixing

With `phrase` on (default), each track gets an energy map per 16-beat phrase (needs a reliable beatgrid; built by `analyze`/`start`). The outgoing track hands over at the first phrase boundary, after half the track, where its energy drops (breakdown/outro), instead of at the very end; `track_ending` is counted to that point. The incoming track enters at its first phrase with the bass on and a level within 3 dB of the outgoing one, so intros are skipped. `transition_start` reports `from_s` and `entry_s` (seconds). Without a map or beatgrid, tracks start at the beginning and play to the end as before.

## Tempo

With AUTO SYNC on, two file tracks with close BPM (within 6%, octave-aware) meet in the middle: 127 and 129 BPM both play at 128 during the transition. Farther apart, the incoming track follows the outgoing one (up to ±12%).

## Limits

- Model latency is seconds: use the agent for decisions per phrase/transition, not for beat-accurate cuts
  (the Auto DJ keeps doing the beat alignment).
- Key detection is an estimate (techno is often atonal); the confidence is returned and low-confidence keys count less in ordering.
- YouTube/SoundCloud embeds accept only volume/crossfade, not EQ/FX.
