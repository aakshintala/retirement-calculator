export const HISTORICAL_RETURNS_SPY = [
  { year: 1928, r: 0.3788 },
  { year: 1929, r: -0.1191 },
  { year: 1930, r: -0.2848 },
  { year: 1931, r: -0.4707 },
  { year: 1932, r: -0.1515 },
  { year: 1933, r: 0.4659 },
  { year: 1934, r: -0.0594 },
  { year: 1935, r: 0.4137 },
  { year: 1936, r: 0.2792 },
  { year: 1937, r: -0.3859 },
  { year: 1938, r: 0.2521 },
  { year: 1939, r: -0.0545 },
  { year: 1940, r: -0.1529 },
  { year: 1941, r: -0.1786 },
  { year: 1942, r: 0.1243 },
  { year: 1943, r: 0.1945 },
  { year: 1944, r: 0.1380 },
  { year: 1945, r: 0.3072 },
  { year: 1946, r: -0.1187 },
  { year: 1947, r: 0.0000 },
  { year: 1948, r: -0.0065 },
  { year: 1949, r: 0.1026 },
  { year: 1950, r: 0.2178 },
  { year: 1951, r: 0.1646 },
  { year: 1952, r: 0.1178 },
  { year: 1953, r: -0.0662 },
  { year: 1954, r: 0.4502 },
  { year: 1955, r: 0.2640 },
  { year: 1956, r: 0.0262 },
  { year: 1957, r: -0.1431 },
  { year: 1958, r: 0.3806 },
  { year: 1959, r: 0.0848 },
  { year: 1960, r: -0.0297 },
  { year: 1961, r: 0.2313 },
  { year: 1962, r: -0.1181 },
  { year: 1963, r: 0.1889 },
  { year: 1964, r: 0.1297 },
  { year: 1965, r: 0.0906 },
  { year: 1966, r: -0.1309 },
  { year: 1967, r: 0.2009 },
  { year: 1968, r: 0.0766 },
  { year: 1969, r: -0.1136 },
  { year: 1970, r: 0.0010 },
  { year: 1971, r: 0.1079 },
  { year: 1972, r: 0.1563 },
  { year: 1973, r: -0.1737 },
  { year: 1974, r: -0.2972 },
  { year: 1975, r: 0.3155 },
  { year: 1976, r: 0.1915 },
  { year: 1977, r: -0.1150 },
  { year: 1978, r: 0.0106 },
  { year: 1979, r: 0.1231 },
  { year: 1980, r: 0.2577 },
  { year: 1981, r: -0.0973 },
  { year: 1982, r: 0.1476 },
  { year: 1983, r: 0.1727 },
  { year: 1984, r: 0.0140 },
  { year: 1985, r: 0.2633 },
  { year: 1986, r: 0.1462 },
  { year: 1987, r: 0.0203 },
  { year: 1988, r: 0.1240 },
  { year: 1989, r: 0.2725 },
  { year: 1990, r: -0.0656 },
  { year: 1991, r: 0.2631 },
  { year: 1992, r: 0.0446 },
  { year: 1993, r: 0.0706 },
  { year: 1994, r: -0.0154 },
  { year: 1995, r: 0.3411 },
  { year: 1996, r: 0.2026 },
  { year: 1997, r: 0.3101 },
  { year: 1998, r: 0.2667 },
  { year: 1999, r: 0.1953 },
  { year: 2000, r: -0.1014 },
  { year: 2001, r: -0.1304 },
  { year: 2002, r: -0.2337 },
  { year: 2003, r: 0.2638 },
  { year: 2004, r: 0.0899 },
  { year: 2005, r: 0.0300 },
  { year: 2006, r: 0.1362 },
  { year: 2007, r: 0.0353 },
  { year: 2008, r: -0.3849 },
  { year: 2009, r: 0.2345 },
  { year: 2010, r: 0.1278 },
  { year: 2011, r: 0.0000 },
  { year: 2012, r: 0.1341 },
  { year: 2013, r: 0.2960 },
  { year: 2014, r: 0.1139 },
  { year: 2015, r: -0.0073 },
  { year: 2016, r: 0.0954 },
  { year: 2017, r: 0.1942 },
  { year: 2018, r: -0.0624 },
  { year: 2019, r: 0.2888 },
  { year: 2020, r: 0.1626 },
  { year: 2021, r: 0.2689 },
  { year: 2022, r: -0.1944 },
  { year: 2023, r: 0.2423 },
  { year: 2024, r: 0.2331 },
];

