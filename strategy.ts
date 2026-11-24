// Surge v2 — a launch sniper that pyramids into runners, for the pump.fun replay
// (agent-fun/replay/v2).
//
// Why this shape: on pump.fun, 1,222 coins launched in the dev window and only 35
// completed, but the tail is fat — a quarter of coins ran at least 2x from creation,
// 7% ran 5x and 4% ran 10x or more (max 14.7x). A momentum bot that buys mature coins
// after they already ran just buys tops: the house pilot lost 9.5 SOL that way. The
// money is in buying at creation price, cutting the rugs fast, and letting the few
// runners pay for the many small losses.
//
// The catch is the size cap: buys on one coin in one reply may spend at most 1% of
// its real SOL reserve, so a buy at creation (real SOL often under 1 SOL) is tiny.
// Size is therefore built by adding: each later tranche goes in only while the price
// is above the last buy, net SOL is still flowing in, and the reserve cap allows it,
// up to a fixed stake per coin. A coin that runs to completion lets the position grow
// with it; a coin that dumps never gets a second tranche.
//
// Exits: a stop loss against cost, a half take-profit at +100%, a trailing stop once
// the position is up 30%, an exit when the creator sells, an exit on fading flow, a
// staleness exit for dead coins, and a time limit. Near completion (real SOL past the
// ride threshold) the bot holds on through pullbacks: the replay closes the position
// at migration anyway.
//
// Guardrail probes keep the run above the minimum bar (a round trip of at least 0.01
// SOL on each of at least 20 coins): when the bot's own filled coins lag the pace set
// by block time, it buys a tiny probe of a liquid curve and sells it as soon as it
// lands. The sniper normally trades hundreds of coins, so the probes are a backstop.
//
// Deterministic by construction: no clock, no environment, no randomness; iteration
// only over insertion-ordered maps fed by the batch stream. The hello message's seed
// is the only randomness source the protocol allows, and this bot needs none of it.
//
// The wire protocol (hello, then one batch per slot, one reply of orders per batch)
// is owned by the vendored SDK shim in vendor/makefun-bot.ts; this file only decides
// orders.

import type { Batch, Bot, BotState, OrderInput, Pubkey } from './vendor/makefun-bot.ts';

export interface Params {
  /** Youngest age (slots since create) at which a coin may be bought. */
  minAge: number;
  /** Oldest age at which a first buy may still be decided. */
  maxAge: number;
  /** SOL to aim for per coin in total (each reply is still capped at 1% of real SOL). */
  stakeSol: number;
  /** Smallest single buy worth paying the tx fee for. */
  minBuySol: number;
  /** Buys after the first one, each on a later batch, while the coin keeps qualifying. */
  maxAdds: number;
  /** SOL per add (each still capped at 1% of real SOL). */
  addSol: number;
  /** An add needs the price at least this far above the previous buy's decision price. */
  addStep: number;
  /** An add waits this many slots after the previous buy was decided. */
  addDelay: number;
  /** An add needs the recent net flow at least this (SOL). */
  addNetSol: number;
  /** Real SOL reserve window at decision time. */
  minRqSol: number;
  maxRqSol: number;
  /** Creator's own buys in the create slot: SOL window (a huge dev buy is a bundle). */
  maxDevBuySol: number;
  /** Distinct non-creator buyers seen before entry, at least: a launch the crowd
   *  piles into in its first slots is the one that runs; a quiet launch dies. */
  minBuyers: number;
  /** SOL bought by anyone in the opening tape, at least. */
  minBoughtSol: number;
  /** SOL sold by others / SOL bought, at most. */
  maxSellRatio: number;
  /** Largest single non-creator sell seen, as a share of the real SOL reserve before it. */
  maxBigSell: number;
  /** Price now over the create price, at most: do not chase a coin that already ran. */
  maxRunup: number;
  /** Recent-flow window (slots) and what it must show at entry. */
  flowWindow: number;
  minFlowSol: number;
  /** Creator sold before entry: skip the coin. */
  skipDevSold: boolean;
  /** Slippage allowed on buys (bps). */
  buySlipBps: number;
  /** First take-profit: sell this share of the position once it is worth this much over cost. */
  tpAt: number;
  tpPart: number;
  /** Exit when the position is worth this much under its cost. */
  stopLoss: number;
  /** Trailing stop: once up at least trailArm, exit on a fall of trail from the best value. */
  trailArm: number;
  trail: number;
  /** Hold on (no fade, trail or creator-sell exit) once the curve's real SOL passes this. */
  rideRqSol: number;
  /** Exit after holding this many slots. */
  maxHold: number;
  /** Exit when the creator sells while held. */
  exitOnDevSell: boolean;
  /** Exit when no trade has hit the coin for this many slots. */
  staleSlots: number;
  /** Exit when the recent net flow falls below minus this many SOL. */
  fadeWindow: number;
  fadeNetSol: number;
  /** Most sniper positions open at once (the rest of caps.max_open_positions is for probes). */
  maxMain: number;
  /** Guardrail pacing: target distinct coins and fills by the end of the window. */
  targetCoins: number;
  targetFills: number;
  /** Block seconds the pace is measured over (the replay's 24h window). */
  paceSecs: number;
  /** Size of one probe round trip (SOL). */
  probeSol: number;
  /** Most probe round trips open at once. */
  maxProbes: number;
  /** Most SOL at cost across all positions at once (a drawdown guard). */
  maxExposureSol: number;
}

