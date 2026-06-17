export function formatSimulationType(type) {
  return String(type || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function formatDateTime(value) {
  if (!value) {
    return "--";
  }

  return new Date(value).toLocaleString();
}

export function formatMaybeNumber(value) {
  if (value === null || value === undefined) {
    return "--";
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return "--";
  }

  return numericValue.toFixed(Number.isInteger(numericValue) ? 0 : 1);
}

export function formatRange(range) {
  if (!range) {
    return "--";
  }

  return `${formatMaybeNumber(range.min)} / ${formatMaybeNumber(range.current)} / ${formatMaybeNumber(range.max)}`;
}

export function formatNeighborDelta(value) {
  const delta = Number(value);

  if (!Number.isFinite(delta)) {
    return "--";
  }

  if (delta < 0) {
    return `${Math.abs(delta).toFixed(1)} dB stronger`;
  }

  return `${delta.toFixed(1)} dB weaker`;
}

export function formatPosition(position) {
  return `${position[0]}, ${position[1]}, ${position[2]}`;
}

export function formatPositionValue(value) {
  if (!Array.isArray(value)) {
    return "--";
  }

  return value.map(formatMaybeNumber).join(", ");
}

export function formatText(value) {
  if (value === null || value === undefined || value === "") {
    return "--";
  }

  return String(value);
}

export function firstArtifactUrl(artifacts) {
  const artifact = (artifacts || []).find((item) => (
    item.public_url
    && (
      item.artifact_type === "coverage_png"
      || /\.(png|jpe?g|webp|gif)$/i.test(item.public_url)
    )
  ));
  return artifact ? artifact.public_url : "";
}