// Calculate historical return statistics
function calculateHistoricalReturnStats() {
  const returns = HISTORICAL_RETURNS_SPY.map(entry => entry.r);
  const n = returns.length;
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (n - 1);
  const stdev = Math.sqrt(variance);
  
  return {
    mean: mean * 100,  // Convert to percentage
    stdev: stdev * 100
  };
}

export const HISTORICAL_STATS = calculateHistoricalReturnStats();

export const HISTORICAL_INFLATION = [
  { year: 1914, pct: 1.0 },
  { year: 1915, pct: 1.0 },
  { year: 1916, pct: 7.9 },
  { year: 1917, pct: 17.4 },
  { year: 1918, pct: 18.0 },
  { year: 1919, pct: 14.6 },
  { year: 1920, pct: 15.6 },
  { year: 1921, pct: -10.5 },
  { year: 1922, pct: -6.1 },
  { year: 1923, pct: 1.8 },
  { year: 1924, pct: 0.0 },
  { year: 1925, pct: 2.3 },
  { year: 1926, pct: 1.1 },
  { year: 1927, pct: -1.7 },
  { year: 1928, pct: -1.7 },
  { year: 1929, pct: 0.0 },
  { year: 1930, pct: -2.3 },
  { year: 1931, pct: -9.0 },
  { year: 1932, pct: -9.9 },
  { year: 1933, pct: -5.1 },
  { year: 1934, pct: 3.1 },
  { year: 1935, pct: 2.2 },
  { year: 1936, pct: 1.5 },
  { year: 1937, pct: 3.6 },
  { year: 1938, pct: -2.1 },
  { year: 1939, pct: -1.4 },
  { year: 1940, pct: 0.7 },
  { year: 1941, pct: 5.0 },
  { year: 1942, pct: 10.9 },
  { year: 1943, pct: 6.1 },
  { year: 1944, pct: 1.7 },
  { year: 1945, pct: 2.3 },
  { year: 1946, pct: 8.3 },
  { year: 1947, pct: 14.4 },
  { year: 1948, pct: 8.1 },
  { year: 1949, pct: -1.2 },
  { year: 1950, pct: 1.3 },
  { year: 1951, pct: 7.9 },
  { year: 1952, pct: 1.9 },
  { year: 1953, pct: 0.8 },
  { year: 1954, pct: 0.7 },
  { year: 1955, pct: -0.4 },
  { year: 1956, pct: 1.5 },
  { year: 1957, pct: 3.3 },
  { year: 1958, pct: 2.8 },
  { year: 1959, pct: 0.7 },
  { year: 1960, pct: 1.7 },
  { year: 1961, pct: 1.0 },
  { year: 1962, pct: 1.0 },
  { year: 1963, pct: 1.3 },
  { year: 1964, pct: 1.3 },
  { year: 1965, pct: 1.6 },
  { year: 1966, pct: 2.9 },
  { year: 1967, pct: 3.1 },
  { year: 1968, pct: 4.2 },
  { year: 1969, pct: 5.5 },
  { year: 1970, pct: 5.7 },
  { year: 1971, pct: 4.4 },
  { year: 1972, pct: 3.2 },
  { year: 1973, pct: 6.2 },
  { year: 1974, pct: 11.0 },
  { year: 1975, pct: 9.1 },
  { year: 1976, pct: 5.8 },
  { year: 1977, pct: 6.5 },
  { year: 1978, pct: 7.6 },
  { year: 1979, pct: 11.3 },
  { year: 1980, pct: 13.5 },
  { year: 1981, pct: 10.3 },
  { year: 1982, pct: 6.2 },
  { year: 1983, pct: 3.2 },
  { year: 1984, pct: 4.3 },
  { year: 1985, pct: 3.6 },
  { year: 1986, pct: 1.9 },
  { year: 1987, pct: 3.6 },
  { year: 1988, pct: 4.1 },
  { year: 1989, pct: 4.8 },
  { year: 1990, pct: 5.4 },
  { year: 1991, pct: 4.2 },
  { year: 1992, pct: 3.0 },
  { year: 1993, pct: 3.0 },
  { year: 1994, pct: 2.6 },
  { year: 1995, pct: 2.8 },
  { year: 1996, pct: 3.0 },
  { year: 1997, pct: 2.3 },
  { year: 1998, pct: 1.6 },
  { year: 1999, pct: 2.2 },
  { year: 2000, pct: 3.4 },
  { year: 2001, pct: 2.8 },
  { year: 2002, pct: 1.6 },
  { year: 2003, pct: 2.3 },
  { year: 2004, pct: 2.7 },
  { year: 2005, pct: 3.4 },
  { year: 2006, pct: 3.2 },
  { year: 2007, pct: 2.8 },
  { year: 2008, pct: 3.8 },
  { year: 2009, pct: -0.4 },
  { year: 2010, pct: 1.6 },
  { year: 2011, pct: 3.2 },
  { year: 2012, pct: 2.1 },
  { year: 2013, pct: 1.5 },
  { year: 2014, pct: 1.6 },
  { year: 2015, pct: 0.1 },
  { year: 2016, pct: 1.3 },
  { year: 2017, pct: 2.1 },
  { year: 2018, pct: 2.4 },
  { year: 2019, pct: 1.8 },
  { year: 2020, pct: 1.2 },
  { year: 2021, pct: 4.7 },
  { year: 2022, pct: 8.0 },
  { year: 2023, pct: 4.1 },
  { year: 2024, pct: 2.9 }
];

