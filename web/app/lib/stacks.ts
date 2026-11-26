export interface Stack<Item> {
  key: string;
  members: [Item, ...Item[]];
}

export type StackedRow<Item> = Item | Stack<Item>;

export function isStack<Item extends object>(row: StackedRow<Item>): row is Stack<Item> {
  return 'members' in row;
}

export function stackByKey<Item extends object>(
  items: Item[],
  keyOf: (item: Item) => string,
  compare: (first: Item, second: Item) => number,
): StackedRow<Item>[] {
  const itemsByKey = new Map<string, Item[]>();
  for (const item of items) {
    const sameKey = itemsByKey.get(keyOf(item));
    if (sameKey) sameKey.push(item);
    else itemsByKey.set(keyOf(item), [item]);
  }
  const rows: StackedRow<Item>[] = [];
  for (const [key, sameKey] of itemsByKey) {
    const [first, ...rest] = sameKey.toSorted(compare);
    if (!first) continue;
    rows.push(rest.length === 0 ? first : { key, members: [first, ...rest] });
  }
  const leadOf = (row: StackedRow<Item>): Item => (isStack(row) ? row.members[0] : row);
  return rows.toSorted((first, second) => compare(leadOf(first), leadOf(second)));
}
