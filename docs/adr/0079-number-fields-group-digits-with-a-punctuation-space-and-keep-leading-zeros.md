# Number fields group digits with a punctuation space and keep leading zeros while typing

Number fields in the dashboard (`web/app/lib/numberInput.ts`) show digits in groups of three (1 048 576) with "." as the decimal point. The grouping mark is a punctuation space, not the no-break space: the dashboard font, Plus Jakarta Sans, draws the narrow no-break space about 1px wide, too thin to read as a gap.

We decided that the value a field holds is always the plain number as a string ("1048576", "0.15", or "" when empty), and the grouped text is only how it is shown. `cleanDigits` keeps leading zeros while the user types: deleting the 1 of "1 000 000" to retype it must not collapse the field to "0".

## Consequences

- Changing the grouping mark to a no-break space makes groups unreadable in the current font.
- Normalising leading zeros in `parseNumberInput` breaks retyping the first digit of a grouped number.
