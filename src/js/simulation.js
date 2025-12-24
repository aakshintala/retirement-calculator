import {
  REGIME_TRANSITION_MATRIX,
  REGIME_TRANSITION_MATRIX_1980,
  REGIME_FREQUENCIES,
  REGIME_FREQUENCIES_1980,
  YEARS_BY_REGIME,
  YEARS_BY_REGIME_1980,
  RETURN_INFLATION_SERIES,
  RETURN_INFLATION_SERIES_1980,
  HISTORICAL_YEARS_WITH_REGIME,
  HISTORICAL_YEARS_WITH_REGIME_1980,
  LAST_KNOWN_INFLATION,
  SAVINGS_TARGET_SUCCESS,
  MAX_SAVINGS_SEARCH,
  SAVINGS_MIN_INCREMENT,
  MAX_EXTRA_WORK_YEARS,
  MAX_EXTRA_SPENDING_SEARCH,
  SPENDING_MIN_INCREMENT
} from "./data.js";
import { clamp, percentile } from "./utils.js";

const DEFAULT_MIN_INCOME_COVERAGE = 1;

function normalizeContribSchedule(params) {
  const schedule = Array.isArray(params?.contribSchedule) ? params.contribSchedule : null;
  if (schedule && schedule.length) {
    return schedule
      .map(r => ({
        startAge: Number(r?.startAge),
        stopAge: Number(r?.stopAge),
        amount: Number(r?.amount)
      }))
      .filter(r => Number.isFinite(r.startAge) && Number.isFinite(r.stopAge) && Number.isFinite(r.amount))
      .filter(r => r.stopAge > r.startAge)
      .map(r => ({
        startAge: r.startAge,
        stopAge: r.stopAge,
        amount: Math.max(0, r.amount)
      }));
  }
  // Backward-compatible fallback: a single flat annual contribution until retirement
  const annual = Number(params?.annualContrib);
  const currentAge = Number(params?.currentAge);
  const retireAge = Number(params?.retireAge);
  if (Number.isFinite(annual) && Number.isFinite(currentAge) && Number.isFinite(retireAge) && retireAge > currentAge) {
    return [{ startAge: currentAge, stopAge: retireAge, amount: Math.max(0, annual) }];
  }
  return [];
}

function annualContributionForAge(age, params) {
  const a = Number(age);
  const retireAge = Number(params?.retireAge);
  if (!Number.isFinite(a) || !Number.isFinite(retireAge) || a >= retireAge) return 0;
  const schedule = normalizeContribSchedule(params);
  if (!schedule.length) return 0;
  let sum = 0;
  for (const r of schedule) {
    // Convention: start <= age < stop
    const start = Number(r.startAge);
    const stop = Math.min(Number(r.stopAge), retireAge);
    const amt = Number(r.amount);
    if (!Number.isFinite(start) || !Number.isFinite(stop) || !Number.isFinite(amt)) continue;
    if (a >= start && a < stop) sum += amt;
  }
  return Math.max(0, sum);
}

function withExtraAnnualSavings(params, extraAnnual) {
  const extra = Math.max(0, Number(extraAnnual) || 0);
  const schedule = Array.isArray(params?.contribSchedule) ? params.contribSchedule : null;
  if (schedule && schedule.length) {
    const normalized = normalizeContribSchedule(params);
    const anyPositive = normalized.some(r => Number(r.amount) > 0);
    const bumped = normalized.map(r => {
      const base = Number(r.amount) || 0;
      const shouldBump = anyPositive ? base > 0 : true;
      return { ...r, amount: Math.max(0, base + (shouldBump ? extra : 0)) };
    });
    return { ...params, contribSchedule: bumped };
  }
  const baseAnnual = Number(params?.annualContrib) || 0;
  return { ...params, annualContrib: Math.max(0, baseAnnual + extra) };
}

function buildSavingsSuggestionConfig(mcConfig) {
  if (!mcConfig) return null;
  const baseSims = Number(mcConfig.numSims) || 0;
  let suggestionSims = Math.floor(baseSims * 0.6);
  if (!Number.isFinite(suggestionSims) || suggestionSims <= 0) {
    suggestionSims = baseSims > 0 ? baseSims : 500;
  }
  suggestionSims = Math.max(200, Math.min(2000, suggestionSims));
  return { ...mcConfig, numSims: suggestionSims };
}

function estimateAdditionalAnnualSavings(params, mcConfig, baseMcResult, target = SAVINGS_TARGET_SUCCESS) {
  if (!params || !mcConfig || !baseMcResult) return null;
  const baseSuccess = baseMcResult.successProb;
  if (!Number.isFinite(baseSuccess)) return null;
  if (baseSuccess >= target) {
    return {
      extraAnnual: 0,
      achievedSuccess: baseSuccess,
      target
    };
  }
  const suggestionConfig = buildSavingsSuggestionConfig(mcConfig);
  if (!suggestionConfig) return null;
  const cache = new Map();
  const maxExtra = MAX_SAVINGS_SEARCH;

  const runTrial = extra => {
    const safeExtra = Math.max(0, extra);
    const key = safeExtra.toFixed(2);
    if (cache.has(key)) return cache.get(key);
    const trialParams = withExtraAnnualSavings(params, safeExtra);
    const trialResult = runMonteCarlo(trialParams, suggestionConfig);
    cache.set(key, trialResult.successProb);
    return trialResult.successProb;
  };

  let lowExtra = 0;
  let highExtra = 0;
  let highSuccess = baseSuccess;
  let guard = 0;
  while (highExtra < maxExtra && highSuccess < target && guard < 12) {
    highExtra = highExtra === 0 ? 5000 : highExtra * 2;
    if (highExtra > maxExtra) highExtra = maxExtra;
    highSuccess = runTrial(highExtra);
    guard += 1;
    if (highSuccess >= target) break;
    if (highExtra >= maxExtra) break;
  }

  if (highSuccess < target) {
    return {
      extraAnnual: null,
      achievedSuccess: highSuccess,
      target
    };
  }

  let bestExtra = highExtra;
  let bestSuccess = highSuccess;
  for (let i = 0; i < 14; i++) {
    if (highExtra - lowExtra < SAVINGS_MIN_INCREMENT) break;
    const midExtra = (lowExtra + highExtra) / 2;
    const midSuccess = runTrial(midExtra);
    if (midSuccess >= target) {
      bestExtra = midExtra;
      bestSuccess = midSuccess;
      highExtra = midExtra;
      highSuccess = midSuccess;
    } else {
      lowExtra = midExtra;
    }
  }

  const roundedExtra = Math.max(0, Math.ceil(bestExtra / SAVINGS_MIN_INCREMENT) * SAVINGS_MIN_INCREMENT);
  const roundedSuccess = runTrial(roundedExtra);
  return {
    extraAnnual: roundedExtra,
    achievedSuccess: roundedSuccess,
    target
  };
}

