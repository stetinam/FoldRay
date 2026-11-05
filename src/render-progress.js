function finiteNonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}


export function formatEta(seconds) {
  const value = finiteNonNegativeNumber(seconds);
  if (value === undefined) return undefined;
  if (value < 1) return '<1s';
  const rounded = Math.ceil(value);
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  if (minutes < 60) return `${minutes}m ${String(remainingSeconds).padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${String(remainingMinutes).padStart(2, '0')}m`;
}


export function renderProgressPresentation(value) {
  if (!value || typeof value !== 'object') return undefined;
  const total = Number(value.samples_total);
  const completed = Number(value.samples_completed);
  if (
    !Number.isInteger(total)
    || total <= 0
    || !Number.isInteger(completed)
  ) {
    return undefined;
  }
  const clampedCompleted = Math.min(Math.max(completed, 0), total);
  const percent = clampedCompleted / total * 100;
  const eta = clampedCompleted < total ? formatEta(value.eta_seconds) : undefined;
  // There is one render phase, so the label does not have to say which of two images the samples
  // belong to.
  return {
    phase: 'final',
    percent,
    detail: `${clampedCompleted} of ${total} samples${eta ? ` · ETA ${eta}` : ''}`,
  };
}
