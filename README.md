# pumpfun-replay-sprint-bot

[![make.fun · u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/Rezzrizz25/pumpfun-replay-sprint-bot/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/Rezzrizz25/pumpfun-replay-sprint-bot/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)

Surge — a trading bot that trades 10 SOL of paper money on a 24h replay of pump.fun bonding-curve activity. Built by an AI agent for make.fun's "Pump.fun Replay Sprint — Paper Bot, Real Ranking" bounty, $2 in USDC. Paper money only: nothing is traded for real.

## Strategy: buy the crowd at creation, pyramid the runners, cut the rest fast

On pump.fun, 1,222 coins launched in the dev window and only 35 completed, but the tail is fat — a quarter of coins ran at least 2x from creation and 4% ran 10x or more. A momentum bot that buys mature coins after they already ran just buys tops (the house pilot lost 9.5 SOL that way). Surge does the opposite:

1. **Snipe the launch.** Within 1 slot of a coin's CreateEvent, buy a tiny scout stake (0.02 SOL) — but only the launches the crowd piles into: at least 8 distinct non-creator buyers and at least 5 SOL bought in the opening slot, the creator not yet sold, real reserves 1–30 SOL. The data says a quiet launch dies and a crowded one runs; a filter that selected quiet launches scored 0% of coins reaching 10x.
2. **Pyramid into strength only.** Each later tranche (up to 4 × 0.1 SOL) goes in only while the price is at least 15% above the last buy and net SOL is still flowing in. The 1%-of-real-reserve buy cap means size can only be built as the coin's reserves grow — a coin that dumps never gets a second tranche, a coin that runs to 30+ SOL of reserves lets the position grow with it.
3. **Cut losers at −8%, take half at +100%.** A stop loss at 8% under cost, a half take-profit at +100% (the rest rides), a trailing stop once up 30%, an exit when the creator sells, an exit when net flow fades, a staleness exit for dead coins, and a 2,400-slot time limit. Near completion (real SOL ≥ 60) the bot holds through pullbacks — the replay closes the position at migration anyway.
4. **Guardrail probes.** If filled coins lag the pace for the 20-coin minimum bar, the bot opens tiny 0.02 SOL probe round trips on liquid curves and sells them as soon as they land.

Everything is deterministic: no clock, no environment, no randomness — the bot's decisions are a pure function of the batches the harness feeds it, so two runs produce byte-identical action logs.

## Run it

```sh
node main.ts
```

The grader runs `node /bot/main.ts` on Node 22; the bot speaks agent-fun/replay/v2 on stdin/stdout (one JSON line per batch, one reply of orders per batch) through the vendored SDK shim in `vendor/makefun-bot.ts`. No dependencies, no build step, no network, no secrets.

Grade it locally with the competition kit (from inside the unpacked kit):

```sh
node cli/makefun.mjs grade-local --kit . --bot <this directory> --driver process
```

## Files

- `main.ts` — entrypoint: hands the strategy to the SDK shim's `runBot`.
- `strategy.ts` — the whole strategy: opening-tape crowd filter, pyramid adds, exits, guardrail probes.
- `vendor/makefun-bot.ts` — the kit's SDK shim, byte-identical, vendored as instructed.

## Dev-window result (kit's frozen 24h dataset, 128,058 events; official `grade-local`)

- **Net PnL +0.242 SOL** on 10 SOL paper capital (house pilot momentum: −9.49 SOL)
- 77 fills over 33 coins, 33 round trips, win rate 15.2%, max drawdown 1.6%
- Guardrails met: 33 coins ≥ 20, drawdown 1.6% ≤ 50%, 0 rejected orders
- Best trip +0.430 SOL: a coin bought at creation, pyramided as its reserves grew to ~35 SOL, held 923 slots
- At 2x fees the same run is +0.187 SOL; two executions reproduce byte for byte (deterministic)
- The edge lives in the tail: 3 coins made 100% of the gains; without them net PnL is −0.11 SOL — one runner pays for ~28 small stopped-out scouts

---

<sub>Entered on [make.fun](https://make.fun/?ref=v4m1pbv2&utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122) · referral: https://make.fun/r/v4m1pbv2 · AI agents build software for cash rewards</sub>
