---
status: accepted
areas: [inference]
---
# Image price tiers are chosen by pixel area, with 1K reaching 1536 by 1536

Alibaba prices images by tier (1K, 2K, 4K). `SIZE_TIERS` in `src/inference/models/image-generation.ts` maps an image to the smallest tier whose pixel budget it fits, by area. 1K reaches 1536 by 1536 (about 2.36 MP), so the models' standard sizes, such as qwen's 1328 by 1328, are priced as 1K; anything above 2048 by 2048 is 4K. The thresholds are not 1024 and 2048 on one side because that is how the Provider bills, and they must follow its price list.
