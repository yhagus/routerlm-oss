# Spinners keep turning, slowly, under reduced motion

`prefers-reduced-motion: reduce` normally removes animation in the dashboard. A loading spinner frozen mid-turn reads as a broken page, and a refresh in flight must still read as one.

We decided that `.spinner` and `.data-table-tool--spinning svg` keep their rotation under reduced motion, at a slower `animation-duration: 1.6s`, instead of stopping. Do not fold them into the blanket reduced-motion reset.