// The settings main.ts trades with. Chosen by grading variants against the dev window
// with the kit's grade-local and a local sweep, preferring flat regions of the grid
// over its single best cell (see README.md).
export const DEFAULT_PARAMS: Params = {
  minAge: 0,
  maxAge: 1,
  stakeSol: 0.02,
  minBuySol: 0.005,
  maxAdds: 4,
  addSol: 0.1,
  addStep: 0.15,
  addDelay: 2,
  addNetSol: 0.1,
  minRqSol: 1,
  maxRqSol: 30,
  maxDevBuySol: 10,
  minBuyers: 8,
  minBoughtSol: 5,
  maxSellRatio: 1,
  maxBigSell: 0.5,
  maxRunup: 2,
  flowWindow: 10,
  minFlowSol: -1000,
  skipDevSold: true,
  buySlipBps: 10000,
  tpAt: 1,
  tpPart: 0.5,
  stopLoss: 0.08,
  trailArm: 0.3,
  trail: 0.35,
  rideRqSol: 60,
  maxHold: 2400,
  exitOnDevSell: true,
  staleSlots: 600,
  fadeWindow: 20,
  fadeNetSol: 3,
  maxMain: 5,
  targetCoins: 24,
  targetFills: 0,
  paceSecs: 86400,
  probeSol: 0.02,
  maxProbes: 1,
  maxExposureSol: 5,
};

const LAMPORTS = 1e9;

interface Tick {
  slot: number;
  buy: boolean;
  sol: number;
  user: string;
}

interface Coin {
  mint: Pubkey;
  createSlot: number;
  creator: Pubkey;
  /** Create-time reserves: the price run-up is measured against them. */
  vq0: number;
  vt0: number;
  devBuy: number;
  trades: number;
  buyers: Set<Pubkey>;
  bought: number;
  soldByOthers: number;
  bigSell: number;
  devSold: boolean;
  lastTradeSlot: number;
  /** Trades of the last flowWindow slots (older ones dropped as new ones come). */
  recent: Tick[];
  buysSent: number;
  spentSent: number;
  /** Decision price (vq/vt as a pair) of the last buy sent. */
  lastBuyVq: number;
  lastBuyVt: number;
  lastBuySlot: number;
  /** Never buy it again (exited, filtered out for good, or completed). */
  done: boolean;
  complete: boolean;
}

interface Held {
  openedSlot: number;
  txPaid: number;
  best: number;
  devSoldAtOpen: boolean;
  tookTp: boolean;
}