function estimateAdditionalWorkYears(params, mcConfig, baseMcResult, target = SAVINGS_TARGET_SUCCESS) {
  if (!params || !mcConfig || !baseMcResult) return null;
  const baseSuccess = baseMcResult.successProb;
  if (!Number.isFinite(baseSuccess)) return null;
  if (baseSuccess >= target) {
    return {
      extraYears: 0,
      achievedSuccess: baseSuccess,
      target,
      retireAge: params.retireAge
    };
  }
  if (params.retireAge >= params.endAge - 1) {
    return {
      extraYears: null,
      achievedSuccess: baseSuccess,
      target,
      retireAge: params.retireAge
    };
  }
  const suggestionConfig = buildSavingsSuggestionConfig(mcConfig);
  if (!suggestionConfig) return null;
  const maxYears = Math.max(
    0,
    Math.min(MAX_EXTRA_WORK_YEARS, params.endAge - params.retireAge - 1)
  );
  if (maxYears <= 0) {
    return {
      extraYears: null,
      achievedSuccess: baseSuccess,
      target,
      retireAge: params.retireAge
    };
  }
  let bestYears = null;
  let bestSuccess = baseSuccess;
  for (let years = 1; years <= maxYears; years++) {
    const trialRetireAge = Math.min(params.endAge - 1, params.retireAge + years);
    if (trialRetireAge <= params.retireAge) continue;
    const trialParams = { ...params, retireAge: trialRetireAge };
    const trialResult = runMonteCarlo(trialParams, suggestionConfig);
    const success = trialResult.successProb;
    if (success >= target) {
      bestYears = years;
      bestSuccess = success;
      break;
    }
    if (success > bestSuccess) {
      bestSuccess = success;
    }
  }
  if (bestYears === null) {
    return {
      extraYears: null,
      achievedSuccess: bestSuccess,
      target,
      retireAge: Math.min(params.endAge - 1, params.retireAge + maxYears)
    };
  }
  return {
    extraYears: bestYears,
    achievedSuccess: bestSuccess,
    target,
    retireAge: Math.min(params.endAge - 1, params.retireAge + bestYears)
  };
}

/**
 * Estimates how much extra annual spending (in today's dollars) would result in
 * a chosen percentile simulation ending at approximately $0 at the plan end age.
 * This is useful for "die with zero" style planning.
 * 
 * @param {Object} params - The retirement parameters
 * @param {Object} mcConfig - Monte Carlo configuration
 * @param {Object} baseMcResult - Result from initial Monte Carlo run
 * @returns {Object|null} { baseIncomeNeed, results: { p10, p50, p90 } }
 */
