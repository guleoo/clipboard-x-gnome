export function order(items) {
  return items.sort((left, right) =>
    Number(right.favorite) - Number(left.favorite)
    || right.createdAt - left.createdAt);
}
