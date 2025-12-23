// Quick debug script to inspect the 10th-percentile Monte Carlo path.
// Run with: node --input-type=module tests/mc-p10-debug.mjs

import { runMonteCarlo } from "../src/js/simulation.js";
import { HISTORICAL_STATS } from "../src/js/data.js";

const params = {
  currentAge: 35,
  retireAge: 55,
  endAge: 100,
  currentSavings: 1_250_000,
  annualContrib: 300_000,
  incomeNeed: 200_000,
  inflation: 0.03,
  preRetReturn: 0.10,
  postRetReturn: 0.10,
  taxRate: 0.25,
  afterTaxFactor: 0.75,
  goalEvents: [],
  spendingStrategy: "fixed",
  inflationMode: "historical",
  bondTentingEnabled: false,
  bondTentingYears: 0
};

const mcConfig = {
  numSims: 1000,
  mode: "historical_regime_markov_1980",
  mean: HISTORICAL_STATS.mean / 100,
  stdev: HISTORICAL_STATS.stdev / 100
};

const result = runMonteCarlo(params, mcConfig);
const ages = Array.from({ length: params.endAge - params.currentAge + 1 }, (_, i) => params.currentAge + i);

const withdrawals = result.withdrawals.p10;
const returns = result.returns.p10;
const inflations = result.inflations.p10;
const balances = result.balancePaths?.p10 ?? result.p10;

const maxWithdrawal = Math.max(...withdrawals);
const maxIdx = withdrawals.findIndex(v => v === maxWithdrawal);

const sliceAround = (arr, idx, window = 2) => {
  const start = Math.max(0, idx - window);
  const end = Math.min(arr.length, idx + window + 1);
  return arr.slice(start, end).map((v, i) => ({
    age: ages[start + i],
    value: v
  }));
};

console.log("=== MC 10th percentile path debug ===");
console.log({
  agesCount: ages.length,
  maxWithdrawal,
  maxWithdrawalAge: ages[maxIdx],
  balanceAtMaxWithdrawal: balances[maxIdx],
  returnAtMaxWithdrawal: returns[maxIdx],
  inflationAtMaxWithdrawal: inflations[maxIdx],
  windowWithdrawals: sliceAround(withdrawals, maxIdx),
  windowBalances: sliceAround(balances, maxIdx),
  windowReturns: sliceAround(returns, maxIdx),
  windowInflations: sliceAround(inflations, maxIdx)
});