function estimateExtraAnnualSpending(params, mcConfig, baseMcResult) {
  if (!params || !mcConfig || !baseMcResult) return null;
  
  const sortedFinalBalances = [...baseMcResult.finalBalances].sort((a, b) => a - b);
  const baseP10Final = sortedFinalBalances[Math.floor(sortedFinalBalances.length * 0.1)];
  const baseP50Final = sortedFinalBalances[Math.floor(sortedFinalBalances.length * 0.5)];
  const baseP90Final = sortedFinalBalances[Math.floor(sortedFinalBalances.length * 0.9)];
  const baseIncomeNeed = params.incomeNeed;
  
  if (!Number.isFinite(baseP50Final) || !Number.isFinite(baseIncomeNeed)) return null;
  
  const suggestionConfig = buildSavingsSuggestionConfig(mcConfig);
  if (!suggestionConfig) return null;
  
  const cache = new Map();
  const maxExtra = MAX_EXTRA_SPENDING_SEARCH;
  
  const runTrial = extra => {
    const safeExtra = Math.max(0, extra);
    const key = safeExtra.toFixed(2);
    if (cache.has(key)) return cache.get(key);
    
    // Increase income need (spending) by the extra amount
    const trialParams = { 
      ...params, 
      incomeNeed: Math.max(0, baseIncomeNeed + safeExtra),
      incomeNeedBaseline: Math.max(0, (params.incomeNeedBaseline || baseIncomeNeed) + safeExtra)
    };
    const trialResult = runMonteCarlo(trialParams, suggestionConfig);
    const trialSorted = [...trialResult.finalBalances].sort((a, b) => a - b);
    const p10Final = trialSorted[Math.floor(trialSorted.length * 0.1)];
    const p50Final = trialSorted[Math.floor(trialSorted.length * 0.5)];
    const p90Final = trialSorted[Math.floor(trialSorted.length * 0.9)];
    const result = { p10Final, p50Final, p90Final, successProb: trialResult.successProb };
    cache.set(key, result);
    return result;
  };
  
  // Target: percentile final balance between 0 and a small positive threshold.
  // Allow up to 0.5x income need as "close to zero".
  const targetThreshold = baseIncomeNeed * 0.5;

  const solveForQuantile = (label, baseFinal, pickFinal) => {
    if (!Number.isFinite(baseFinal)) {
      return {
        extraAnnual: null,
        finalBalance: null,
        newTotalIncome: baseIncomeNeed,
        successProb: undefined,
        message: `${label} final balance is unavailable.`
      };
    }

    // If this percentile is already near-depleted, can't spend more (for that percentile).
    if (baseFinal <= targetThreshold) {
      return {
        extraAnnual: 0,
        finalBalance: baseFinal,
        newTotalIncome: baseIncomeNeed,
        successProb: baseMcResult.successProb,
        message: `${label} balance is already near $0 at plan end.`
      };
    }

    let lowExtra = 0;
    let highExtra = 0;
    let highResult = runTrial(0);
    let guard = 0;

    // Find an upper bound where the chosen percentile drops to <= targetThreshold
    while (highExtra < maxExtra && pickFinal(highResult) > targetThreshold && guard < 12) {
      highExtra = highExtra === 0 ? 10000 : highExtra * 2;
      if (highExtra > maxExtra) highExtra = maxExtra;
      highResult = runTrial(highExtra);
      guard += 1;
      if (highExtra >= maxExtra) break;
    }

    // If even max extra spending doesn't bring this percentile close to zero, return max
    if (pickFinal(highResult) > targetThreshold) {
      return {
        extraAnnual: maxExtra,
        finalBalance: pickFinal(highResult),
        newTotalIncome: baseIncomeNeed + maxExtra,
        successProb: highResult.successProb,
        message: `Even adding ${maxExtra.toLocaleString()} per year keeps ${label} final balance positive.`
      };
    }

    // Binary search for the smallest extra that gets <= targetThreshold
    let bestExtra = highExtra;
    let bestResult = highResult;
    for (let i = 0; i < 14; i++) {
      if (highExtra - lowExtra < SPENDING_MIN_INCREMENT) break;
      const midExtra = (lowExtra + highExtra) / 2;
      const midResult = runTrial(midExtra);
      if (pickFinal(midResult) <= targetThreshold) {
        bestExtra = midExtra;
        bestResult = midResult;
        highExtra = midExtra;
        highResult = midResult;
      } else {
        lowExtra = midExtra;
      }
    }

    const roundedExtra = Math.max(
      0,
      Math.floor(bestExtra / SPENDING_MIN_INCREMENT) * SPENDING_MIN_INCREMENT
    );
    const finalResult = runTrial(roundedExtra);
    return {
      extraAnnual: roundedExtra,
      finalBalance: pickFinal(finalResult),
      newTotalIncome: baseIncomeNeed + roundedExtra,
      successProb: finalResult.successProb
    };
  };

  const p10 = solveForQuantile("p10", baseP10Final, r => r.p10Final);
  const p50 = solveForQuantile("p50", baseP50Final, r => r.p50Final);
  const p90 = solveForQuantile("p90", baseP90Final, r => r.p90Final);

  return { baseIncomeNeed, results: { p10, p50, p90 } };
}

function withdrawFromBalance(balance, amount) {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { balance, shortage: 0, withdrawn: 0 };
  }
  const withdrawn = Math.min(amount, balance);
  return { balance: balance - withdrawn, shortage: amount - withdrawn, withdrawn };
}

function applyGrowthToBalance(balance, rate) {
  if (!Number.isFinite(rate)) return balance;
  return balance * (1 + rate);
}

function totalPortfolio(balance, bondReserve) {
  return balance + (bondReserve || 0);
}

// Bond tenting constants and functions
const BOND_RETURN_RATE = 0.025; // 2.5% nominal return for bonds/T-bills

function calculateBondTargetReserve(yearsOfExpenses, annualExpenses) {
  if (!Number.isFinite(yearsOfExpenses) || yearsOfExpenses <= 0) return 0;
  if (!Number.isFinite(annualExpenses) || annualExpenses <= 0) return 0;
  return yearsOfExpenses * annualExpenses;
}

function withdrawFromBonds(bondReserve, amount) {
  if (!Number.isFinite(amount) || amount <= 0) return { withdrawn: 0, remaining: 0 };
  const withdrawn = Math.min(bondReserve, amount);
  return { withdrawn, remaining: amount - withdrawn };
}

function sampleRegimeFromFrequencies(frequencies) {
  const r = Math.random();
  if (r < frequencies.bear) return "bear";
  if (r < frequencies.bear + frequencies.flat) return "flat";
  return "bull";
}

function sampleRegimeFromTransition(currentRegime, transitionMatrix, frequencies) {
  const matrix = transitionMatrix[currentRegime];
  if (!matrix) return sampleRegimeFromFrequencies(frequencies); // Fallback
  
  const r = Math.random();
  if (r < matrix.bear) return "bear";
  if (r < matrix.bear + matrix.flat) return "flat";
  return "bull";
}

function sampleYearFromRegime(regime, yearsByRegime, fallbackSeries) {
  const years = yearsByRegime[regime];
  if (!years || years.length === 0) {
    // Fallback: return a default year from the fallback series
    return fallbackSeries[Math.floor(Math.random() * fallbackSeries.length)];
  }
  return years[Math.floor(Math.random() * years.length)];
}

