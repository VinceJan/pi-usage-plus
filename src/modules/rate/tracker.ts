// Sliding-window output-token rate sampler (tok/s).
//
// The cumulative session output total is sampled about once per second while
// an agent run is active; the rate is the delta over a short trailing window.
// Pure logic (time is injectable) so it stays unit-testable without Pi.

export interface RateSample {
  at: number;
  output: number;
}

export class RateTracker {
  private samples: RateSample[] = [];

  constructor(private readonly windowMs = 3000) {}

  /** Record a cumulative output sample; returns the current smoothed rate. */
  sample(output: number, now = Date.now()): number | undefined {
    if (!Number.isFinite(output) || output < 0) return this.current();
    const last = this.samples[this.samples.length - 1];
    // A new turn/session resets the cumulative counter — drop the old window.
    if (last && output < last.output) this.samples = [];
    this.samples.push({ at: now, output });
    const cutoff = now - this.windowMs;
    while (this.samples.length > 1 && this.samples[0]!.at < cutoff)
      this.samples.shift();
    return this.current();
  }

  current(): number | undefined {
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    if (!first || !last || last.at <= first.at) return undefined;
    const rate = (last.output - first.output) / ((last.at - first.at) / 1000);
    return rate > 0 && Number.isFinite(rate) ? rate : undefined;
  }

  reset(): void {
    this.samples = [];
  }
}

export function formatRate(rate: number | undefined): string | undefined {
  if (rate === undefined) return undefined;
  return `⇣${Math.round(rate)} tok/s`;
}