export const INFLATION_BY_YEAR = HISTORICAL_INFLATION.reduce((map, entry) => {
  map.set(entry.year, entry.pct);
  return map;
}, new Map());
export const LAST_KNOWN_INFLATION = HISTORICAL_INFLATION[HISTORICAL_INFLATION.length - 1]?.pct ?? 0;
export const RETURN_INFLATION_SERIES = HISTORICAL_RETURNS_SPY.map(entry => ({
  year: entry.year,
  r: entry.r,
  inflation: INFLATION_BY_YEAR.get(entry.year) ?? LAST_KNOWN_INFLATION
}));

// Regime-based Markov model
export const REGIME_THRESHOLDS = {
  BEAR: -0.05,  // realReturn <= -5%
  BULL: 0.05    // realReturn >= +5%
};

function classifyRegime(realReturn) {
  if (realReturn <= REGIME_THRESHOLDS.BEAR) {
    return "bear";
  } else if (realReturn >= REGIME_THRESHOLDS.BULL) {
    return "bull";
  } else {
    return "flat";
  }
}

// Add regime classification to historical years
export const HISTORICAL_YEARS_WITH_REGIME = RETURN_INFLATION_SERIES.map(entry => {
  const inflationRate = entry.inflation / 100; // Convert percentage to decimal
  const realReturn = (1 + entry.r) / (1 + inflationRate) - 1;
  const regime = classifyRegime(realReturn);
  return {
    ...entry,
    realReturn,
    regime
  };
});

// Filtered dataset for 1980-2024
export const RETURN_INFLATION_SERIES_1980 = RETURN_INFLATION_SERIES.filter(entry => entry.year >= 1980);
export const HISTORICAL_YEARS_WITH_REGIME_1980 = RETURN_INFLATION_SERIES_1980.map(entry => {
  const inflationRate = entry.inflation / 100; // Convert percentage to decimal
  const realReturn = (1 + entry.r) / (1 + inflationRate) - 1;
  const regime = classifyRegime(realReturn);
  return {
    ...entry,
    realReturn,
    regime
  };
});

// Build transition matrix from regime sequence
export function buildRegimeTransitionMatrix(years) {
  const transitions = {
    bear: { bear: 0, flat: 0, bull: 0 },
    flat: { bear: 0, flat: 0, bull: 0 },
    bull: { bear: 0, flat: 0, bull: 0 }
  };

  for (let i = 0; i < years.length - 1; i++) {
    const fromRegime = years[i].regime;
    const toRegime = years[i + 1].regime;
    if (transitions[fromRegime] && transitions[fromRegime][toRegime] !== undefined) {
      transitions[fromRegime][toRegime]++;
    }
  }

  // Normalize rows to probabilities
  const matrix = {
    bear: {},
    flat: {},
    bull: {}
  };
  const EPSILON = 1e-6; // Small value for numerical stability

  for (const fromRegime of ["bear", "flat", "bull"]) {
    const total = transitions[fromRegime].bear + transitions[fromRegime].flat + transitions[fromRegime].bull;
    if (total > 0) {
      matrix[fromRegime].bear = transitions[fromRegime].bear / total;
      matrix[fromRegime].flat = transitions[fromRegime].flat / total;
      matrix[fromRegime].bull = transitions[fromRegime].bull / total;
    } else {
      // If no transitions from this regime, use uniform distribution with smoothing
      const uniform = 1 / 3;
      matrix[fromRegime].bear = uniform + EPSILON;
      matrix[fromRegime].flat = uniform + EPSILON;
      matrix[fromRegime].bull = uniform + EPSILON;
    }
  }

  // Normalize again to ensure rows sum to 1
  for (const fromRegime of ["bear", "flat", "bull"]) {
    const rowSum = matrix[fromRegime].bear + matrix[fromRegime].flat + matrix[fromRegime].bull;
    if (rowSum > 0) {
      matrix[fromRegime].bear /= rowSum;
      matrix[fromRegime].flat /= rowSum;
      matrix[fromRegime].bull /= rowSum;
    }
  }

  return matrix;
}