function buildRegimeMarkovSequencer(horizonYears, useModernEra = false) {
  const historicalYears = useModernEra ? HISTORICAL_YEARS_WITH_REGIME_1980 : HISTORICAL_YEARS_WITH_REGIME;
  const transitionMatrix = useModernEra ? REGIME_TRANSITION_MATRIX_1980 : REGIME_TRANSITION_MATRIX;
  const frequencies = useModernEra ? REGIME_FREQUENCIES_1980 : REGIME_FREQUENCIES;
  const yearsByRegime = useModernEra ? YEARS_BY_REGIME_1980 : YEARS_BY_REGIME;
  const fallbackSeries = useModernEra ? RETURN_INFLATION_SERIES_1980 : RETURN_INFLATION_SERIES;

  if (historicalYears.length === 0) {
    return () => ({ r: 0, inflation: LAST_KNOWN_INFLATION });
  }

  // Option B: Start with the regime of the most recent year
  const lastYear = historicalYears[historicalYears.length - 1];
  let currentRegime = lastYear ? lastYear.regime : sampleRegimeFromFrequencies(frequencies);

  // Pre-generate the entire sequence
  const sampledSequence = [];
  for (let t = 0; t < horizonYears; t++) {
    // Sample a year from the current regime
    const year = sampleYearFromRegime(currentRegime, yearsByRegime, fallbackSeries);
    sampledSequence.push(year);

    // Transition to next regime for the next year (except for the last iteration)
    if (t < horizonYears - 1) {
      currentRegime = sampleRegimeFromTransition(currentRegime, transitionMatrix, frequencies);
    }
  }

  return yearOffset => {
    return sampledSequence[yearOffset] ?? sampledSequence[sampledSequence.length - 1];
  };
}

function sampleNormal(mean, stdev) {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + stdev * z;
}

function computeGoalWithdrawal(age, params, inflationOverride) {
  const effectiveInflation = Number.isFinite(inflationOverride)
    ? inflationOverride
    : params.inflation;
  if (!params.goalEvents || !params.goalEvents.length) return 0;
  return params.goalEvents.reduce((sum, goal) => {
    if (!Number.isFinite(goal.age) || goal.age !== age) return sum;
    if (!Number.isFinite(goal.amount) || goal.amount <= 0) return sum;
    const years = Math.max(0, age - params.currentAge);
    return sum + goal.amount * Math.pow(1 + effectiveInflation, years);
  }, 0);
}


function getSpendingTarget(age, params, spendingState, inflationOverride, cumulativeInflationFactor, portfolioValue) {
  const effectiveInflation = Number.isFinite(inflationOverride)
    ? inflationOverride
    : params.inflation;
  const incomeMode = params.incomeNeedMode || "fixed";
  const incomeNeedPct = Number.isFinite(params.incomeNeedPct) ? Math.max(0, params.incomeNeedPct) : 0;
  const baselineNeed = Number.isFinite(params.incomeNeedBaseline) && params.incomeNeedBaseline > 0
    ? params.incomeNeedBaseline
    : params.incomeNeed;
  if (age < params.retireAge) {
    spendingState.prev = null;
    return { target: 0, fixedInflated: 0 };
  }
  const fixedInflated = baselineNeed * (
    Number.isFinite(cumulativeInflationFactor)
      ? cumulativeInflationFactor
      : Math.pow(1 + effectiveInflation, Math.max(0, age - params.currentAge))
  );
  let targetBase;
  if (incomeMode === "portfolio_pct" && Number.isFinite(portfolioValue) && portfolioValue > 0 && incomeNeedPct > 0) {
    const pctBasedTarget = portfolioValue * incomeNeedPct;
    // Avoid withdrawing more than the inflated baseline need even if the percentage
    // would allow a larger withdrawal in strong market years.
    targetBase = Math.min(fixedInflated, pctBasedTarget);
  } else if (incomeMode === "portfolio_pct_uncapped" && Number.isFinite(portfolioValue) && portfolioValue > 0 && incomeNeedPct > 0) {
    targetBase = portfolioValue * incomeNeedPct;
  } else {
    targetBase = fixedInflated;
  }
  if (params.spendingStrategy !== "guardrail") {
    spendingState.prev = targetBase;
    return { target: targetBase, fixedInflated };
  }
  const prev = spendingState.prev ?? targetBase;
  const inflationBump = prev * (1 + effectiveInflation);
  const floor = prev * 0.9;
  const cap = prev * 1.1;
  let target = Math.min(Math.max(inflationBump, floor), cap);
  target = Math.max(target, targetBase);
  spendingState.prev = target;
  return { target, fixedInflated };
}

function simulateDeterministic(params, opts = {}) {
  let balance = params.currentSavings;
  let age = params.currentAge;
  const preRetReturn = Number.isFinite(params.preRetReturn) ? params.preRetReturn : 0;
  const postRetReturn = Number.isFinite(params.postRetReturn) ? params.postRetReturn : 0;
  const years = [];
  const balances = [];
  const incomeNeeded = [];
  const coverageFlags = [];
  const incomeBenchmarks = [];
  const spendingState = { prev: null };
  const customReturns = opts.customReturns || null;

  const pickReturn = (yearAge, defaultRate) => {
    if (!customReturns) return defaultRate;
    const offset = yearAge - params.currentAge;
    if (offset >= 0 && offset < customReturns.length) {
      return customReturns[offset];
    }
    return defaultRate;
  };

  while (age <= params.endAge) {
    years.push(age);
    balances.push(balance);
    let coverageMet = true;

    const goalWithdrawal = computeGoalWithdrawal(age, params);
    if (goalWithdrawal > 0) {
      const goalResult = withdrawFromBalance(balance, goalWithdrawal);
      balance = goalResult.balance;
      if (goalResult.shortage > 1e-4) {
        coverageMet = false;
      }
    }

    const isWorking = age < params.retireAge;
    if (isWorking) {
      incomeNeeded.push(0);
      incomeBenchmarks.push(0);
      balance += annualContributionForAge(age, params);
      balance = applyGrowthToBalance(balance, pickReturn(age, preRetReturn));
    } else {
      const portfolioValue = balance;
      const { target: desiredAfterTax, fixedInflated } = getSpendingTarget(
        age,
        params,
        spendingState,
        undefined,
        undefined,
        portfolioValue
      );
      incomeBenchmarks.push(fixedInflated);
      incomeNeeded.push(desiredAfterTax);
      const grossWithdrawal = desiredAfterTax / params.afterTaxFactor;
      const withdrawalResult = withdrawFromBalance(balance, grossWithdrawal);
      balance = withdrawalResult.balance;
      if (withdrawalResult.shortage > 1e-4) {
        coverageMet = false;
      }
      balance = applyGrowthToBalance(balance, pickReturn(age, postRetReturn));
    }

    coverageFlags.push(coverageMet);
    age += 1;
  }

  return {
    years,
    balances,
    incomeNeeded,
    coverageFlags,
    incomeBenchmarks,
    finalBalance: balance
  };
}

