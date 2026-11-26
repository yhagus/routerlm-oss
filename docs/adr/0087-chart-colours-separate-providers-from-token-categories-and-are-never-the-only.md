---
status: accepted
areas: [web]
---
# Chart colours separate Providers from token categories and are never the only carrier of meaning

Dashboard charts colour two kinds of series. Provider identity uses `--series-1` to `--series-4` (blue, orange, aqua, yellow); token categories use a violet and magenta pair so a token series never reads as a Provider. Both sets were checked for colour-blind separation against the panel surface (`web/app/assets/css/dashboard.css`, chart tokens).

We decided that the lighter light-mode steps sit below 3:1 contrast, so every chart keeps a legend with values or a table nearby, and colour is never the only way to tell series apart.
