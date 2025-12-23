import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  estimateAdditionalAnnualSavings,
  estimateAdditionalWorkYears,
  simulateDeterministic,
  runMonteCarlo
} from "../src/js/simulation.js";
import { fmtCurrency, parseCurrencyValue, percentile } from "../src/js/utils.js";
import { INFLATION_PRESETS } from "../src/js/data.js";

// Deterministic Math.random helper
function useDeterministicRandom(sequence) {
  const original = Math.random;
  let idx = 0;
  Math.random = () => {
    const val = sequence[idx % sequence.length];
    idx += 1;
    return val;
  };
  return () => {
    Math.random = original;
  };
}

function baseParams(overrides = {}) {
  return {
    currentAge: 60,
    retireAge: 65,
    endAge: 66,
    currentSavings: 100000,
    annualContrib: 10000,
    preRetReturn: 0.05,
    postRetReturn: 0.02,
    incomeNeed: 50000,
    incomeNeedMode: "fixed",
    incomeNeedPct: 0,
    incomeNeedBaseline: 50000,
    inflation: 0.02,
    taxRate: 0,
    afterTaxFactor: 1,
    goalEvents: [],
    spendingStrategy: "fixed",
    inflationMode: "fixed",
    bondTentingEnabled: false,
    bondTentingYears: 0,
    ...overrides
  };
}

function mc(overrides = {}) {
  return {
    numSims: 5,
    mode: "normal",
    mean: 0,
    stdev: 0,
    ...overrides
  };
}

describe("utils helpers", () => {
  test("parseCurrencyValue handles numbers, commas, blanks, and invalid", () => {
    assert.equal(parseCurrencyValue(1234), 1234);
    assert.equal(parseCurrencyValue("1,234"), 1234);
    assert.equal(parseCurrencyValue(""), 0);
    assert.equal(parseCurrencyValue("abc"), 0);
    assert.equal(parseCurrencyValue(null), 0);
  });

  test("percentile interpolates between bounds", () => {
    assert.equal(percentile([], 0.5), 0);
    assert.equal(percentile([10], 0.5), 10);
    assert.equal(percentile([0, 10], 0.5), 5);
    assert.equal(percentile([0, 10, 20, 30], 0.25), 7.5);
  });

  test("fmtCurrency scales thresholds", () => {
    assert.equal(fmtCurrency(999), "999.00");
    assert.equal(fmtCurrency(1000), "1.00k");
    assert.equal(fmtCurrency(1_500_000), "1.50M");
    assert.equal(fmtCurrency(2_000_000_000), "2.00B");
    assert.equal(fmtCurrency(-1200), "-1.20k");
  });

  test("INFLATION_PRESETS includes custom manual entry returning null", () => {
    const custom = INFLATION_PRESETS.find(p => p.id === "custom");
    assert.ok(custom);
    assert.equal(custom.compute(), null);
  });
});

describe("simulateDeterministic coverage", () => {
  test("respects customReturns override and contributions before retirement", () => {
    const params = baseParams({
      retireAge: 62,
      endAge: 62,
      annualContrib: 1000,
      incomeNeed: 0,
      goalEvents: []
    });
    const customReturns = [0.1, 0.1, 0.1]; // applied for ages 60, 61, 62
    const result = simulateDeterministic(params, { customReturns });
    // balances recorded at start of each year
    assert.deepEqual(result.years, [60, 61, 62]);
    // Year 60 start 100k, add 1k, grow 10% -> 111k end, year 61 start ~111k
    assert.ok(result.balances[1] > 110000 && result.balances[1] < 112000);
    // No spending, so final balance stays positive
    assert.equal(result.coverageFlags.every(Boolean), true);
  });

  test("goal withdrawals inflate correctly", () => {
    const params = baseParams({
      retireAge: 60,
      endAge: 61,
      annualContrib: 0,
      currentSavings: 20000,
      incomeNeed: 0,
      goalEvents: [{ label: "college", age: 60, amount: 10000 }],
      inflation: 0.03
    });
    const result = simulateDeterministic(params);
    // Goal at age 60 should reduce final balance from the starting amount
    assert.ok(result.finalBalance < params.currentSavings);
  });
});

describe("estimateAdditionalAnnualSavings", () => {
  test("returns zero when already at or above target", () => {
    const params = baseParams();
    const mcConfig = mc();
    const res = estimateAdditionalAnnualSavings(params, mcConfig, { successProb: 0.95 });
    assert.equal(res.extraAnnual, 0);
    assert.equal(res.achievedSuccess, 0.95);
  });

  test("returns null when even max extra cannot reach target", () => {
    const restore = useDeterministicRandom([0.6, 0.7, 0.8, 0.9]);
    const params = baseParams({
      retireAge: 60,
      endAge: 61,
      annualContrib: 0,
      currentSavings: 1000,
      incomeNeed: 20000,
      incomeNeedBaseline: 20000,
      afterTaxFactor: 1,
      spendingStrategy: "fixed"
    });
    const mcConfig = mc({ numSims: 3, mean: -0.5, stdev: 0 });
    const res = estimateAdditionalAnnualSavings(params, mcConfig, { successProb: 0.2 }, 0.9);
    assert.equal(res.extraAnnual, null);
    assert.ok(res.achievedSuccess < 0.5);
    restore();
  });

  test("finds a rounded increment when additional savings improve success", () => {
    const restore = useDeterministicRandom([0.5, 0.6, 0.7, 0.8, 0.5, 0.6, 0.7, 0.8]);
    const params = baseParams({
      retireAge: 60,
      endAge: 60,
      annualContrib: 0,
      currentSavings: 50000,
      incomeNeed: 0
    });
    const mcConfig = mc({ numSims: 3, mean: 0.05, stdev: 0 });
    const res = estimateAdditionalAnnualSavings(params, mcConfig, { successProb: 0.5 }, 0.9);
    assert.ok(res.extraAnnual >= 0);
    assert.equal(res.extraAnnual % 500, 0);
    restore();
  });
});