function simulateOneMCPath(params, mcConfig, historicalSequencerFactory, minIncomeCoverage) {
  let balance = params.currentSavings;
  let age = params.currentAge;
  const balances = [];
  const coverage = [];
  const returns = [];
  const inflations = [];
  const withdrawals = [];
  const balanceRates = [];
  const incomeBenchmarks = [];
  const spendingTargets = [];
  const actualAfterTaxIncomes = [];
  const spendingState = { prev: null };
  const coverageFull = [];
  const coverageRatios = [];
  const coverageFloor = clamp(
    Number.isFinite(minIncomeCoverage) ? minIncomeCoverage : DEFAULT_MIN_INCOME_COVERAGE,
    0,
    1
  );
  let pathMinCoverage = 1;
  let cumulativeInflationFactor = 1;
  const useHistoricalInflation = params.inflationMode === "historical";
  const useSequencer =
    mcConfig.mode === "historical_regime_markov" || mcConfig.mode === "historical_regime_markov_1980";
  const sequencer =
    useSequencer && historicalSequencerFactory
      ? historicalSequencerFactory()
      : null;
  
  // Bond tenting setup (only works with regime-based Markov mode)
  const bondTentingEnabled = params.bondTentingEnabled && params.bondTentingYears > 0 && useSequencer;
  let bondReserve = 0;
  let bondTargetReserve = 0;

  while (age <= params.endAge) {
    const balanceAtStartOfYear = totalPortfolio(balance, bondReserve);
    balances.push(balanceAtStartOfYear);
    let coverageMet = true;
    let coverageRatio = 1;
    const yearOffset = age - params.currentAge;
    let inflationOverride = params.inflation;

    let r;
    let seqStep = null;
    if (useSequencer && sequencer) {
      seqStep = sequencer(yearOffset) || {};
      r = seqStep.r ?? 0;
    } else {
      r = sampleNormal(mcConfig.mean, mcConfig.stdev);
    }
    if (useHistoricalInflation && seqStep && Number.isFinite(Number(seqStep.inflation))) {
      const shifted = clamp(
        Number(seqStep.inflation) / 100,
        -0.01,
        0.12
      );
      inflationOverride = shifted;
    } else {
      inflationOverride = params.inflation;
    }
    if (!Number.isFinite(inflationOverride)) {
      inflationOverride = params.inflation;
    }

    const goalWithdrawal = computeGoalWithdrawal(age, params, inflationOverride);
    const cappedGoalRequest = Math.max(0, Math.min(goalWithdrawal, totalPortfolio(balance, bondReserve)));
    let goalResult = { balance, shortage: 0 };
    if (cappedGoalRequest > 0) {
      goalResult = withdrawFromBalance(balance, cappedGoalRequest);
      balance = goalResult.balance;
    }
    const actualGoalWithdrawal = cappedGoalRequest - (goalResult.shortage || 0);
    if (goalResult.shortage > 1e-4) {
      coverageMet = false;
    }
    let totalWithdrawal = actualGoalWithdrawal;

    if (age < params.retireAge) {
      balance += annualContributionForAge(age, params);
      balance = applyGrowthToBalance(balance, r);
      // Apply bond returns during accumulation
      if (bondTentingEnabled) {
        bondReserve = applyGrowthToBalance(bondReserve, BOND_RETURN_RATE);
      }
      incomeBenchmarks.push(0);
      spendingTargets.push(0);
      actualAfterTaxIncomes.push(0);
    } else {
      // Initialize bond reserve at start of retirement
      // Note: Moving money from stocks to bonds reduces expected returns but protects against
      // sequence of returns risk. This trade-off may reduce overall success probability but
      // provides more stability during market downturns.
      if (bondTentingEnabled && age === params.retireAge) {
        const desiredAfterTax = getSpendingTarget(age, params, spendingState, inflationOverride);
        bondTargetReserve = calculateBondTargetReserve(params.bondTentingYears, desiredAfterTax);
        const totalAvailable = balance;
        // Limit initial allocation to 20% of portfolio to minimize drag on returns
        const initialBondAllocation = Math.min(bondTargetReserve, totalAvailable * 0.2);
        if (initialBondAllocation > 0 && totalAvailable > 0) {
          balance -= initialBondAllocation;
          bondReserve = initialBondAllocation;
        }
      }

      // Apply returns first
      balance = applyGrowthToBalance(balance, r);
      if (bondTentingEnabled) {
        bondReserve = applyGrowthToBalance(bondReserve, BOND_RETURN_RATE);
      }

      // Calculate spending needs
      const spendingInflationFactor = cumulativeInflationFactor;
      const portfolioValue = totalPortfolio(balance, bondReserve);
      const { target: desiredAfterTax, fixedInflated } = getSpendingTarget(
        age,
        params,
        spendingState,
        inflationOverride,
        spendingInflationFactor,
        portfolioValue
      );
      incomeBenchmarks.push(fixedInflated);
      spendingTargets.push(desiredAfterTax);
      const gross = desiredAfterTax / params.afterTaxFactor;
      // Cap spending request to what is actually available after growth/goal withdrawals
      const availableForSpending = totalPortfolio(balance, bondReserve);
      const spendingRequest = Math.min(Math.max(0, gross), availableForSpending);
      let actualSpendingWithdrawal = 0;

      // Bond tenting withdrawal logic
      if (bondTentingEnabled && spendingRequest > 0) {
        bondTargetReserve = calculateBondTargetReserve(params.bondTentingYears, desiredAfterTax);
        const regime = seqStep?.regime;
        let remainingWithdrawal = spendingRequest;

        // In bear/flat regimes, withdraw from bonds first
        if (regime === "bear" || regime === "flat") {
          const bondWithdrawal = withdrawFromBonds(bondReserve, remainingWithdrawal);
          bondReserve -= bondWithdrawal.withdrawn;
          remainingWithdrawal = bondWithdrawal.remaining;
          actualSpendingWithdrawal += bondWithdrawal.withdrawn;
        }

        // Withdraw remaining amount from stocks
        if (remainingWithdrawal > 0) {
          const result = withdrawFromBalance(balance, remainingWithdrawal);
          balance = result.balance;
          actualSpendingWithdrawal += remainingWithdrawal - result.shortage;
          if (result.shortage > 1e-4) {
            coverageMet = false;
          }
        }

        // In bull regime, only refill bonds if they're critically low (below 1 year's expenses)
        // and stocks have grown enough. This prevents moving money from high-return stocks 
        // to low-return bonds when bonds are just slightly below target.
        if (regime === "bull" && bondReserve < bondTargetReserve) {
          const stocksAvailable = balance;
          const oneYearExpenses = desiredAfterTax;
          
          // Only refill if bonds are critically low (below 1 year of expenses)
          // This allows bonds to naturally rebuild through their own returns
          // and only intervenes when bonds are nearly depleted
          if (bondReserve < oneYearExpenses && stocksAvailable > oneYearExpenses * 2) {
            // Refill up to 2 years of expenses (conservative target when bonds are low)
            const conservativeTarget = Math.min(bondTargetReserve, oneYearExpenses * 2);
            const refillAmount = Math.min(
              conservativeTarget - bondReserve,
              stocksAvailable * 0.15 // Limit to 15% of stocks
            );
            
            if (refillAmount > 0 && stocksAvailable > 0) {
              balance -= refillAmount;
              bondReserve += refillAmount;
            }
          }
        }
      } else if (spendingRequest > 0) {
        // No bond tenting - standard withdrawal
        const result = withdrawFromBalance(balance, spendingRequest);
        balance = result.balance;
        actualSpendingWithdrawal += spendingRequest - result.shortage;
        if (result.shortage > 1e-4) {
          coverageMet = false;
        }
      }

      const totalAfterTaxIncome = actualSpendingWithdrawal * params.afterTaxFactor;
      coverageRatio = fixedInflated > 0 ? totalAfterTaxIncome / fixedInflated : 1;
      if (coverageRatio + 1e-9 < coverageFloor) {
        coverageMet = false;
      }
      actualAfterTaxIncomes.push(totalAfterTaxIncome);

      // Total withdrawal is what was actually taken for goals plus spending,
      // not any market-driven balance change.
      totalWithdrawal = actualGoalWithdrawal + actualSpendingWithdrawal;
    }

    // Track metrics at the end of the year
    const balanceAtEndOfYear = totalPortfolio(balance, bondReserve);
    const balanceRate = balanceAtStartOfYear > 0 
      ? (balanceAtEndOfYear - balanceAtStartOfYear) / balanceAtStartOfYear 
      : 0;
    
    returns.push(r * 100); // Store as percentage
    inflations.push(inflationOverride * 100); // Store as percentage
    withdrawals.push(totalWithdrawal);
    balanceRates.push(balanceRate * 100); // Store as percentage

    const metFullNeed = coverageMet && coverageRatio >= 1 - 1e-9;
    coverageFull.push(metFullNeed);
    coverage.push(metFullNeed);
    coverageRatios.push(Math.max(0, coverageRatio));
    const effectiveCoverageRatio = coverageMet ? coverageRatio : Math.min(coverageRatio, 1 - 1e-10);
    pathMinCoverage = Math.min(pathMinCoverage, effectiveCoverageRatio);

    // If the portfolio is depleted, stop the simulation and fill the
    // remaining years with zeros to avoid phantom withdrawals/balances.
    if (balanceAtEndOfYear <= 1e-6) {
      const remainingYears = params.endAge - age;
      if (remainingYears > 0) {
        pathMinCoverage = 0;
      }
      const lastTarget = spendingTargets[spendingTargets.length - 1] || 0;
      const assumedInflation = Number.isFinite(inflationOverride) ? inflationOverride : params.inflation || 0;
      let futureNeed = lastTarget;
      for (let i = 0; i < remainingYears; i++) {
        // Carry forward the last known need with steady inflation so we can
        // surface shortfall amounts in the UI after depletion.
        futureNeed *= 1 + assumedInflation;
        balances.push(0);
        coverage.push(false);
        coverageFull.push(false);
        coverageRatios.push(0);
        returns.push(0);
        inflations.push(assumedInflation * 100);
        withdrawals.push(0);
        balanceRates.push(0);
        incomeBenchmarks.push(0);
        spendingTargets.push(futureNeed);
        actualAfterTaxIncomes.push(0);
      }
      break;
    }

    // Update cumulative inflation after using it for this year's spend calculation
    cumulativeInflationFactor *= (1 + inflationOverride);

    age += 1;
  }

  return {
    balances,
    coverage,
    returns,
    inflations,
    withdrawals,
    balanceRates,
    incomeBenchmarks,
    spendingTargets,
    actualAfterTaxIncomes,
    coverageFull,
    coverageRatios,
    minCoverageRatio: pathMinCoverage
  };
}

