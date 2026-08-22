/**
 * Return the number of route stops from an observed station to a target.
 *
 * Circular routes may contain the same station more than once. The last
 * occurrence at or before the target is used so the result follows the
 * selected direction deterministically.
 */
export function remainingStopsToTarget(
  stopIds: readonly string[],
  currentStationCode: string,
  targetStopIndex: number,
): number | null {
  if (!Number.isInteger(targetStopIndex) || targetStopIndex < 0 || targetStopIndex >= stopIds.length) {
    return null;
  }

  const current = currentStationCode.trim();
  if (!current) {
    return null;
  }

  let currentIndex = -1;
  for (let index = 0; index <= targetStopIndex; index += 1) {
    if (stopIds[index]?.trim() === current) {
      currentIndex = index;
    }
  }

  return currentIndex < 0 ? null : targetStopIndex - currentIndex;
}
