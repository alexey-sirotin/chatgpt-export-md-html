export function normalizeConcurrency(
  value,
  { defaultValue = 1, min = 1, max = Number.POSITIVE_INFINITY } = {}
) {
  const fallback = Math.floor(Number(defaultValue));
  const lower = Math.max(1, Math.floor(Number(min)) || 1);
  const upperRaw = Math.floor(Number(max));
  const upper = Number.isFinite(upperRaw) ? Math.max(lower, upperRaw) : Number.POSITIVE_INFINITY;
  const requested = Math.floor(Number(value));

  if (!Number.isFinite(requested) || requested < lower) {
    return Math.min(Math.max(fallback || lower, lower), upper);
  }

  return Math.min(requested, upper);
}

export async function mapWithConcurrency(items, concurrency, worker) {
  const source = Array.from(items || []);
  if (!source.length) return [];

  const limit = normalizeConcurrency(concurrency, {
    defaultValue: 1,
    min: 1,
    max: source.length
  });

  const results = new Array(source.length);
  let nextIndex = 0;
  let firstError = null;

  async function runWorker() {
    while (!firstError) {
      const index = nextIndex++;
      if (index >= source.length) return;

      try {
        results[index] = await worker(source[index], index);
      } catch (error) {
        firstError ||= error;
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runWorker()));

  if (firstError) throw firstError;
  return results;
}
