import {
  formatMaybeNumber,
  formatSimulationType,
  formatText,
} from "./format";

export function isSuccessfulHistoryItem(item) {
  return String(item.status || "").toLowerCase() === "success";
}

export function compareButtonTitle(item, isComparing, isCompatible, comparisonType, comparisonSceneName) {
  if (!isSuccessfulHistoryItem(item)) {
    return "Failed simulations cannot be compared";
  }

  if (isComparing && !isCompatible) {
    return `Only successful ${formatSimulationType(comparisonType)} runs from ${comparisonSceneName || "the same scene"} can be compared now`;
  }

  return `Compare ${formatSimulationType(item.simulation_type)} history`;
}

export function historyListSubtitle(item) {
  if (item.simulation_type === "sinr") {
    return `SINR point | ${formatText(item.scene_name)} | ${formatText(item.status)}`;
  }

  if (item.simulation_type === "throughput_comparison") {
    return `${formatMaybeNumber(item.bandwidth_mhz)} MHz | ${item.mimo_layers || "--"} layers | ${formatText(item.scene_name)}`;
  }

  if (item.simulation_type === "coverage_map") {
    return `Cell ${formatMaybeNumber(item.cell_size_m)} m | ${formatText(item.scene_name)}`;
  }

  return `Cell ${formatMaybeNumber(item.cell_size_m)} m | ${formatMaybeNumber(item.bandwidth_mhz)} MHz | ${item.mimo_layers || "--"} layers | ${formatText(item.scene_name)}`;
}

export function pruneComparisonSelection(current, items, comparisonType, comparisonSceneId) {
  if (!comparisonType) {
    return current;
  }

  const availableIds = new Set(
    items
      .filter((item) => (
        item.simulation_type === comparisonType
        && item.scene_id === comparisonSceneId
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
