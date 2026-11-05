/*
  Small, DOM-free ordering helpers for selection layers. Keeping the index arithmetic here makes
  pointer dragging and the keyboard move buttons share exactly the same ordering rules.
*/

export function moveItem(items, fromIndex, toIndex) {
  if (!Array.isArray(items)
      || !Number.isInteger(fromIndex)
      || !Number.isInteger(toIndex)
      || fromIndex < 0
      || fromIndex >= items.length
      || toIndex < 0
      || toIndex >= items.length
      || fromIndex === toIndex) {
    return undefined;
  }
  const [item] = items.splice(fromIndex, 1);
  items.splice(toIndex, 0, item);
  return { item, fromIndex, toIndex };
}


export function moveItemBeside(items, item, target, placement = 'before') {
  if (!Array.isArray(items) || item === target || !['before', 'after'].includes(placement)) {
    return undefined;
  }
  const fromIndex = items.indexOf(item);
  if (fromIndex < 0 || !items.includes(target)) return undefined;

  items.splice(fromIndex, 1);
  const targetIndex = items.indexOf(target);
  const toIndex = targetIndex + (placement === 'after' ? 1 : 0);
  items.splice(toIndex, 0, item);
  return { item, fromIndex, toIndex };
}
