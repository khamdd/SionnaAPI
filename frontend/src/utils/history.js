import {
  formatMaybeNumber,
  formatSimulationType,
  formatText,
} from "./format";

export function isSuccessfulHistoryItem(item) {
  return String(item.status || "").toLowerCase() === "success";
}

export function compareButtonTitle(item, isComparing, isCompatible, comparisonType) {
  if (!isSuccessfulHistoryItem(item)) {
    return "Failed simulations cannot be compared";
  }

  if (isComparing && !isCompatible) {
    return `Only successful ${formatSimulationType(comparisonType)} runs can be compared now`;
  }

  return `Compare ${formatSimulationType(item.simulation_type)} history`;
}

export function historyListSubtitle(item) {
  if (item.simulation_type === "sinr") {
    return `SINR point | ${formatText(item.status)}`;
  }

  if (item.simulation_type === "throughput_comparison") {
    return `${formatMaybeNumber(item.bandwidth_mhz)} MHz | ${item.mimo_layers || "--"} layers`;
  }

  if (item.simulation_type === "coverage_map") {
    return `Cell ${formatMaybeNumber(item.cell_size_m)} m | coverage image`;
  }

  return `Cell ${formatMaybeNumber(item.cell_size_m)} m | ${formatMaybeNumber(item.bandwidth_mhz)} MHz | ${item.mimo_layers || "--"} layers`;
}

export function pruneComparisonSelection(current, items, comparisonType) {
  if (!comparisonType) {
    return current;
  }

  const availableIds = new Set(
    items
      .filter((item) => (
        item.simulation_type === comparisonType
        && isSuccessfulHistoryItem(item)
      ))
      .map((item) => item.id),
  );
  const next = new Set([...current].filter((id) => availableIds.has(id)));
  return next.size ? next : new Set();
}

export function pruneComparisonDetails(current, items) {
  const availableIds = new Set(items.map((item) => item.id));
  return new Map([...current].filter(([id]) => availableIds.has(id)));
}
