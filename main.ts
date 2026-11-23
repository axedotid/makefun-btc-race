// Trend-following bot for the cbBTC/USDC 1-minute race.
//
// The universe is one asset, so cross-sectional momentum degenerates to
// buy-and-hold. That is a coin flip on an unseen 24h window. This bot instead
// reads the trend of the single series and only holds while the trend is up:
//
//   - Two exponential moving averages of the close, a fast one and a slow one.
//   - Long (fully invested) while fast > slow; in cash while fast < slow.
//   - Trade only when the side flips, so whipsaw costs one round trip each.
//   - A trailing stop: if equity falls STOP_BPS below its high-water mark while
//     long, go to cash and stay there until the trend turns up again.
//
// Everything is decided on a bar's close and filled at the next open, which is
// what the replay's market model does. Decisions use only past closes, so the
// bot never sees the future.

import { BPS, runBars, type BarsState, type BuyInput, type OrderInput } from './vendor/makefun-bars.ts';

const FAST_BARS = 240;
const SLOW_BARS = 960;
const STOP_BPS = 20_000;
const MAX_SLIPPAGE_BPS = 10_000; // wide: a refused order is worse than a filled one

const closes: bigint[] = [];
let fastEma: number | null = null;
let slowEma: number | null = null;
let side: 'long' | 'cash' = 'cash';
let peakEquity = 0;

function ema(prev: number | null, price: number, period: number): number {
  const k = 2 / (period + 1);
  return prev === null ? price : price * k + prev * (1 - k);
}

await runBars({
  onBatch(state: BarsState, batch: { bars: { symbol: string; c: bigint }[] }) {
    const { caps, fees } = state.hello;
    const symbol = state.hello.symbols[0]?.symbol;
    if (!symbol) return [];

    const bar = batch.bars[batch.bars.length - 1];
    if (!bar) return [];
    const price = Number(bar.c);
    closes.push(bar.c);
    fastEma = ema(fastEma, price, FAST_BARS);
    slowEma = ema(slowEma, price, SLOW_BARS);

    if (state.equity > peakEquity) peakEquity = state.equity;
    const drewDown = peakEquity > 0n && state.equity * BigInt(10_000) < peakEquity * BigInt(10_000 - STOP_BPS);

    const held = state.positions.get(symbol);
    const trendUp = fastEma !== null && slowEma !== null && fastEma > slowEma;

    // decide the side we want to be on
    if (held !== undefined) {
      if (!trendUp || drewDown) side = 'cash';
    } else {
      if (trendUp && !drewDown) side = 'long';
    }

    if (held !== undefined && side === 'cash') {
      return [{ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    if (held === undefined && side === 'long') {
      const stake = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
      const notional = stake < state.cash ? stake : state.cash;
      if (notional >= BigInt(fees.min_notional_quote_units)) {
        return [{ side: 'buy', symbol, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
    }
    return [];
  },
});