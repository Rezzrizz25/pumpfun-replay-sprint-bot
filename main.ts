// Surge — a pump.fun replay sniper that pyramids into runners.
// Run by the grader as `node /bot/main.ts`; the strategy lives in strategy.ts and the
// protocol in the vendored SDK shim (vendor/makefun-bot.ts, a byte-identical copy of
// the kit's sdk/ts/makefun-bot.ts). Paper money only: nothing is traded for real.

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

await runBot(createStrategy(DEFAULT_PARAMS));
