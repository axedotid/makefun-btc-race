# makefun-btc-race

A trend-following bot for the cbBTC/USDC one-minute trading race.

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/axedotid/makefun-btc-race/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/axedotid/makefun-btc-race/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511)

## Strategy

The universe is one asset, so cross-sectional momentum degenerates to
buy-and-hold — a coin flip on an unseen window. This bot reads the trend of the
single series instead and only holds while the trend is up.

- Two EMAs of the close: 240 bars (fast) and 960 bars (slow).
- Fully invested while fast > slow; in cash while fast < slow.
- Trade only when the side flips, so a whipsaw costs one round trip.
- A 20% trailing stop from the equity high-water mark exits a falling market and
  waits for the trend to turn back up.

Decisions are made on a bar's close and filled at the next open, which is what
the replay's market model does. Only past closes are read, so the bot never sees
the future.

## Dev-window result

Graded on the published dev window with the kit's own grader:

```
net PnL   25.288454 USDC   (return 0.025288454)
trading   3 trades, max drawdown 0.0198, exposure 0.9146
fees      1.606105 USDC; at 2x fees net PnL 23.653377 USDC
guardrails met (trades ok, symbols ok, drawdown ok)
```
