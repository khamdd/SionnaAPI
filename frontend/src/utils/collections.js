export function clone(value) {
  return structuredClone(value);
}

export function toggleSetValue(current, value) {
  const next = new Set(current);

  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }

  return next;
}

export function removeSetValue(current, value) {
  const next = new Set(current);
  next.delete(value);
  return next;
}

export function removeMapValue(current, key) {
  if (!current.has(key)) {
    return current;
  }

  const next = new Map(current);
  next.delete(key);
  return next;
}