function runMonteCarlo(params, mcConfig) {
  const minIncomeCoverage = clamp(
    Number.isFinite(params?.minIncomeCoverage) ? params.minIncomeCoverage : DEFAULT_MIN_INCOME_COVERAGE,
    0,
    1
  );
  const horizonYears = params.endAge - params.currentAge + 1;
  const paths = [];
  const returnPaths = [];
  const inflationPaths = [];
  const withdrawalPaths = [];
  const balanceRatePaths = [];
  const benchmarkPaths = [];
  const spendingTargetPaths = [];
  const actualIncomePaths = [];
  const coverageRatioPaths = [];
  const finalBalances = [];
  const successFlags = [];
  const coverageCounts = new Array(horizonYears).fill(0);
  const coverageFullPaths = [];
  const useModernEra = mcConfig.mode === "historical_regime_markov_1980";
  const historicalSequencerFactory =
    mcConfig.mode === "historical_regime_markov" || mcConfig.mode === "historical_regime_markov_1980"
      ? () => buildRegimeMarkovSequencer(horizonYears, useModernEra)
      : null;

  const allSims = [];

  for (let i = 0; i < mcConfig.numSims; i++) {
    const result = simulateOneMCPath(
      params,
      mcConfig,
      historicalSequencerFactory,
      minIncomeCoverage
    );
    const {
      balances,
      coverage,
      returns,
      inflations,
      withdrawals,
      balanceRates,
      incomeBenchmarks,
      spendingTargets,
      actualAfterTaxIncomes,
      coverageFull,
      coverageRatios,
      minCoverageRatio
    } = result;

    allSims.push({
      id: i,
      balances: [...balances],
      returns: [...returns],
      inflations: [...inflations],
      withdrawals: [...withdrawals],
      benchmarks: [...incomeBenchmarks],
      finalBalance: balances[balances.length - 1],
      success: minCoverageRatio >= 1 - 1e-9,
      minCoverageRatio,
      shortfallYears: coverageFull.filter(f => !f).length
    });

    paths.push(balances);
    returnPaths.push(returns);
    inflationPaths.push(inflations);
    withdrawalPaths.push(withdrawals);
    balanceRatePaths.push(balanceRates);
    benchmarkPaths.push(incomeBenchmarks);
    spendingTargetPaths.push(spendingTargets);
    actualIncomePaths.push(actualAfterTaxIncomes);
    coverageRatioPaths.push(coverageRatios);
    finalBalances.push(balances[balances.length - 1]);
    coverageFullPaths.push(coverageFull);
    successFlags.push(minCoverageRatio >= 1 - 1e-9);
    coverageFull.forEach((flag, idx) => {
      if (flag) coverageCounts[idx] += 1;
    });
  }

  // Helper: Tukey boxplot stats (whiskers=1.5*IQR, outliers outside whiskers)
  const computeTukeyBoxplot = values => {
    if (!Array.isArray(values) || values.length === 0) return null;
    const sorted = values
      .map(v => Number(v))
      .filter(v => Number.isFinite(v))
      .sort((a, b) => a - b);
    if (!sorted.length) return null;
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const q1 = percentile(sorted, 0.25);
    const median = percentile(sorted, 0.5);
    const q3 = percentile(sorted, 0.75);
    const iqr = q3 - q1;
    const lowFence = q1 - 1.5 * iqr;
    const highFence = q3 + 1.5 * iqr;

    let whiskerLow = min;
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i] >= lowFence) {
        whiskerLow = sorted[i];
        break;
      }
    }
    let whiskerHigh = max;
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i] <= highFence) {
        whiskerHigh = sorted[i];
        break;
      }
    }

    const outliers = [];
    for (let i = 0; i < sorted.length; i++) {
      const v = sorted[i];
      if (v < whiskerLow || v > whiskerHigh) outliers.push(v);
    }

    return {
      min,
      q1,
      median,
      q3,
      max,
      whiskerLow,
      whiskerHigh,
      outliers
    };
  };

  // Per-year boxplot stats for balances (start-of-year balances)
  const balanceBoxplots = new Array(horizonYears).fill(null);
  for (let t = 0; t < horizonYears; t++) {
    const values = paths.map(path => (Array.isArray(path) ? path[t] : 0));
    balanceBoxplots[t] = computeTukeyBoxplot(values);
  }

  // Step 1: Identify percentile paths based on final balance
  // Create indexed pairs: (finalBalance, pathIndex)
  const indexedFinalBalances = finalBalances.map((balance, index) => ({ balance, index }));
  indexedFinalBalances.sort((a, b) => a.balance - b.balance);

  // Find the path indices at percentile positions
  const p10PathIndex = indexedFinalBalances[Math.floor(indexedFinalBalances.length * 0.1)].index;
  const p50PathIndex = indexedFinalBalances[Math.floor(indexedFinalBalances.length * 0.5)].index;
  const p90PathIndex = indexedFinalBalances[Math.floor(indexedFinalBalances.length * 0.9)].index;

  // Track the highest-percentile path that still fails (final balance <= 0)
  let failurePath = null;
  for (let i = indexedFinalBalances.length - 1; i >= 0; i--) {
    if (indexedFinalBalances[i].balance <= 0) {
      const failPathIndex = indexedFinalBalances[i].index;
      const percentileRank = (i + 1) / indexedFinalBalances.length;
      failurePath = {
        percentile: percentileRank,
        balances: paths[failPathIndex] ? [...paths[failPathIndex]] : [],
        returns: returnPaths[failPathIndex] ? [...returnPaths[failPathIndex]] : [],
        inflations: inflationPaths[failPathIndex] ? [...inflationPaths[failPathIndex]] : [],
        withdrawals: withdrawalPaths[failPathIndex] ? [...withdrawalPaths[failPathIndex]] : [],
        balanceRates: balanceRatePaths[failPathIndex] ? [...balanceRatePaths[failPathIndex]] : [],
        benchmarks: benchmarkPaths[failPathIndex] ? [...benchmarkPaths[failPathIndex]] : []
      };
      break;
    }
  }

  // Step 2: Extract complete trajectories from those specific paths
  const sortedBalances = {
    p10: paths[p10PathIndex] ? [...paths[p10PathIndex]] : [],
    p50: paths[p50PathIndex] ? [...paths[p50PathIndex]] : [],
    p90: paths[p90PathIndex] ? [...paths[p90PathIndex]] : []
  };

  const sortedReturns = {
    p10: returnPaths[p10PathIndex] ? [...returnPaths[p10PathIndex]] : [],
    p50: returnPaths[p50PathIndex] ? [...returnPaths[p50PathIndex]] : [],
    p90: returnPaths[p90PathIndex] ? [...returnPaths[p90PathIndex]] : []
  };

  const sortedInflations = {
    p10: inflationPaths[p10PathIndex] ? [...inflationPaths[p10PathIndex]] : [],
    p50: inflationPaths[p50PathIndex] ? [...inflationPaths[p50PathIndex]] : [],
    p90: inflationPaths[p90PathIndex] ? [...inflationPaths[p90PathIndex]] : []
  };

  const sortedWithdrawals = {
    p10: withdrawalPaths[p10PathIndex] ? [...withdrawalPaths[p10PathIndex]] : [],
    p50: withdrawalPaths[p50PathIndex] ? [...withdrawalPaths[p50PathIndex]] : [],
    p90: withdrawalPaths[p90PathIndex] ? [...withdrawalPaths[p90PathIndex]] : []
  };

  const sortedBalanceRates = {
    p10: balanceRatePaths[p10PathIndex] ? [...balanceRatePaths[p10PathIndex]] : [],
    p50: balanceRatePaths[p50PathIndex] ? [...balanceRatePaths[p50PathIndex]] : [],
    p90: balanceRatePaths[p90PathIndex] ? [...balanceRatePaths[p90PathIndex]] : []
  };

  const sortedBenchmarks = {
    p10: benchmarkPaths[p10PathIndex] ? [...benchmarkPaths[p10PathIndex]] : [],
    p50: benchmarkPaths[p50PathIndex] ? [...benchmarkPaths[p50PathIndex]] : [],
    p90: benchmarkPaths[p90PathIndex] ? [...benchmarkPaths[p90PathIndex]] : []
  };

  const sortedSpendingTargets = {
    p10: spendingTargetPaths[p10PathIndex] ? [...spendingTargetPaths[p10PathIndex]] : [],
    p50: spendingTargetPaths[p50PathIndex] ? [...spendingTargetPaths[p50PathIndex]] : [],
    p90: spendingTargetPaths[p90PathIndex] ? [...spendingTargetPaths[p90PathIndex]] : []
  };

  const sortedActualIncomes = {
    p10: actualIncomePaths[p10PathIndex] ? [...actualIncomePaths[p10PathIndex]] : [],
    p50: actualIncomePaths[p50PathIndex] ? [...actualIncomePaths[p50PathIndex]] : [],
    p90: actualIncomePaths[p90PathIndex] ? [...actualIncomePaths[p90PathIndex]] : []
  };

  const sortedCoverageFull = {
    p10: coverageFullPaths[p10PathIndex] ? [...coverageFullPaths[p10PathIndex]] : [],
    p50: coverageFullPaths[p50PathIndex] ? [...coverageFullPaths[p50PathIndex]] : [],
    p90: coverageFullPaths[p90PathIndex] ? [...coverageFullPaths[p90PathIndex]] : []
  };

  const sortedCoverageRatios = {
    p10: coverageRatioPaths[p10PathIndex] ? [...coverageRatioPaths[p10PathIndex]] : [],
    p50: coverageRatioPaths[p50PathIndex] ? [...coverageRatioPaths[p50PathIndex]] : [],
    p90: coverageRatioPaths[p90PathIndex] ? [...coverageRatioPaths[p90PathIndex]] : []
  };

  // Also compute balance percentiles at each time step for the main chart (to maintain consistency)
  // But for the percentile scenario charts, we use the complete paths above
  const balancePercentilesByTime = {
    p10: [],
    p50: [],
    p90: []
  };

  for (let t = 0; t < horizonYears; t++) {
    const balanceValuesAtT = paths.map(p => p[t]);
    balanceValuesAtT.sort((a, b) => a - b);
    balancePercentilesByTime.p10.push(percentile(balanceValuesAtT, 0.1));
    balancePercentilesByTime.p50.push(percentile(balanceValuesAtT, 0.5));
    balancePercentilesByTime.p90.push(percentile(balanceValuesAtT, 0.9));
  }

  // Use time-based percentiles for the aggregate balance chart,
  // but keep the specific path series separate for the scenario charts
  const balancePercentiles = balancePercentilesByTime;

  const successProb = successFlags.reduce((acc, v) => acc + (v ? 1 : 0), 0) / mcConfig.numSims;

  return {
    p10: balancePercentiles.p10,
    p50: balancePercentiles.p50,
    p90: balancePercentiles.p90,
    successProb,
    finalBalances,
    coverageProb: coverageCounts.map(count => count / mcConfig.numSims),
    returns: sortedReturns,
    inflations: sortedInflations,
    withdrawals: sortedWithdrawals,
    balanceRates: sortedBalanceRates,
    benchmarks: sortedBenchmarks,
    spendingTargets: sortedSpendingTargets,
    actualIncomes: sortedActualIncomes,
    balancePaths: sortedBalances,
    coveragePaths: sortedCoverageFull,
    coverageRatios: sortedCoverageRatios,
    balanceBoxplots,
    failurePath,
    minIncomeCoverage,
    allSims
  };
}

export {
  buildSavingsSuggestionConfig,
  estimateAdditionalAnnualSavings,
  estimateAdditionalWorkYears,
  estimateExtraAnnualSpending,
  simulateDeterministic,
  runMonteCarlo,
  sampleRegimeFromTransition
};
