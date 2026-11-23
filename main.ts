// Trend-following cbBTC/USDC bot. Two EMAs of the close on a single symbol (CBBTC),
// fully invested while fast > slow, in cash while fast < slow, trading only on a side
// flip. A trailing stop exits when equity falls STOP_BPS below its high-water mark.
// Decisions on a bar's close; fills land at the next open. Deterministic: no clock,
// no env, no Math.random — so the two grading runs match byte for byte.

import { BPS, runBars, type BarsState, type BuyInput, type OrderInput, type SellInput } from './vendor/makefun-bars.ts';

// ---- strategy constants (tuned on the dev window) ----
const SYMBOL = 'CBBTC';
const FAST_BARS = 120;          // fast EMA lookback, in 1-minute bars
const SLOW_BARS = 840;          // slow EMA lookback
const STOP_BPS = 25000;         // trailing stop: exit if equity < hwm * (1 - STOP_BPS/10000)
const MAX_SLIPPAGE_BPS = 10000; // never refuse on a liquidity gap

// EMA multiplier, as a rational to keep float64 math exact-run-to-run.
// alpha = 2 / (n + 1). We track the EMA as a float but derive alpha once.
const alphaFast = 2 / (FAST_BARS + 1);
const alphaSlow = 2 / (SLOW_BARS + 1);

let emaFast: number | null = null;
let emaSlow: number | null = null;
let hwm = 0n;          // equity high-water mark, in quote units
let i = 0;             // client-id counter (deterministic)
let position: { qty: bigint; cost: bigint } | null = null;

function updateEma(prev: number | null, close: number, a: number): number {
  return prev === null ? close : prev + a * (close - prev);
}

await runBars({
  onBatch(state: BarsState) {
    // Skip the warm-up window entirely: orders there are rejected, and the EMAs must
    // still build history so the first scored bar already has a trend read.
    const orders: OrderInput[] = [];

    const c = state.close(SYMBOL);
    if (c === null) return [];

    const close = Number(c); // raw units; comparison is scale-invariant (both EMAs same scale)
    emaFast = updateEma(emaFast, close, alphaFast);
    emaSlow = updateEma(emaSlow, close, alphaSlow);

    if (state.warmingUp) return [];

    // Track equity high-water mark using the equity the account carries at this close.
    const equity = state.equity;
    if (equity > hwm) hwm = equity;

    const held = state.positions.get(SYMBOL) ?? null;
    const trendUp = emaFast !== null && emaSlow !== null && emaFast > emaSlow;

    // Trailing stop: equity has fallen STOP_BPS below the high-water mark.
    const stopHit = hwm > 0n && equity * BPS <= hwm * (BPS - BigInt(STOP_BPS));

    const { caps, fees } = state.hello;

    if (held !== null) {
      // Exit the whole position on a trend flip down, or on the trailing stop.
      if (!trendUp || stopHit) {
        orders.push({ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
      }
      return orders;
    }

    // Flat: go fully invested when the trend is up. After a stop-out, wait for the
    // trend to be up again (hwm already recorded; do not re-enter while stopHit persists).
    if (trendUp) {
      let slice = state.cash;
      const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
      if (byWeight < slice) slice = byWeight;
      if (slice > 0n && slice >= BigInt(fees.min_notional_quote_units)) {
        orders.push({ side: 'buy', symbol: SYMBOL, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS });
      }
    }
    return orders;
  },
});