describe("estimateAdditionalWorkYears", () => {
  test("returns zero when already successful", () => {
    const res = estimateAdditionalWorkYears(baseParams(), mc(), { successProb: 0.95 }, 0.9);
    assert.equal(res.extraYears, 0);
    assert.equal(res.achievedSuccess, 0.95);
  });

  test("returns null when no additional years are possible", () => {
    const params = baseParams({ retireAge: 70, endAge: 71 });
    const res = estimateAdditionalWorkYears(params, mc(), { successProb: 0.4 }, 0.9);
    assert.equal(res.extraYears, null);
    assert.equal(res.achievedSuccess, 0.4);
  });

  test("identifies minimum extra years that reach target", () => {
    const restore = useDeterministicRandom([0.6, 0.7, 0.8, 0.9, 0.6, 0.7, 0.8, 0.9]);
    const params = baseParams({
      retireAge: 60,
      endAge: 63,
      annualContrib: 0,
      incomeNeed: 0,
      incomeNeedBaseline: 0
    });
    const mcConfig = mc({ numSims: 2, mean: 0.05, stdev: 0 });
    const res = estimateAdditionalWorkYears(params, mcConfig, { successProb: 0.5 }, 0.9);
    assert.ok(res.extraYears >= 1);
    assert.ok(res.achievedSuccess >= 0.9);
    restore();
  });
});

describe("runMonteCarlo aggregation", () => {
  test("returns full success with zero spending and captures percentiles", () => {
    const restore = useDeterministicRandom([0.6, 0.7, 0.8, 0.9]);
    const params = baseParams({
      retireAge: 60,
      endAge: 61,
      annualContrib: 0,
      incomeNeed: 0,
      incomeNeedBaseline: 0
    });
    const mcConfig = mc({ numSims: 4, mean: 0, stdev: 0 });
    const res = runMonteCarlo(params, mcConfig);
    assert.equal(res.successProb, 1);
    assert.equal(res.failurePath, null);
    assert.equal(res.p50.length, params.endAge - params.currentAge + 1);
    restore();
  });

  test("treats deep spending shortfall as failure even with pct withdrawals", () => {
    const restore = useDeterministicRandom([0.5, 0.6]);
    const params = baseParams({
      currentAge: 65,
      retireAge: 65,
      endAge: 65,
      annualContrib: 0,
      currentSavings: 1000,
      incomeNeed: 100000,
      incomeNeedBaseline: 100000,
      incomeNeedMode: "portfolio_pct",
      incomeNeedPct: 0.035,
      preRetReturn: 0,
      postRetReturn: 0,
      inflation: 0,
      taxRate: 0,
      afterTaxFactor: 1
    });
    const mcConfig = mc({ numSims: 1, mean: 0, stdev: 0 });
    const res = runMonteCarlo(params, mcConfig);
    assert.equal(res.successProb, 0);
    assert.ok(Math.min(...res.coverageProb) < 0.75);
    restore();
  });

  test("portfolio_pct_uncapped mode ignores the fixed income baseline cap", () => {
    const restore = useDeterministicRandom([0.5]);
    const params = baseParams({
      currentAge: 65,
      retireAge: 65,
      endAge: 65,
      annualContrib: 0,
      currentSavings: 1000000,
      incomeNeed: 10000, // Small baseline
      incomeNeedBaseline: 10000,
      incomeNeedMode: "portfolio_pct_uncapped",
      incomeNeedPct: 0.1, // 10% of 1M = 100k, much larger than baseline
      preRetReturn: 0,
      postRetReturn: 0,
      inflation: 0,
      taxRate: 0,
      afterTaxFactor: 1
    });
    // In uncapped mode, it should withdraw 100k
    const mcConfig = mc({ numSims: 1, mean: 0, stdev: 0 });
    const res = runMonteCarlo(params, mcConfig);
    // withdrawal is for age 65. Starting balance 1M. 10% is 100k.
    // withdrawals are stored in the result paths.
    const withdrawal = res.withdrawals?.p50[0] ?? 0;
    assert.ok(withdrawal > 90000, `Expected ~100k withdrawal, got ${withdrawal}`);
    restore();
  });

  test("captures failure path and zero coverage when spending overwhelms balance", () => {
    const restore = useDeterministicRandom([0.6, 0.7, 0.8, 0.9]);
    const params = baseParams({
      retireAge: 60,
      endAge: 61,
      annualContrib: 0,
      currentSavings: 0,
      incomeNeed: 20000,
      incomeNeedBaseline: 20000,
      afterTaxFactor: 1,
      preRetReturn: 0,
      postRetReturn: 0
    });
    const mcConfig = mc({ numSims: 3, mean: -0.2, stdev: 0 });
    const res = runMonteCarlo(params, mcConfig);
    assert.equal(res.successProb, 0);
    assert.ok(res.failurePath);
    assert.ok(res.finalBalances.every(b => b <= 0));
    restore();
  });
});