export const REGIME_TRANSITION_MATRIX = buildRegimeTransitionMatrix(HISTORICAL_YEARS_WITH_REGIME);
export const REGIME_TRANSITION_MATRIX_1980 = buildRegimeTransitionMatrix(HISTORICAL_YEARS_WITH_REGIME_1980);

// Precompute years by regime for efficient sampling (full dataset)
export const YEARS_BY_REGIME = {
  bear: HISTORICAL_YEARS_WITH_REGIME.filter(y => y.regime === "bear"),
  flat: HISTORICAL_YEARS_WITH_REGIME.filter(y => y.regime === "flat"),
  bull: HISTORICAL_YEARS_WITH_REGIME.filter(y => y.regime === "bull")
};

// Precompute years by regime for efficient sampling (1980-2024 dataset)
export const YEARS_BY_REGIME_1980 = {
  bear: HISTORICAL_YEARS_WITH_REGIME_1980.filter(y => y.regime === "bear"),
  flat: HISTORICAL_YEARS_WITH_REGIME_1980.filter(y => y.regime === "flat"),
  bull: HISTORICAL_YEARS_WITH_REGIME_1980.filter(y => y.regime === "bull")
};

// Compute regime frequencies for initial state sampling
export const REGIME_FREQUENCIES = {
  bear: YEARS_BY_REGIME.bear.length / HISTORICAL_YEARS_WITH_REGIME.length,
  flat: YEARS_BY_REGIME.flat.length / HISTORICAL_YEARS_WITH_REGIME.length,
  bull: YEARS_BY_REGIME.bull.length / HISTORICAL_YEARS_WITH_REGIME.length
};

export const REGIME_FREQUENCIES_1980 = {
  bear: YEARS_BY_REGIME_1980.bear.length / HISTORICAL_YEARS_WITH_REGIME_1980.length,
  flat: YEARS_BY_REGIME_1980.flat.length / HISTORICAL_YEARS_WITH_REGIME_1980.length,
  bull: YEARS_BY_REGIME_1980.bull.length / HISTORICAL_YEARS_WITH_REGIME_1980.length
};

function averageInflationFromRange(startYear, endYear) {
  if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) return null;
  const sample = HISTORICAL_INFLATION.filter(
    entry => entry.year >= startYear && entry.year <= endYear
  );
  if (!sample.length) return null;
  const total = sample.reduce((sum, entry) => sum + entry.pct, 0);
  return total / sample.length;
}

export const INFLATION_PRESETS = [
  {
    id: "custom",
    label: "Manual entry (leave as-is)",
    compute: () => null
  },
  {
    id: "since1980",
    label: "Average since 1980",
    compute: () => averageInflationFromRange(1980, 2024)
  },
  {
    id: "last10",
    label: "Average of last 10 years",
    compute: () => averageInflationFromRange(2015, 2024)
  },
  {
    id: "last30",
    label: "Average of last 30 years",
    compute: () => averageInflationFromRange(1995, 2024)
  },
  {
    id: "modern",
    label: "Average since 1990",
    compute: () => averageInflationFromRange(1990, 2024)
  },
  {
    id: "stagflation",
    label: "Stagflation era (1973–1982)",
    compute: () => averageInflationFromRange(1973, 1982)
  },
  {
    id: "full",
    label: "Full history (1914–2024)",
    compute: () => averageInflationFromRange(1914, 2024)
  }
];

export const STRESS_SCENARIOS = {
  stagflation: {
    label: "Stagflation 1973–1982",
    returns: [-0.1737, -0.2972, 0.3155, 0.1915, -0.115, 0.0106, 0.1231, 0.2577, -0.0973, 0.1476]
  },
  dotcom: {
    label: "Dot-com bust 2000–2009",
    returns: [-0.1014, -0.1304, -0.2337, 0.2638, 0.0899, 0.03, 0.1362, 0.0353, -0.3849, 0.2345]
  },
  gfc: {
    label: "Global Financial Crisis 2007–2013",
    returns: [0.0353, -0.3849, 0.2345, 0.1278, 0.0, 0.1341, 0.296]
  }
};

export const SAVINGS_TARGET_SUCCESS = 0.9;
export const MAX_SAVINGS_SEARCH = 1000000;
export const SAVINGS_MIN_INCREMENT = 500;
export const MAX_EXTRA_WORK_YEARS = 15;
