export async function mapWithConcurrency(items, concurrency, worker) {
  const source = Array.from(items || []);
  if (!source.length) return [];

  const requested = Math.floor(Number(concurrency));
  const limit = Number.isFinite(requested) && requested > 0
    ? Math.min(requested, source.length)
    : 1;

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
