/** Optional deterministic operation evidence, not heap or timing instrumentation. */
export type HistogramMetrics = { histogramBins: number; peakHistogramBins: number };

/** Serialized equality preserves number-format insertion order and exact colour case. */
export class FormattingHistogram {
  private readonly bins = new Map<string | undefined, { value: unknown; count: number }>();
  total = 0;

  constructor(private readonly metrics?: HistogramMetrics) {}

  add(value: unknown, count = 1) {
    if (count === 0) return;
    const key = JSON.stringify(value);
    const previous = this.bins.get(key);
    const next = (previous?.count ?? 0) + count;
    this.total += count;
    if (next === 0) {
      this.bins.delete(key);
      if (this.metrics) this.metrics.histogramBins -= 1;
    } else {
      if (previous) previous.count = next;
      else this.bins.set(key, { value, count: next });
      if (!previous && this.metrics) {
        this.metrics.histogramBins += 1;
        this.metrics.peakHistogramBins = Math.max(this.metrics.peakHistogramBins, this.metrics.histogramBins);
      }
    }
  }

  entries() { return this.bins.values(); }
  get size() { return this.bins.size; }
  get commonValue() { return this.size === 1 ? this.bins.values().next().value?.value : null; }
}
