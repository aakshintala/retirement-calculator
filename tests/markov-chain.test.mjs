import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REGIME_TRANSITION_MATRIX,
  REGIME_TRANSITION_MATRIX_1980,
  HISTORICAL_YEARS_WITH_REGIME,
  HISTORICAL_YEARS_WITH_REGIME_1980,
  REGIME_FREQUENCIES,
  REGIME_FREQUENCIES_1980
} from "../src/js/data.js";
import { sampleRegimeFromTransition } from "../src/js/simulation.js";

const REGIMES = ["bear", "flat", "bull"];
const EPSILON = 1e-10;
const BOUNDS_TOLERANCE = 0.01; // 1% deviation allowed in sampling test
const SAMPLE_SIZE = 100000;

function mulberry32(seed) {
  return function() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function withSeed(seed, fn) {
  const original = Math.random;
  Math.random = mulberry32(seed);
  try {
    fn();
  } finally {
    Math.random = original;
  }
}

function computeTransitionMatrix(years) {
  const counts = {
    bear: { bear: 0, flat: 0, bull: 0 },
    flat: { bear: 0, flat: 0, bull: 0 },
    bull: { bear: 0, flat: 0, bull: 0 }
  };

  for (let i = 0; i < years.length - 1; i++) {
    const from = years[i].regime;
    const to = years[i + 1].regime;
    if (counts[from] && counts[from][to] !== undefined) {
      counts[from][to] += 1;
    }
  }

  const matrix = { bear: {}, flat: {}, bull: {} };
  for (const from of REGIMES) {
    const total =
      counts[from].bear + counts[from].flat + counts[from].bull;
    assert.ok(total > 0, `Expected at least one transition from ${from}`);
    for (const to of REGIMES) {
      matrix[from][to] = counts[from][to] / total;
    }
  }

  return matrix;
}

function assertMatrixClose(actual, expected, label) {
  for (const from of REGIMES) {
    let rowSum = 0;
    for (const to of REGIMES) {
      const a = actual[from]?.[to];
      const e = expected[from]?.[to];
      assert.ok(Number.isFinite(a), `${label}: ${from}->${to} missing/invalid`);
      assert.ok(Number.isFinite(e), `${label}: expected ${from}->${to} missing/invalid`);
      assert.ok(Math.abs(a - e) < EPSILON, `${label}: ${from}->${to} expected ${e} got ${a}`);
      rowSum += a;
    }
    assert.ok(Math.abs(rowSum - 1) < EPSILON, `${label}: ${from} row does not sum to 1 (got ${rowSum})`);
  }
}

test("Markov transitions match historical regime sequence (full history)", () => {
  const expected = computeTransitionMatrix(HISTORICAL_YEARS_WITH_REGIME);
  assertMatrixClose(REGIME_TRANSITION_MATRIX, expected, "full-history");
});

test("Markov transitions match historical regime sequence (1980-2024)", () => {
  const expected = computeTransitionMatrix(HISTORICAL_YEARS_WITH_REGIME_1980);
  assertMatrixClose(REGIME_TRANSITION_MATRIX_1980, expected, "modern-era");
});

function assertSamplerRespectsMatrix(label, matrix, frequencies) {
  for (const from of REGIMES) {
    const counts = { bear: 0, flat: 0, bull: 0 };
    withSeed(12345 + from.length, () => {
      for (let i = 0; i < SAMPLE_SIZE; i++) {
        const next = sampleRegimeFromTransition(from, matrix, frequencies);
        counts[next] += 1;
      }
    });
    for (const to of REGIMES) {
      const observed = counts[to] / SAMPLE_SIZE;
      const expected = matrix[from][to];
      const delta = Math.abs(observed - expected);
      assert.ok(
        delta < BOUNDS_TOLERANCE,
        `${label}: ${from}->${to} observed ${observed.toFixed(4)} vs expected ${expected.toFixed(4)}`
      );
    }
  }
}

test("Markov sampler stays within bounds of transition matrix (full history)", () => {
  assertSamplerRespectsMatrix("full-history-bounds", REGIME_TRANSITION_MATRIX, REGIME_FREQUENCIES);
});

test("Markov sampler stays within bounds of transition matrix (1980-2024)", () => {
  assertSamplerRespectsMatrix("modern-era-bounds", REGIME_TRANSITION_MATRIX_1980, REGIME_FREQUENCIES_1980);
});

test("Markov sampler falls back to frequencies when matrix row missing", () => {
  const stubMatrix = {}; // no rows, forces fallback to frequencies
  const counts = { bear: 0, flat: 0, bull: 0 };
  withSeed(999, () => {
    for (let i = 0; i < SAMPLE_SIZE; i++) {
      const next = sampleRegimeFromTransition("bear", stubMatrix, REGIME_FREQUENCIES);
      counts[next] += 1;
    }
  });
  for (const regime of REGIMES) {
    const observed = counts[regime] / SAMPLE_SIZE;
    const expected = REGIME_FREQUENCIES[regime];
    const delta = Math.abs(observed - expected);
    assert.ok(
      delta < BOUNDS_TOLERANCE,
      `fallback-frequencies: ${regime} observed ${observed.toFixed(4)} vs expected ${expected.toFixed(4)}`
    );
  }
});

