import assert from "node:assert/strict";
import test from "node:test";
import { formatRate, RateTracker } from "../src/modules/rate/tracker.ts";

test("rate is undefined before two samples exist", () => {
  const tracker = new RateTracker();
  assert.equal(tracker.sample(100, 0), undefined);
});

test("rate measures output delta per second", () => {
  const tracker = new RateTracker();
  tracker.sample(100, 0);
  assert.equal(tracker.sample(160, 2000), 30);
});

test("rate is undefined while output is idle", () => {
  const tracker = new RateTracker();
  tracker.sample(100, 0);
  assert.equal(tracker.sample(100, 2000), undefined);
});

test("old samples slide out of the window", () => {
  const tracker = new RateTracker(3000);
  tracker.sample(0, 0);
  tracker.sample(300, 1000);
  // t=5000: the t=0 sample expires, window is [1000, 5000] with no growth.
  assert.equal(tracker.sample(300, 5000), undefined);
});

test("counter reset starts a fresh window", () => {
  const tracker = new RateTracker();
  tracker.sample(500, 0);
  assert.equal(tracker.sample(10, 1000), undefined);
  assert.equal(tracker.sample(70, 2000), 60);
});

test("reset clears the rate", () => {
  const tracker = new RateTracker();
  tracker.sample(100, 0);
  tracker.sample(200, 1000);
  tracker.reset();
  assert.equal(tracker.current(), undefined);
});

test("formatRate rounds and hides idle", () => {
  assert.equal(formatRate(12.4), "⇣12 tok/s");
  assert.equal(formatRate(undefined), undefined);
});