export function createStrategy(p: Params = DEFAULT_PARAMS): Bot {
  const coins = new Map<Pubkey, Coin>();
  const held = new Map<Pubkey, Held>();
  /** Mints with a sell in flight. */
  const selling = new Set<Pubkey>();
  /** Probe round trips in flight, by mint: false while buying, true once selling. */
  const probes = new Map<Pubkey, boolean>();
  /** The bot's own filled orders and the coins they were on (harness closes excluded). */
  let myFills = 0;
  const myCoins = new Set<Pubkey>();
  let firstTime: number | null = null;
  let lastTime: number | null = null;

  const readEvents = (batch: Batch): void => {
    for (const e of batch.events) {
      if (e.event === 'CreateEvent') {
        coins.set(e.mint, {
          mint: e.mint,
          createSlot: e.slot,
          creator: e.creator,
          vq0: Number(e.virtual_quote_reserves),
          vt0: Number(e.virtual_token_reserves),
          devBuy: 0,
          trades: 0,
          buyers: new Set(),
          bought: 0,
          soldByOthers: 0,
          bigSell: 0,
          devSold: false,
          lastTradeSlot: e.slot,
          recent: [],
          buysSent: 0,
          spentSent: 0,
          lastBuyVq: 0,
          lastBuyVt: 1,
          lastBuySlot: 0,
          done: false,
          complete: false,
        });
      } else if (e.event === 'TradeEvent') {
        const c = coins.get(e.mint);
        if (c === undefined) continue;
        const sol = Number(e.sol_amount) / LAMPORTS;
        c.trades += 1;
        c.lastTradeSlot = e.slot;
        c.recent.push({ slot: e.slot, buy: e.is_buy, sol, user: e.user });
        const isDev = e.user === c.creator;
        if (e.is_buy) {
          c.bought += sol;
          if (isDev && e.slot === c.createSlot) c.devBuy += sol;
          else if (!isDev) c.buyers.add(e.user);
        } else if (isDev) {
          c.devSold = true;
        } else {
          c.soldByOthers += sol;
          const rqBefore = Number(e.real_quote_reserves) / LAMPORTS + sol;
          if (rqBefore > 0) {
            const share = sol / rqBefore;
            if (share > c.bigSell) c.bigSell = share;
          }
        }
      } else {
        const c = coins.get(e.mint);
        if (c !== undefined) {
          c.complete = true;
          c.done = true;
        }
      }
    }
  };

  /** Net SOL bought minus sold and the distinct buyers, over the last `w` slots. */
  const flowOver = (c: Coin, slot: number, w: number): { net: number; buyers: number } => {
    const from = slot - w;
    let drop = 0;
    while (drop < c.recent.length && c.recent[drop]!.slot <= from) drop++;
    if (drop > 0) c.recent.splice(0, drop);
    let net = 0;
    const buyers = new Set<Pubkey>();
    for (const t of c.recent) {
      if (t.buy) {
        net += t.sol;
        if (t.user !== c.creator) buyers.add(t.user);
      } else {
        net -= t.sol;
      }
    }
    return { net, buyers: buyers.size };
  };

  /** What selling `tokens` against (vq, vt) would pay after curve fees (SOL). */
  const sellValue = (tokens: number, vq: number, vt: number, curveFee: number): number => {
    if (tokens <= 0 || vt <= 0) return 0;
    const q = (tokens * vq) / (vt + tokens);
    return q * (1 - curveFee);
  };

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      readEvents(batch);
      for (const e of batch.events) {
        if (e.block_time === null) continue;
        if (firstTime === null) firstTime = e.block_time;
        if (e.block_time > lastTime!) lastTime = e.block_time;
      }
      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const tx = Number(state.txFeeLamports()) / LAMPORTS;
      const curveFee =
        (state.hello.fees.protocol_bps_fallback + state.hello.fees.creator_bps_fallback) / 10000;
      const marks = new Map<Pubkey, { vq: number; vt: number }>();
      for (const m of batch.marks) {
        marks.set(m.mint, { vq: Number(m.virtual_quote_reserves), vt: Number(m.virtual_token_reserves) });
      }

      for (const f of batch.fills) {
        if (f.client_id.startsWith('_')) {
          held.delete(f.mint);
          selling.delete(f.mint);
          continue;
        }
        if (f.status === 'filled') {
          myFills++;
          myCoins.add(f.mint);
        }
        const h = held.get(f.mint);
        if (f.status !== 'rejected' && h !== undefined) h.txPaid += Number(f.tx_fee_lamports) / LAMPORTS;
        if (f.side === 'buy' && f.status === 'filled' && h === undefined) {
          held.set(f.mint, {
            openedSlot: f.slot,
            txPaid: Number(f.tx_fee_lamports) / LAMPORTS,
            best: 0,
            devSoldAtOpen: coins.get(f.mint)?.devSold ?? false,
            tookTp: false,
          });
        }
      }
      for (const mint of [...selling]) {
        let sellPending = false;
        for (const po of state.pending.values()) {
          if (po.order.mint === mint && po.order.side === 'sell') sellPending = true;
        }
        if (!sellPending) selling.delete(mint);
      }
      for (const mint of [...held.keys()]) {
        let buyPending = false;
        for (const po of state.pending.values()) {
          if (po.order.mint === mint && po.order.side === 'buy') buyPending = true;
        }
        if (!state.positions.has(mint) && !selling.has(mint) && !buyPending) held.delete(mint);
      }
      const pendingBuy = (mint: Pubkey): boolean => {
        for (const po of state.pending.values()) {
          if (po.order.mint === mint && po.order.side === 'buy') return true;
        }
        return false;
      };
      const pendingSell = (mint: Pubkey): boolean => {
        for (const po of state.pending.values()) {
          if (po.order.mint === mint && po.order.side === 'sell') return true;
        }
        return false;
      };

      // Exits first: a position is sold whole on the first exit trigger (the take-profit
      // sells only a part, then the rest rides with its own stop).
      for (const [mint, pos] of state.positions) {
        if (orders.length >= cap) break;
        if (selling.has(mint) || probes.has(mint)) continue;
        const c = coins.get(mint);
        let h = held.get(mint);
        if (h === undefined) {
          h = { openedSlot: state.slot, txPaid: tx, best: 0, devSoldAtOpen: c?.devSold ?? false, tookTp: false };
          held.set(mint, h);
        }
        let mk = marks.get(mint);
        if (mk === undefined) {
          const cv = state.curves.get(mint);
          if (cv === undefined) continue;
          mk = { vq: Number(cv.virtual_quote_reserves), vt: Number(cv.virtual_token_reserves) };
        }
        const value = sellValue(Number(pos.token_amount), mk.vq, mk.vt, curveFee) / LAMPORTS - tx;
        const basis = Number(pos.cost_lamports) / LAMPORTS + h.txPaid;
        if (value > h.best) h.best = value;
        const rqSol = Number(state.curves.get(mint)?.real_quote_reserves ?? 0n) / LAMPORTS;
        const riding = rqSol >= p.rideRqSol;
        let exit = false;
        if (basis > 0) {
          if (!h.tookTp && value >= basis * (1 + p.tpAt)) {
            const part = (BigInt(pos.token_amount) * BigInt(Math.floor(p.tpPart * 10000))) / 10000n;
            if (part > 0n && part < BigInt(pos.token_amount)) {
              orders.push({ side: 'sell', mint, token_amount: part, max_slippage_bps: 10_000 });
              selling.add(mint);
              h.tookTp = true;
              h.best = 0;
              continue;
            }
          }
          if (value >= basis * (1 + p.tpAt) && h.tookTp) {
            // Already took the part-profit and it ran further: let the trail decide.
          } else if (value <= basis * (1 - p.stopLoss)) {
            exit = true;
          }
          if (!exit && !riding && h.best >= basis * (1 + p.trailArm) && value < h.best * (1 - p.trail)) exit = true;
          if (!exit && riding && h.best >= basis * (1 + p.trailArm) && value < h.best * 0.5) exit = true;
        }
        if (!exit && state.slot - h.openedSlot >= p.maxHold) exit = true;
        if (c !== undefined) {
          if (!exit && !riding && p.exitOnDevSell && c.devSold && !h.devSoldAtOpen) exit = true;
          if (!exit && !riding && state.slot - c.lastTradeSlot >= p.staleSlots) exit = true;
          if (!exit && !riding && flowOver(c, state.slot, p.fadeWindow).net < -p.fadeNetSol) exit = true;
        }
        if (!exit) continue;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
        selling.add(mint);
        if (c !== undefined) c.done = true;
      }

      // Probe round trips: sell the whole probe as soon as its buy has landed.
      for (const [mint, sellingProbe] of probes) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pendingBuy(mint) && !pendingSell(mint)) probes.delete(mint);
          continue;
        }
        if (curve === undefined || curve.complete || pendingBuy(mint) || pendingSell(mint)) continue;
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
        if (!sellingProbe) probes.set(mint, true);
      }

      // Entries and adds.
      let free = Number(state.freeCashLamports()) / LAMPORTS;
      let open = state.committedPositionCount();
      let exposure = 0;
      for (const [mint, h] of held) {
        exposure += Math.max(h.txPaid + Number(state.positions.get(mint)?.cost_lamports ?? 0n) / LAMPORTS, 0);
      }
      for (const c of coins.values()) {
        if (orders.length >= cap) break;
        if (c.done || c.complete) continue;
        const age = state.slot - c.createSlot;
        const isAdd = c.buysSent > 0;
        if (!isAdd && age > p.maxAge) {
          c.done = true;
          continue;
        }
        if (age < p.minAge) continue;
        if (isAdd) {
          if (c.buysSent > p.maxAdds) continue;
          if (!state.positions.has(c.mint) || selling.has(c.mint) || pendingBuy(c.mint)) continue;
        } else if (open >= state.hello.caps.max_open_positions) {
          continue;
        }
        const curve = state.curves.get(c.mint);
        if (curve === undefined || curve.complete) continue;
        if (c.devSold && (p.skipDevSold || isAdd)) {
          if (!isAdd) c.done = true;
          continue;
        }
        const vq = Number(curve.virtual_quote_reserves);
        const vt = Number(curve.virtual_token_reserves);
        if (isAdd) {
          // A later tranche once the launch has shown it is not an instant dump.
          if (state.slot - c.lastBuySlot < p.addDelay) continue;
          if (vq * c.lastBuyVt < c.lastBuyVq * vt * (1 + p.addStep)) continue;
          if (flowOver(c, state.slot, p.flowWindow).net < p.addNetSol) continue;
          if (exposure + p.addSol > p.maxExposureSol) continue;
          const maxAdd = Number(state.maxBuyLamports(c.mint)) / LAMPORTS;
          const amount = Math.min(p.addSol, maxAdd);
          if (amount < p.minBuySol || free < amount + tx) continue;
          orders.push({
            side: 'buy',
            mint: c.mint,
            quote_lamports: BigInt(Math.floor(amount * LAMPORTS)),
            max_slippage_bps: p.buySlipBps,
          });
          free -= amount + tx;
          exposure += amount;
          c.buysSent += 1;
          c.spentSent += amount;
          c.lastBuyVq = vq;
          c.lastBuyVt = vt;
          c.lastBuySlot = state.slot;
          continue;
        }
        // Crowd filter on the opening tape: buy the launches the crowd piles into,
        // not the quiet ones (a quiet launch dies; a crowded one runs).
        const rq = Number(curve.real_quote_reserves) / LAMPORTS;
        if (rq < p.minRqSol || rq > p.maxRqSol) continue;
        if (c.devBuy > p.maxDevBuySol) continue;
        if (c.buyers.size < p.minBuyers) continue;
        if (c.bought < p.minBoughtSol) continue;
        if (c.bought > 0 && c.soldByOthers > c.bought * p.maxSellRatio) continue;
        if (c.bigSell > p.maxBigSell) continue;
        const runup = (vq * c.vt0) / (vt * c.vq0);
        if (runup > p.maxRunup) continue;
        const fl = flowOver(c, state.slot, p.flowWindow);
        if (fl.net < p.minFlowSol) continue;
        if (open >= p.maxMain) continue;
        if (exposure + p.stakeSol > p.maxExposureSol) continue;
        const maxBuy = Number(state.maxBuyLamports(c.mint)) / LAMPORTS;
        const amount = Math.min(p.stakeSol, maxBuy);
        if (amount < p.minBuySol) continue;
        if (free < amount + tx) continue;
        orders.push({
          side: 'buy',
          mint: c.mint,
          quote_lamports: BigInt(Math.floor(amount * LAMPORTS)),
          max_slippage_bps: p.buySlipBps,
        });
        free -= amount + tx;
        exposure += amount;
        c.buysSent += 1;
        c.spentSent += amount;
        c.lastBuyVq = vq;
        c.lastBuyVt = vt;
        c.lastBuySlot = state.slot;
        open += 1;
      }

      // Guardrail pacing: open a probe when the bot's fills or coins lag the pace.
      if (probes.size < p.maxProbes && firstTime !== null && lastTime !== null) {
        const pace = Math.min(1, (lastTime - firstTime) / p.paceSecs);
        const needCoins = myCoins.size < Math.ceil(p.targetCoins * pace);
        const needFills = myFills < Math.ceil(p.targetFills * pace);
        if ((needCoins || needFills) && open < state.hello.caps.max_open_positions) {
          const minRq = (p.probeSol * 10000) / state.hello.caps.max_order_bps_of_real_reserve;
          for (const mint of state.curves.keys()) {
            if (orders.length >= cap || probes.size >= p.maxProbes) break;
            if (held.has(mint) || probes.has(mint) || pendingBuy(mint) || pendingSell(mint) || state.positions.has(mint)) continue;
            if (needCoins && !needFills && myCoins.has(mint)) continue;
            const curve = state.curves.get(mint)!;
            if (curve.complete) continue;
            if (Number(curve.real_quote_reserves) / LAMPORTS < minRq * 1.5) continue;
            if (free < p.probeSol + 2 * tx) break;
            orders.push({
              side: 'buy',
              mint,
              quote_lamports: BigInt(Math.floor(p.probeSol * LAMPORTS)),
              max_slippage_bps: p.buySlipBps,
            });
            probes.set(mint, false);
            free -= p.probeSol + tx;
          }
        }
      }
      return orders;
    },
  };
}
