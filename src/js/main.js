import {
  INFLATION_PRESETS,
  STRESS_SCENARIOS,
  HISTORICAL_STATS,
  SAVINGS_TARGET_SUCCESS,
  MAX_SAVINGS_SEARCH,
  MAX_EXTRA_WORK_YEARS
} from "./data.js";
import {
  clamp,
  fmtCurrency,
  fmtFullCurrency,
  percentile,
  parseCurrencyValue
} from "./utils.js";
import {
  runMonteCarlo,
  simulateDeterministic,
  estimateAdditionalAnnualSavings,
  estimateAdditionalWorkYears,
  estimateExtraAnnualSpending
} from "./simulation.js";

const ctx = document.getElementById("chart").getContext("2d");
const failScenarioCtx = document.getElementById("failScenarioChart")?.getContext("2d");
const percentile10Ctx = document.getElementById("percentile10Chart").getContext("2d");
const percentile50Ctx = document.getElementById("percentile50Chart").getContext("2d");
const percentile90Ctx = document.getElementById("percentile90Chart").getContext("2d");
const percentile10CoverageNote = document.getElementById("percentile10CoverageNote");
const percentile50CoverageNote = document.getElementById("percentile50CoverageNote");
const percentile90CoverageNote = document.getElementById("percentile90CoverageNote");
const resultsTableBody = document.getElementById("resultsTableBody");
const mcModeSelect = document.getElementById("mcMode");
const mcNormalFields = document.querySelectorAll(".mc-normal-field");
const downloadCsvBtn = document.getElementById("downloadCsvBtn");
const bondTentingToggle = document.getElementById("bondTentingEnabled");
const goalListEl = document.getElementById("goalList");
const addGoalBtn = document.getElementById("addGoalBtn");
const stressResultsEl = document.getElementById("stressResults");
const stressTableWrap = document.getElementById("stressTableWrap");
const stressTableBody = document.getElementById("stressTableBody");
const incomeNeedModeSelect = document.getElementById("incomeNeedMode");
const incomeNeedPctInput = document.getElementById("incomeNeedPct");
const incomeNeedFixedRow = document.getElementById("incomeNeedFixedRow");
const incomeNeedPctRow = document.getElementById("incomeNeedPctRow");
const incomeNeedBaselineRow = document.getElementById("incomeNeedBaselineRow");
const tabButtons = document.querySelectorAll(".tab-button");
const tabPanels = document.querySelectorAll(".tab-panel");
const scenarioListEl = document.getElementById("scenarioList");
const inflationPresetSelect = document.getElementById("inflationPreset");
const inflationSelectionNote = document.getElementById("inflationSelectionNote");
const defaultInflationNoteText = inflationSelectionNote ? inflationSelectionNote.textContent : "";
const savingsSuggestionEl = document.getElementById("savingsSuggestionNote");
const defaultSavingsSuggestionText = savingsSuggestionEl ? savingsSuggestionEl.textContent : "";
const failScenarioCard = document.getElementById("failScenarioCard");
const failScenarioTitleEl = document.getElementById("failScenarioTitle");
let chart;
let failScenarioChart;
let percentile10Chart;
let percentile50Chart;
let percentile90Chart;
let lastMcResult = null;
let lastYears = [];
let lastParams = null;

// Simulations tab state
let simResults = [];
let currentSimPage = 1;
const simsPerPage = 1000;
let simSortMode = "minCoverageRatio";
let selectedSimChart = null;
let balanceBoxplotChart = null;

function renderYearlyBoxplotChart({
  canvasId,
  noteId,
  yearLabels,
  stats,
  sliceFromRetirement = false,
  params,
  yTickFormatter,
  tooltipFormatter,
  baselineValue = null,
  ySuggestedMin = null,
  ySuggestedMax = null
}) {
  const canvas = document.getElementById(canvasId);
  const noteEl = noteId ? document.getElementById(noteId) : null;
  if (!canvas) return null;

  if (!Array.isArray(stats) || !stats.some(Boolean) || !Array.isArray(yearLabels) || yearLabels.length === 0) {
    canvas.style.display = "none";
    if (noteEl) noteEl.style.display = "none";
    return null;
  }

  canvas.style.display = "";
  if (noteEl) noteEl.style.display = "";

  const retirementStartIdx =
    sliceFromRetirement && params && Number.isFinite(params.retireAge) && Number.isFinite(params.currentAge)
      ? Math.max(0, Math.min(yearLabels.length, params.retireAge - params.currentAge))
      : 0;
  const slicedStats = stats.slice(retirementStartIdx);
  const labels = yearLabels.slice(retirementStartIdx).map(String);

  const boxplotPlugin = {
    id: `${canvasId}-boxplotPlugin`,
    afterDatasetsDraw(chart, _args, pluginOpts) {
      const chartStats = pluginOpts?.stats;
      if (!Array.isArray(chartStats) || !chartStats.length) return;
      const { ctx, chartArea, scales } = chart;
      const x = scales.x;
      const y = scales.y;
      if (!x || !y) return;

      const getX = idx => {
        let px = typeof x.getPixelForValue === "function" ? x.getPixelForValue(idx) : NaN;
        if (!Number.isFinite(px) && typeof x.getPixelForTick === "function") {
          const ticksLen = Array.isArray(x.ticks) ? x.ticks.length : 0;
          const tickIdx = ticksLen ? Math.min(Math.max(0, idx), ticksLen - 1) : 0;
          px = x.getPixelForTick(tickIdx);
        }
        return px;
      };

      const first = getX(0);
      const second = getX(Math.min(1, labels.length - 1));
      const step = Number.isFinite(second - first) && labels.length > 1
        ? Math.abs(second - first)
        : (chartArea.right - chartArea.left) / Math.max(1, labels.length);
      const boxHalf = Math.max(3, Math.min(14, step * 0.22));

      ctx.save();

      // Optional baseline (e.g. 0% returns, 100% coverage)
      if (baselineValue !== null && baselineValue !== undefined && Number.isFinite(Number(baselineValue))) {
        const yBase = y.getPixelForValue(Number(baselineValue));
        ctx.strokeStyle = "rgba(107, 114, 128, 0.55)";
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(chartArea.left, yBase);
        ctx.lineTo(chartArea.right, yBase);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(30, 41, 59, 0.9)";
      ctx.fillStyle = "rgba(59, 130, 246, 0.18)";
      const outlierFill = "rgba(30, 41, 59, 0.65)";
      const outlierRadius = 1.8;

      for (let i = 0; i < chartStats.length && i < labels.length; i++) {
        const s = chartStats[i];
        if (!s) continue;

        const q1 = Number(s.q1);
        const med = Number(s.median);
        const q3 = Number(s.q3);
        const whiskerLow = Number.isFinite(Number(s.whiskerLow)) ? Number(s.whiskerLow) : Number(s.min);
        const whiskerHigh = Number.isFinite(Number(s.whiskerHigh)) ? Number(s.whiskerHigh) : Number(s.max);
        if (![q1, med, q3, whiskerLow, whiskerHigh].every(Number.isFinite)) continue;

        const iqr = q3 - q1;
        const collapsed = Math.abs(iqr) < 1e-6;

        const xC = getX(i);
        if (!Number.isFinite(xC)) continue;

        const yLow = y.getPixelForValue(whiskerLow);
        const yQ1 = y.getPixelForValue(q1);
        const yMed = y.getPixelForValue(med);
        const yQ3 = y.getPixelForValue(q3);
        const yHigh = y.getPixelForValue(whiskerHigh);

        // Whisker line
        ctx.beginPath();
        ctx.moveTo(xC, yLow);
        ctx.lineTo(xC, yHigh);
        ctx.stroke();

        // Caps
        ctx.beginPath();
        ctx.moveTo(xC - boxHalf, yLow);
        ctx.lineTo(xC + boxHalf, yLow);
        ctx.moveTo(xC - boxHalf, yHigh);
        ctx.lineTo(xC + boxHalf, yHigh);
        ctx.stroke();

        // Box (q1..q3)
        const boxTop = Math.min(yQ1, yQ3);
        const boxBottom = Math.max(yQ1, yQ3);
        const boxH = Math.max(2, boxBottom - boxTop);
        ctx.fillRect(xC - boxHalf, boxTop, boxHalf * 2, boxH);
        ctx.strokeRect(xC - boxHalf, boxTop, boxHalf * 2, boxH);

        // Median
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(xC - boxHalf, yMed);
        ctx.lineTo(xC + boxHalf, yMed);
        ctx.stroke();
        ctx.lineWidth = 1;

        // Outliers (sampled + jittered)
        const outliers = Array.isArray(s.outliers) ? s.outliers : [];
        if (outliers.length) {
          ctx.fillStyle = outlierFill;
          const maxOutliersToDraw = collapsed ? 10 : 18;
          const stepOut = Math.max(1, Math.ceil(outliers.length / maxOutliersToDraw));
          for (let oi = 0; oi < outliers.length; oi += stepOut) {
            const ov = Number(outliers[oi]);
            if (!Number.isFinite(ov)) continue;
            const oy = y.getPixelForValue(ov);
            const seed = (i + 1) * 1000003 + (oi + 1) * 9176;
            const raw = (Math.sin(seed) * 10000) % 1;
            const frac = (raw + 1) % 1;
            const jitter = (frac - 0.5) * boxHalf * 1.2;
            ctx.beginPath();
            ctx.arc(xC + jitter, oy, outlierRadius, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillStyle = "rgba(59, 130, 246, 0.18)";
        }
      }

      ctx.restore();
    }
  };

  const ctx = canvas.getContext("2d");

  const defaultTick = v => (Number.isFinite(Number(v)) ? String(v) : "");
  const tickFmt = typeof yTickFormatter === "function" ? yTickFormatter : defaultTick;

  // Transparent dataset to provide scale + tooltip anchor points.
  const medians = slicedStats.map(s => (s ? s.median : null));

  const options = {
    responsive: true,
    interaction: { mode: "nearest", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: items => {
            const idx = items?.[0]?.dataIndex;
            const age = labels?.[idx];
            return age ? `Age ${age}` : "Age";
          },
          label: ctx => {
            const i = ctx.dataIndex;
            const s = slicedStats[i];
            if (!s) return null;
            if (typeof tooltipFormatter === "function") return tooltipFormatter(s);
            return [
              `whisker low: ${s.whiskerLow ?? s.min}`,
              `q1: ${s.q1}`,
              `median: ${s.median}`,
              `q3: ${s.q3}`,
              `whisker high: ${s.whiskerHigh ?? s.max}`,
              Array.isArray(s.outliers) && s.outliers.length ? `outliers: ${s.outliers.length} (sampled)` : null
            ];
          }
        }
      },
      [boxplotPlugin.id]: { stats: slicedStats }
    },
    scales: {
      x: { ticks: { autoSkip: true, maxTicksLimit: 14 } },
      y: {
        beginAtZero: false,
        suggestedMin: ySuggestedMin,
        suggestedMax: ySuggestedMax,
        ticks: { callback: val => tickFmt(val) }
      }
    }
  };

  return new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Median",
          data: medians,
          borderColor: "rgba(0,0,0,0)",
          backgroundColor: "rgba(0,0,0,0)",
          pointRadius: 0,
          pointHoverRadius: 0,
          showLine: false,
          spanGaps: true
        }
      ]
    },
    options,
    plugins: [boxplotPlugin]
  });
}

function renderBalanceBoxplot(yearLabels, mcResult) {
  if (balanceBoxplotChart) {
    balanceBoxplotChart.destroy();
    balanceBoxplotChart = null;
  }
  const stats = mcResult?.balanceBoxplots;
  if (!Array.isArray(stats)) return;
  const highs = stats
    .filter(Boolean)
    .map(s => Number.isFinite(Number(s.whiskerHigh)) ? Number(s.whiskerHigh) : Number(s.max))
    .filter(Number.isFinite);
  const hi = highs.length ? Math.max(...highs) : 0;
  balanceBoxplotChart = renderYearlyBoxplotChart({
    canvasId: "balanceBoxplotChart",
    noteId: "balanceBoxplotNote",
    yearLabels,
    stats,
    sliceFromRetirement: false,
    params: null,
    baselineValue: null,
    ySuggestedMin: 0,
    ySuggestedMax: hi > 0 ? hi * 1.1 : null,
    yTickFormatter: v => fmtCurrency(Number(v)),
    tooltipFormatter: s => {
      const low = Number.isFinite(Number(s.whiskerLow)) ? s.whiskerLow : s.min;
      const high = Number.isFinite(Number(s.whiskerHigh)) ? s.whiskerHigh : s.max;
      const outCount = Array.isArray(s.outliers) ? s.outliers.length : 0;
      return [
        `whisker low: ${fmtFullCurrency(Number(low))}`,
        `q1 (25%): ${fmtFullCurrency(Number(s.q1))}`,
        `median: ${fmtFullCurrency(Number(s.median))}`,
        `q3 (75%): ${fmtFullCurrency(Number(s.q3))}`,
        `whisker high: ${fmtFullCurrency(Number(high))}`,
        outCount ? `outliers: ${outCount} (sampled)` : null
      ];
    }
  });
}

function setCoverageNote(
  noteEl,
  coveragePath,
  needPath,
  actualIncomePath,
  yearLabels,
  retireAge,
  percentileLabel
) {
  if (
    !noteEl ||
    !Array.isArray(coveragePath) ||
    !Array.isArray(yearLabels) ||
    !Array.isArray(needPath) ||
    !Array.isArray(actualIncomePath)
  )
    return;
  const totalRetirementYears = yearLabels.filter(age => age >= retireAge).length;
  if (totalRetirementYears === 0) {
    noteEl.textContent = "";
    return;
  }
  const shortfalls = [];
  const coveredYears = yearLabels.reduce((acc, age, idx) => {
    if (age < retireAge) return acc;
    const covered = Boolean(coveragePath[idx]);
    const need = Number(needPath[idx]) || 0;
    const actualIncome = Math.max(0, Number(actualIncomePath[idx]) || 0);
    if (covered) {
      // If covered is true, there is no shortfall, so skip
      return acc + 1;
    }
    if (need <= 0) return acc;
    // If not covered, calculate shortfall
    const dollarShort = Math.max(0, need - actualIncome);
    const shortPct = need > 0 ? Math.max(0, dollarShort / need) : 0;
    // Always show shortfall if not covered, even if small
    shortfalls.push({
      age,
      dollarShort,
      shortPct
    });
    return acc;
  }, 0);

  const base = `${percentileLabel}: ${coveredYears} of ${totalRetirementYears} retirement years met 100% of inflated need.`;
  if (!shortfalls.length) {
    noteEl.textContent = base;
    return;
  }
  const detail = shortfalls
    .map(s => {
      if (s.dollarShort < 1) {
        return `age ${s.age}`;
      }
      const amountStr = fmtFullCurrency(s.dollarShort);
      const pctStr = (s.shortPct * 100).toFixed(1);
      return `age ${s.age} (short by ${amountStr}, ${pctStr}%)`;
    })
    .join("; ");
  noteEl.innerHTML = `${base}<br>Shortfall years: ${detail}.`;
}

function resetInflationSelectionNote() {
  if (inflationSelectionNote) {
    inflationSelectionNote.textContent = defaultInflationNoteText;
    inflationSelectionNote.style.display = "";
  }
}

function resetSavingsSuggestionNote() {
  if (savingsSuggestionEl) {
    savingsSuggestionEl.textContent = defaultSavingsSuggestionText;
  }
}

function updateSavingsSuggestion(params, mcConfig, baseMcResult) {
  if (!savingsSuggestionEl) return;
  if (!baseMcResult) {
    resetSavingsSuggestionNote();
    return;
  }
  const suggestion = estimateAdditionalAnnualSavings(params, mcConfig, baseMcResult, SAVINGS_TARGET_SUCCESS);
  const workSuggestion = estimateAdditionalWorkYears(params, mcConfig, baseMcResult, SAVINGS_TARGET_SUCCESS);
  const spendingSuggestion = estimateExtraAnnualSpending(params, mcConfig, baseMcResult);
  
  if (!suggestion) {
    savingsSuggestionEl.textContent = "Unable to compute a savings suggestion for these inputs.";
    return;
  }
  const targetPct = (suggestion.target * 100).toFixed(0);
  const successPct = (suggestion.achievedSuccess * 100).toFixed(1);
  const maxBump = fmtFullCurrency(MAX_SAVINGS_SEARCH);
  let msg = "";
  
  if (suggestion.extraAnnual === 0) {
    msg = `<span class="badge">On track</span> Success probability is already ${successPct}%, clearing the ${targetPct}% goal.`;
    if (workSuggestion && workSuggestion.extraYears > 0) {
      const yearsText = workSuggestion.extraYears === 1 ? "1 extra year" : `${workSuggestion.extraYears} extra years`;
      const workPct = (workSuggestion.achievedSuccess * 100).toFixed(1);
      msg += ` Working ${yearsText} (retire age ${workSuggestion.retireAge}) would raise it further to ${workPct}%.`;
    }
  } else if (suggestion.extraAnnual === null) {
    msg = `<span class="badge warn">Heads up</span> Even adding ${maxBump} per year kept success below ${targetPct}%.`;
    if (workSuggestion && workSuggestion.extraYears) {
      const yearsText =
        workSuggestion.extraYears === 1 ? "1 extra year" : `${workSuggestion.extraYears} extra years`;
      const workPct = (workSuggestion.achievedSuccess * 100).toFixed(1);
      msg += ` Working ${yearsText} (retire age ${workSuggestion.retireAge}) reaches ${workPct}%.`;
    } else if (workSuggestion && workSuggestion.extraYears === null) {
      msg += ` Working up to ${MAX_EXTRA_WORK_YEARS} extra years still stayed below ${targetPct}%.`;
    } else {
      msg += " Consider changing retirement age, spending, or returns.";
    }
  } else {
    msg = `Adding about ${fmtFullCurrency(suggestion.extraAnnual)} per year lifts success to ${successPct}% (target ${targetPct}%).`;
    if (workSuggestion && workSuggestion.extraYears > 0) {
      const yearsText =
        workSuggestion.extraYears === 1 ? "1 extra year" : `${workSuggestion.extraYears} extra years`;
      const workPct = (workSuggestion.achievedSuccess * 100).toFixed(1);
      msg += ` Alternatively, working ${yearsText} (retire age ${workSuggestion.retireAge}) hits ${workPct}%.`;
    } else if (workSuggestion && workSuggestion.extraYears === 0) {
      msg += " Working longer isn't required for the 90% goal.";
    } else if (workSuggestion && workSuggestion.extraYears === null) {
      msg += ` Working up to ${MAX_EXTRA_WORK_YEARS} extra years stayed below ${targetPct}%.`;
    }
  }
  
  // Add "die with zero" spending suggestion
  if (spendingSuggestion?.results) {
    const formatLine = (label, res) => {
      if (!res) return null;
      if (res.extraAnnual === null) return `${label}: unavailable`;
      if (res.extraAnnual === 0) {
        return `${label}: +$0/yr (already near $0 at plan end)`;
      }
      const extraSpend = fmtFullCurrency(res.extraAnnual);
      const newTotal = fmtFullCurrency(res.newTotalIncome);
      const finalBal = fmtFullCurrency(Math.max(0, res.finalBalance ?? 0));
      return `${label}: +${extraSpend}/yr (total ${newTotal}/yr), final balance ~${finalBal}`;
    };

    const p10Line = formatLine("p10", spendingSuggestion.results.p10);
    const p50Line = formatLine("p50 (median)", spendingSuggestion.results.p50);
    const p90Line = formatLine("p90", spendingSuggestion.results.p90);

    msg += `<br><br><span class="badge info">Die with Zero</span> Extra annual spending (today’s $) to end around ~$0 by age ${params.endAge}, by outcome percentile:`;
    msg += `<br>${p10Line || ""}<br>${p50Line || ""}<br>${p90Line || ""}`;
  } else if (spendingSuggestion && spendingSuggestion.extraAnnual === 0) {
    msg += `<br><br><span class="badge warn">Die with Zero</span> ${spendingSuggestion.message || "Current spending already depletes the portfolio."}`;
  }
  
  savingsSuggestionEl.innerHTML = msg;
}

function populateInflationPresetSelect() {
  if (!inflationPresetSelect) return;
  inflationPresetSelect.innerHTML = "";
  INFLATION_PRESETS.forEach(preset => {
    const option = document.createElement("option");
    option.value = preset.id;
    const pct = typeof preset.compute === "function" ? preset.compute() : null;
    option.textContent = Number.isFinite(pct)
      ? `${preset.label} (${pct.toFixed(1)}%)`
      : preset.label;
    inflationPresetSelect.appendChild(option);
  });
}

function initInflationTools() {
  populateInflationPresetSelect();
  if (inflationPresetSelect) {
    inflationPresetSelect.value = "since1980";
  }
  updateInflationPresetSelection();
}

function updateInflationPresetSelection() {
  if (!inflationPresetSelect) return;
  const presetId = inflationPresetSelect.value;
  const manualField = document.getElementById("inflationManualField");
  const manualInput = document.getElementById("inflation");
  const preset = INFLATION_PRESETS.find(p => p.id === presetId);
  const pct = preset && typeof preset.compute === "function" ? preset.compute() : null;
  const useManual = presetId === "custom" || !Number.isFinite(pct);

  if (manualField) {
    manualField.style.display = useManual ? "" : "none";
  }
  if (!useManual && manualInput && Number.isFinite(pct)) {
    manualInput.value = pct.toFixed(2);
  }

  if (inflationSelectionNote) {
    if (!useManual && Number.isFinite(pct)) {
      inflationSelectionNote.textContent = "";
      inflationSelectionNote.style.display = "none";
    } else {
      inflationSelectionNote.style.display = "";
      inflationSelectionNote.textContent = defaultInflationNoteText || "Choose a preset or Manual to enter a value.";
    }
  }
}

function gatherGoalEvents() {
  return readGoalRowsRaw()
    .map(goal => ({
      label: goal.label.trim(),
      age: parseFloat(goal.age),
      amount: parseCurrencyValue(goal.amount)
    }))
    .filter(goal => goal.label && Number.isFinite(goal.age) && Number.isFinite(goal.amount) && goal.amount > 0);
}

function gatherParams() {
  const currentAge = parseFloat(document.getElementById("currentAge").value);
  const retireAge = parseFloat(document.getElementById("retireAge").value);
  const endAge = parseFloat(document.getElementById("endAge").value);
  const currentSavings = readCurrencyInput("currentSavings");
  const annualContrib = readCurrencyInput("annualContrib");
  const incomeNeed = readCurrencyInput("incomeNeed");
  const incomeNeedMode = incomeNeedModeSelect?.value || "portfolio_pct";
  const incomeNeedPct = clamp(parseFloat(incomeNeedPctInput?.value) / 100, 0, 0.2) || 0;
  const incomeNeedBaseline = readCurrencyInput("incomeNeedBaseline") || incomeNeed;
  let inflationPct = parseFloat(document.getElementById("inflation").value);
  if (!Number.isFinite(inflationPct)) inflationPct = 0;
  if (inflationPresetSelect) {
    const preset = INFLATION_PRESETS.find(p => p.id === inflationPresetSelect.value);
    const presetPct = preset && typeof preset.compute === "function" ? preset.compute() : null;
    if (Number.isFinite(presetPct) && inflationPresetSelect.value !== "custom") {
      inflationPct = presetPct;
    }
  }
  const baseInflation = inflationPct / 100;
  const taxRate = clamp(parseFloat(document.getElementById("taxRate").value) / 100, 0, 0.6);
  const inflation = clamp(baseInflation, -0.01, 0.12);
  const inflationMode = (document.getElementById("inflationMode")?.value || "fixed").toLowerCase();
  const bondTentingEnabled = bondTentingToggle ? bondTentingToggle.checked : false;
  const bondTentingYears = bondTentingEnabled
    ? parseFloat(document.getElementById("bondTentingYears")?.value || 0) || 0
    : 0;
  const spendingStrategy = "fixed";

  return {
    currentAge,
    retireAge,
    endAge,
    currentSavings,
    annualContrib,
    incomeNeed,
    incomeNeedMode,
    incomeNeedPct,
    incomeNeedBaseline,
    inflation,
    taxRate,
    afterTaxFactor: Math.max(0.05, 1 - taxRate),
    goalEvents: gatherGoalEvents(),
    spendingStrategy,
    inflationMode: inflationMode === "fixed" ? "fixed" : "historical",
    bondTentingEnabled,
    bondTentingYears
  };
}

function gatherMCConfig() {
  const numSims = parseInt(document.getElementById("numSims").value, 10);
  const mcMode = document.getElementById("mcMode").value;
  const baseMean = parseFloat(document.getElementById("mcMean").value) / 100;
  const mean = clamp(baseMean, -0.5, 0.3);
  const stdev = Math.max(0.01, parseFloat(document.getElementById("mcStdev").value) / 100);
  return {
    numSims,
    mode: mcMode,
    mean,
    stdev
  };
}

function updateChart(yearLabels, mcResult) {
  if (chart) chart.destroy();

  const datasets = [
    {
      label: "MC median",
      data: mcResult.p50,
      borderWidth: 2,
      borderColor: "rgba(21, 128, 61, 1)",
      backgroundColor: "rgba(21, 128, 61, 0.1)",
      tension: 0.15,
      fill: false
    },
    {
      label: "MC 90th %ile",
      data: mcResult.p90,
      borderWidth: 1,
      borderColor: "rgba(16, 185, 129, 0.9)",
      backgroundColor: "rgba(16, 185, 129, 0.05)",
      tension: 0.15,
      fill: false
    },
    {
      label: "MC 10th %ile",
      data: mcResult.p10,
      borderWidth: 1,
      borderColor: "rgba(239, 68, 68, 0.9)",
      backgroundColor: "rgba(248, 113, 113, 0.05)",
      tension: 0.15,
      fill: false
    }
  ];

  if (mcResult.failurePath?.balances?.length) {
    const failPctLabel = (mcResult.failurePath.percentile * 100).toFixed(1);
    datasets.push({
      label: `Balance (~p${failPctLabel} fail)`,
      data: mcResult.failurePath.balances,
      borderWidth: 2,
      borderColor: "rgba(239, 68, 68, 1)",
      backgroundColor: "rgba(239, 68, 68, 0.08)",
      tension: 0.15,
      fill: false,
      borderDash: [6, 4]
    });
  }

  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: yearLabels.map(String),
      datasets
    },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${fmtFullCurrency(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        y: {
          ticks: {
            callback: val => fmtCurrency(val)
          }
        }
      }
    }
  });
}

function updateFailureScenarioChart(yearLabels, mcResult, currentAge, retireAge, params) {
  if (!failScenarioCtx) return;
  if (failScenarioChart) {
    failScenarioChart.destroy();
    failScenarioChart = null;
  }

  const canvas = document.getElementById("failScenarioChart");
  const fp = mcResult.failurePath;
  if (!mcResult || !fp || !fp.balances || !fp.balances.length) {
    if (canvas) canvas.style.display = "none";
    if (failScenarioCard) failScenarioCard.style.display = "none";
    if (failScenarioTitleEl) {
      failScenarioTitleEl.textContent = "Failing percentile scenario";
    }
    return;
  }
  if (canvas) canvas.style.display = "";
  if (failScenarioCard) failScenarioCard.style.display = "";

  const withdrawalData = (fp.withdrawals || []).map((val, idx) => {
    const age = yearLabels[idx];
    return age < retireAge ? null : val;
  });
  const pct = params?.incomeNeedPct || 0;
  const pctWithdrawalData = (fp.balances || []).map((val, idx) => {
    const age = yearLabels[idx];
    if (age < retireAge) return null;
    return (val ?? 0) * pct;
  });
  const benchmarkSeriesRaw = fp.benchmarks || [];
  const benchmarkSeries = benchmarkSeriesRaw.map((val, idx) => {
    const age = yearLabels[idx];
    if (age < retireAge) return null;
    return val > 0 ? val : null;
  });
  const hasBenchmarks = benchmarkSeries.some(v => Number.isFinite(v) && v > 0);

  const retireIndex = yearLabels.findIndex(age => age >= retireAge);
  const retireAgeLabel = retireIndex >= 0 ? String(yearLabels[retireIndex]) : null;
  if (failScenarioTitleEl) {
    const pctLabel = fp.percentile
      ? `${(fp.percentile * 100).toFixed(1)}th percentile scenario`
      : "Failing percentile scenario";
    failScenarioTitleEl.textContent = pctLabel;
  }

  const failDatasets = [
    {
      label: "Return Rate (%)",
      data: fp.returns || [],
      borderWidth: 2,
      borderColor: "rgba(37, 99, 235, 1)",
      backgroundColor: "rgba(37, 99, 235, 0.1)",
      tension: 0.15,
      fill: false,
      yAxisID: "y"
    },
    {
      label: "Inflation Rate (%)",
      data: fp.inflations || [],
      borderWidth: 2,
      borderColor: "rgba(249, 115, 22, 1)",
      backgroundColor: "rgba(249, 115, 22, 0.1)",
      tension: 0.15,
      fill: false,
      yAxisID: "y"
    },
    {
      label: "Actual withdrawal ($)",
      data: withdrawalData,
      borderWidth: 2,
      borderColor: "rgba(168, 85, 247, 1)",
      backgroundColor: "rgba(168, 85, 247, 0.1)",
      tension: 0.15,
      fill: false,
      yAxisID: "y1",
      spanGaps: true
    },
    {
      label: "Safe-withdrawal (pct of balance)",
      data: pctWithdrawalData,
      borderWidth: 2,
      borderColor: "rgba(107, 114, 128, 1)",
      backgroundColor: "rgba(107, 114, 128, 0.08)",
      tension: 0.15,
      fill: false,
      yAxisID: "y1",
      borderDash: [4, 4],
      spanGaps: true
    },
    (params?.incomeNeedMode === "portfolio_pct" || params?.incomeNeedMode === "portfolio_pct_uncapped") && hasBenchmarks
      ? {
          label: "Inflated fixed baseline ($)",
          data: benchmarkSeries,
          borderWidth: 2,
          borderColor: "rgba(107, 114, 128, 0.9)",
          backgroundColor: "rgba(107, 114, 128, 0.08)",
          tension: 0.15,
          fill: false,
          yAxisID: "y1",
          borderDash: [4, 4]
        }
      : null,
    {
      label: "Balance ($)",
      data: fp.balances || [],
      borderWidth: 2,
      borderColor: "rgba(239, 68, 68, 1)",
      backgroundColor: "rgba(239, 68, 68, 0.1)",
      tension: 0.15,
      fill: false,
      yAxisID: "y1",
      borderDash: [6, 4]
    }
  ];

  failScenarioChart = new Chart(failScenarioCtx, {
    type: "line",
    data: {
      labels: yearLabels.map(String),
      datasets: failDatasets.filter(Boolean)
    },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            label: function(context) {
              let label = context.dataset.label || "";
              if (label) label += ": ";
              const isCurrencyAxis = context.dataset.yAxisID === "y1";
              label += isCurrencyAxis
                ? fmtFullCurrency(context.parsed.y)
                : (context.parsed.y ?? 0).toFixed(2) + "%";
              return label;
            }
          }
        }
      },
      scales: {
        y: {
          type: "linear",
          display: true,
          position: "left",
          ticks: {
            callback: function(value) {
              return value.toFixed(1) + "%";
            }
          },
          title: {
            display: true,
            text: "Percentage"
          }
        },
        y1: {
          type: "linear",
          display: true,
          position: "right",
          ticks: {
            callback: function(value) {
              return fmtCurrency(value);
            }
          },
          title: {
            display: true,
            text: "Dollars"
          },
          grid: {
            drawOnChartArea: false
          }
        }
      }
    },
    plugins: [{
      id: "retirementLinePluginFail",
      afterDraw: function(chartInstance) {
        if (retireAgeLabel) {
          const ctx = chartInstance.ctx;
          const xScale = chartInstance.scales.x;
          const xPos = xScale.getPixelForValue(retireAgeLabel);
          
          ctx.save();
          ctx.strokeStyle = "rgba(107, 114, 128, 0.8)";
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.moveTo(xPos, chartInstance.chartArea.top);
          ctx.lineTo(xPos, chartInstance.chartArea.bottom);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }
      }
    }]
  });
}

function updatePercentile10Chart(yearLabels, mcResult, currentAge, retireAge, params) {
  if (percentile10Chart) percentile10Chart.destroy();
  
  // Filter withdrawal data: show null before retirement age
  const withdrawalData = mcResult.withdrawals.p10.map((val, idx) => {
    const age = yearLabels[idx];
    return age < retireAge ? null : val;
  });
  const pct = params?.incomeNeedPct || 0;
  const balSeries = mcResult.balancePaths?.p10 ?? mcResult.p10 ?? [];
  const pctWithdrawalData = balSeries.map((val, idx) => {
    const age = yearLabels[idx];
    if (age < retireAge) return null;
    return (val ?? 0) * pct;
  });
  const benchmarkSeriesRaw = mcResult.benchmarks?.p10 || [];
  const benchmarkSeries = benchmarkSeriesRaw.map((val, idx) => {
    const age = yearLabels[idx];
    if (age < retireAge) return null;
    return val > 0 ? val : null;
  });
  const hasBenchmarks = benchmarkSeries.some(v => Number.isFinite(v) && v > 0);
  
  // Find retirement start index for vertical line
  const retireIndex = yearLabels.findIndex(age => age >= retireAge);
  const retireAgeLabel = retireIndex >= 0 ? String(yearLabels[retireIndex]) : null;
  setCoverageNote(
    percentile10CoverageNote,
    mcResult.coveragePaths?.p10 || [],
    mcResult.spendingTargets?.p10 || [],
    mcResult.actualIncomes?.p10 || [],
    yearLabels,
    retireAge,
    "10th percentile"
  );
  
  const datasets = [
    {
      label: "Return Rate (%)",
      data: mcResult.returns.p10,
      borderWidth: 2,
      borderColor: "rgba(37, 99, 235, 1)",
      backgroundColor: "rgba(37, 99, 235, 0.1)",
      tension: 0.15,
      fill: false,
      yAxisID: "y"
    },
    {
      label: "Inflation Rate (%)",
      data: mcResult.inflations.p10,
      borderWidth: 2,
      borderColor: "rgba(249, 115, 22, 1)",
      backgroundColor: "rgba(249, 115, 22, 0.1)",
      tension: 0.15,
      fill: false,
      yAxisID: "y"
    },
    {
      label: "Actual withdrawal ($)",
      data: withdrawalData,
      borderWidth: 2,
      borderColor: "rgba(168, 85, 247, 1)",
      backgroundColor: "rgba(168, 85, 247, 0.1)",
      tension: 0.15,
      fill: false,
      yAxisID: "y1",
      spanGaps: true
    },
    {
      label: "Safe-withdrawal (pct of balance)",
      data: pctWithdrawalData,
      borderWidth: 2,
      borderColor: "rgba(107, 114, 128, 1)",
      backgroundColor: "rgba(107, 114, 128, 0.08)",
      tension: 0.15,
      fill: false,
      yAxisID: "y1",
      borderDash: [4, 4],
      spanGaps: true
    },
    (params?.incomeNeedMode === "portfolio_pct" || params?.incomeNeedMode === "portfolio_pct_uncapped") && hasBenchmarks
      ? {
          label: "Inflated fixed baseline ($)",
          data: benchmarkSeries,
          borderWidth: 2,
          borderColor: "rgba(107, 114, 128, 0.9)",
          backgroundColor: "rgba(107, 114, 128, 0.08)",
          tension: 0.15,
          fill: false,
          yAxisID: "y1",
          borderDash: [4, 4]
        }
      : null,
    {
      label: "Balance ($)",
      data: mcResult.balancePaths?.p10 ?? mcResult.p10,
      borderWidth: 2,
      borderColor: "rgba(21, 128, 61, 1)",
      backgroundColor: "rgba(21, 128, 61, 0.1)",
      tension: 0.15,
      fill: false,
      yAxisID: "y1"
    }
  ];

  percentile10Chart = new Chart(percentile10Ctx, {
    type: "line",
    data: {
      labels: yearLabels.map(String),
      datasets: datasets.filter(Boolean)
    },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            label: function(context) {
              let label = context.dataset.label || "";
              if (label) label += ": ";
              const isCurrencyAxis = context.dataset.yAxisID === "y1";
              label += isCurrencyAxis
                ? fmtFullCurrency(context.parsed.y)
                : (context.parsed.y ?? 0).toFixed(2) + "%";
              return label;
            }
          }
        }
      },
      scales: {
        y: {
          type: "linear",
          display: true,
          position: "left",
          ticks: {
            callback: function(value) {
              return value.toFixed(1) + "%";
            }
          },
          title: {
            display: true,
            text: "Percentage"
          }
        },
        y1: {
          type: "linear",
          display: true,
          position: "right",
          ticks: {
            callback: function(value) {
              return fmtCurrency(value);
            }
          },
          title: {
            display: true,
            text: "Dollars"
          },
          grid: {
            drawOnChartArea: false
          }
        }
      }
    },
    plugins: [{
      id: "retirementLinePlugin10",
      afterDraw: function(chart) {
        if (retireAgeLabel) {
          const ctx = chart.ctx;
          const xScale = chart.scales.x;
          const xPos = xScale.getPixelForValue(retireAgeLabel);
          
          ctx.save();
          ctx.strokeStyle = "rgba(107, 114, 128, 0.8)";
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.moveTo(xPos, chart.chartArea.top);
          ctx.lineTo(xPos, chart.chartArea.bottom);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }
      }
    }]
  });
}

function updatePercentile50Chart(yearLabels, mcResult, currentAge, retireAge, params) {
  if (percentile50Chart) percentile50Chart.destroy();
  
  // Filter withdrawal data: show null before retirement age
  const withdrawalData = mcResult.withdrawals.p50.map((val, idx) => {
    const age = yearLabels[idx];
    return age < retireAge ? null : val;
  });
  const pct = params?.incomeNeedPct || 0;
  const balSeries = mcResult.balancePaths?.p50 ?? mcResult.p50 ?? [];
  const pctWithdrawalData = balSeries.map((val, idx) => {
    const age = yearLabels[idx];
    if (age < retireAge) return null;
    return (val ?? 0) * pct;
  });
  const benchmarkSeriesRaw = mcResult.benchmarks?.p50 || [];
  const benchmarkSeries = benchmarkSeriesRaw.map((val, idx) => {
    const age = yearLabels[idx];
    if (age < retireAge) return null;
    return val > 0 ? val : null;
  });
  const hasBenchmarks = benchmarkSeries.some(v => Number.isFinite(v) && v > 0);
  
  // Find retirement start index for vertical line
  const retireIndex = yearLabels.findIndex(age => age >= retireAge);
  const retireAgeLabel = retireIndex >= 0 ? String(yearLabels[retireIndex]) : null;
  setCoverageNote(
    percentile50CoverageNote,
    mcResult.coveragePaths?.p50 || [],
    mcResult.spendingTargets?.p50 || [],
    mcResult.actualIncomes?.p50 || [],
    yearLabels,
    retireAge,
    "50th percentile"
  );
  
  const datasets = [
    {
      label: "Return Rate (%)",
      data: mcResult.returns.p50,
      borderWidth: 2,
      borderColor: "rgba(37, 99, 235, 1)",
      backgroundColor: "rgba(37, 99, 235, 0.1)",
      tension: 0.15,
      fill: false,
      yAxisID: "y"
    },
    {
      label: "Inflation Rate (%)",
      data: mcResult.inflations.p50,
      borderWidth: 2,
      borderColor: "rgba(249, 115, 22, 1)",
      backgroundColor: "rgba(249, 115, 22, 0.1)",
      tension: 0.15,
      fill: false,
      yAxisID: "y"
    },
    {
      label: "Actual withdrawal ($)",
      data: withdrawalData,
      borderWidth: 2,
      borderColor: "rgba(168, 85, 247, 1)",
      backgroundColor: "rgba(168, 85, 247, 0.1)",
      tension: 0.15,
      fill: false,
      yAxisID: "y1",
      spanGaps: true
    },
    {
      label: "Safe-withdrawal (pct of balance)",
      data: pctWithdrawalData,
      borderWidth: 2,
      borderColor: "rgba(107, 114, 128, 1)",
      backgroundColor: "rgba(107, 114, 128, 0.08)",
      tension: 0.15,
      fill: false,
      yAxisID: "y1",
      borderDash: [4, 4],
      spanGaps: true
    },
    (params?.incomeNeedMode === "portfolio_pct" || params?.incomeNeedMode === "portfolio_pct_uncapped") && hasBenchmarks
      ? {
          label: "Inflated fixed baseline ($)",
          data: benchmarkSeries,
          borderWidth: 2,
          borderColor: "rgba(107, 114, 128, 0.9)",
          backgroundColor: "rgba(107, 114, 128, 0.08)",
          tension: 0.15,
          fill: false,
          yAxisID: "y1",
          borderDash: [4, 4]
        }
      : null,
    {
      label: "Balance ($)",
      data: mcResult.balancePaths?.p50 ?? mcResult.p50,
      borderWidth: 2,
      borderColor: "rgba(21, 128, 61, 1)",
      backgroundColor: "rgba(21, 128, 61, 0.1)",
      tension: 0.15,
      fill: false,
      yAxisID: "y1"
    }
  ];

  percentile50Chart = new Chart(percentile50Ctx, {
    type: "line",
    data: {
      labels: yearLabels.map(String),
      datasets: datasets.filter(Boolean)
    },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            label: function(context) {
              let label = context.dataset.label || "";
              if (label) label += ": ";
              const isCurrencyAxis = context.dataset.yAxisID === "y1";
              label += isCurrencyAxis
                ? fmtFullCurrency(context.parsed.y)
                : (context.parsed.y ?? 0).toFixed(2) + "%";
              return label;
            }
          }
        }
      },
      scales: {
        y: {
          type: "linear",
          display: true,
          position: "left",
          ticks: {
            callback: function(value) {
              return value.toFixed(1) + "%";
            }
          },
          title: {
            display: true,
            text: "Percentage"
          }
        },
        y1: {
          type: "linear",
          display: true,
          position: "right",
          ticks: {
            callback: function(value) {
              return fmtCurrency(value);
            }
          },
          title: {
            display: true,
            text: "Dollars"
          },
          grid: {
            drawOnChartArea: false
          }
        }
      }
    },
    plugins: [{
      id: "retirementLinePlugin50",
      afterDraw: function(chart) {
        if (retireAgeLabel) {
          const ctx = chart.ctx;
          const xScale = chart.scales.x;
          const xPos = xScale.getPixelForValue(retireAgeLabel);
          
          ctx.save();
          ctx.strokeStyle = "rgba(107, 114, 128, 0.8)";
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.moveTo(xPos, chart.chartArea.top);
          ctx.lineTo(xPos, chart.chartArea.bottom);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }
      }
    }]
  });
}

function updatePercentile90Chart(yearLabels, mcResult, currentAge, retireAge, params) {
  if (percentile90Chart) percentile90Chart.destroy();
  
  // Filter withdrawal data: show null before retirement age
  const withdrawalData = mcResult.withdrawals.p90.map((val, idx) => {
    const age = yearLabels[idx];
    return age < retireAge ? null : val;
  });
  const pct = params?.incomeNeedPct || 0;
  const balSeries = mcResult.balancePaths?.p90 ?? mcResult.p90 ?? [];
  const pctWithdrawalData = balSeries.map((val, idx) => {
    const age = yearLabels[idx];
    if (age < retireAge) return null;
    return (val ?? 0) * pct;
  });
  const benchmarkSeriesRaw = mcResult.benchmarks?.p90 || [];
  const benchmarkSeries = benchmarkSeriesRaw.map((val, idx) => {
    const age = yearLabels[idx];
    if (age < retireAge) return null;
    return val > 0 ? val : null;
  });
  const hasBenchmarks = benchmarkSeries.some(v => Number.isFinite(v) && v > 0);
  
  // Find retirement start index for vertical line
  const retireIndex = yearLabels.findIndex(age => age >= retireAge);
  const retireAgeLabel = retireIndex >= 0 ? String(yearLabels[retireIndex]) : null;
  setCoverageNote(
    percentile90CoverageNote,
    mcResult.coveragePaths?.p90 || [],
    mcResult.spendingTargets?.p90 || [],
    mcResult.actualIncomes?.p90 || [],
    yearLabels,
    retireAge,
    "90th percentile"
  );
  
  const datasets = [
    {
      label: "Return Rate (%)",
      data: mcResult.returns.p90,
      borderWidth: 2,
      borderColor: "rgba(37, 99, 235, 1)",
      backgroundColor: "rgba(37, 99, 235, 0.1)",
      tension: 0.15,
      fill: false,
      yAxisID: "y"
    },
    {
      label: "Inflation Rate (%)",
      data: mcResult.inflations.p90,
      borderWidth: 2,
      borderColor: "rgba(249, 115, 22, 1)",
      backgroundColor: "rgba(249, 115, 22, 0.1)",
      tension: 0.15,
      fill: false,
      yAxisID: "y"
    },
    {
      label: "Actual withdrawal ($)",
      data: withdrawalData,
      borderWidth: 2,
      borderColor: "rgba(168, 85, 247, 1)",
      backgroundColor: "rgba(168, 85, 247, 0.1)",
      tension: 0.15,
      fill: false,
      yAxisID: "y1",
      spanGaps: true
    },
    {
      label: "Safe-withdrawal (pct of balance)",
      data: pctWithdrawalData,
      borderWidth: 2,
      borderColor: "rgba(107, 114, 128, 1)",
      backgroundColor: "rgba(107, 114, 128, 0.08)",
      tension: 0.15,
      fill: false,
      yAxisID: "y1",
      borderDash: [4, 4],
      spanGaps: true
    },
    (params?.incomeNeedMode === "portfolio_pct" || params?.incomeNeedMode === "portfolio_pct_uncapped") && hasBenchmarks
      ? {
          label: "Inflated fixed baseline ($)",
          data: benchmarkSeries,
          borderWidth: 2,
          borderColor: "rgba(107, 114, 128, 0.9)",
          backgroundColor: "rgba(107, 114, 128, 0.08)",
          tension: 0.15,
          fill: false,
          yAxisID: "y1",
          borderDash: [4, 4]
        }
      : null,
    {
      label: "Balance ($)",
      data: mcResult.balancePaths?.p90 ?? mcResult.p90,
      borderWidth: 2,
      borderColor: "rgba(16, 185, 129, 1)",
      backgroundColor: "rgba(16, 185, 129, 0.1)",
      tension: 0.15,
      fill: false,
      yAxisID: "y1"
    }
  ];

  percentile90Chart = new Chart(percentile90Ctx, {
    type: "line",
    data: {
      labels: yearLabels.map(String),
      datasets: datasets.filter(Boolean)
    },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            label: function(context) {
              let label = context.dataset.label || "";
              if (label) label += ": ";
              const isCurrencyAxis = context.dataset.yAxisID === "y1";
              label += isCurrencyAxis
                ? fmtFullCurrency(context.parsed.y)
                : (context.parsed.y ?? 0).toFixed(2) + "%";
              return label;
            }
          }
        }
      },
      scales: {
        y: {
          type: "linear",
          display: true,
          position: "left",
          ticks: {
            callback: function(value) {
              return value.toFixed(1) + "%";
            }
          },
          title: {
            display: true,
            text: "Percentage"
          }
        },
        y1: {
          type: "linear",
          display: true,
          position: "right",
          ticks: {
            callback: function(value) {
              return fmtCurrency(value);
            }
          },
          title: {
            display: true,
            text: "Dollars"
          },
          grid: {
            drawOnChartArea: false
          }
        }
      }
    },
    plugins: [{
      id: "retirementLinePlugin90",
      afterDraw: function(chart) {
        if (retireAgeLabel) {
          const ctx = chart.ctx;
          const xScale = chart.scales.x;
          const xPos = xScale.getPixelForValue(retireAgeLabel);
          
          ctx.save();
          ctx.strokeStyle = "rgba(107, 114, 128, 0.8)";
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.moveTo(xPos, chart.chartArea.top);
          ctx.lineTo(xPos, chart.chartArea.bottom);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }
      }
    }]
  });
}

function updateResultsTable(yearLabels, mcResult, params) {
  if (!resultsTableBody) return;
  resultsTableBody.innerHTML = "";
  const pct = params?.incomeNeedPct || 0;
  const inflationRate = params?.inflation || 0;
  const baselineNeed = params?.incomeNeedBaseline || params?.incomeNeed || 0;
  const pathBal10 = mcResult.balancePaths?.p10 || [];
  const pathBal50 = mcResult.balancePaths?.p50 || [];
  const pathBal90 = mcResult.balancePaths?.p90 || [];

  yearLabels.forEach((age, idx) => {
    const yearsFromToday = age - (params?.currentAge || age);
    const isRetired = age >= (params?.retireAge || age + 1);
    const inflatedBaseline = isRetired
      ? baselineNeed * Math.pow(1 + inflationRate, Math.max(0, yearsFromToday))
      : 0;
    const bal10 = pathBal10[idx] ?? mcResult.p10[idx] ?? 0;
    const swr10 = isRetired ? bal10 * pct : 0;
    const bal50 = pathBal50[idx] ?? mcResult.p50[idx] ?? 0;
    const swr50 = isRetired ? bal50 * pct : 0;
    const bal90 = pathBal90[idx] ?? mcResult.p90[idx] ?? 0;
    const swr90 = isRetired ? bal90 * pct : 0;
    const formatSWR = value => {
      if (!isRetired || inflatedBaseline <= 0) return fmtFullCurrency(value);
      const indicator = value > inflatedBaseline ? "✅" : "❌";
      return `${fmtFullCurrency(value)} ${indicator}`;
    };

    const tr = document.createElement("tr");
    const cellConfigs = [
      { value: age.toString() },
      { value: fmtFullCurrency(inflatedBaseline), key: "inflatedNeed" },
      { value: fmtFullCurrency(bal10) },
      { value: formatSWR(swr10) },
      { value: fmtFullCurrency(bal50) },
      { value: formatSWR(swr50) },
      { value: fmtFullCurrency(bal90) },
      { value: formatSWR(swr90) }
    ];
    cellConfigs.filter(Boolean).forEach(cell => {
      const td = document.createElement("td");
      td.textContent = cell.value;
      if (cell.key) {
        td.dataset.col = cell.key;
      }
      tr.appendChild(td);
    });
    resultsTableBody.appendChild(tr);
  });
}

function updateSummary(params, mcResult) {
  const summaryEl = document.getElementById("summaryList");
  const noteEl = document.getElementById("summaryNote");
  summaryEl.innerHTML = "";

  const yearsToRetire = params.retireAge - params.currentAge;
  const yearsInRetirement = params.endAge - params.retireAge;
  const medianAtRetire = mcResult.p50?.[yearsToRetire] ?? 0;
  const sortedFinalBalances = [...mcResult.finalBalances].sort((a, b) => a - b);
  const mcMedianFinal = percentile(sortedFinalBalances, 0.5);
  const mcP10Final = percentile(sortedFinalBalances, 0.1);
  const mcP90Final = percentile(sortedFinalBalances, 0.9);
  const minCoverage = Math.min(...mcResult.coverageProb) || 0;
  const retirementStartIdx = Math.max(0, Math.floor(params.retireAge - params.currentAge));

  const minScenarioCoverage = coverageSeries => {
    if (!Array.isArray(coverageSeries) || !coverageSeries.length) return null;
    const slice = coverageSeries.slice(retirementStartIdx);
    const finite = slice.filter(v => Number.isFinite(v));
    if (!finite.length) return null;
    return Math.max(0, Math.min(...finite));
  };

  const covP10 = minScenarioCoverage(mcResult.coverageRatios?.p10);
  const covP50 = minScenarioCoverage(mcResult.coverageRatios?.p50);
  const covP90 = minScenarioCoverage(mcResult.coverageRatios?.p90);

  const addRow = (label, value) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="summary-label">${label}</span><span class="summary-value">${value}</span>`;
    summaryEl.appendChild(li);
  };

  addRow("Years to retirement", yearsToRetire.toString());
  addRow("Years in retirement (planned)", yearsInRetirement.toString());
  addRow(`MC median balance at retirement (age ${params.retireAge})`, fmtFullCurrency(medianAtRetire));
  addRow("Monte Carlo median final balance", fmtFullCurrency(mcMedianFinal));
  addRow("Monte Carlo 10th %ile final balance", fmtFullCurrency(mcP10Final));
  addRow("Monte Carlo 90th %ile final balance", fmtFullCurrency(mcP90Final));
  addRow(
    "Probability of meeting 100% of need",
    (mcResult.successProb * 100).toFixed(1) + "%"
  );
  addRow("Worst-year probability of 100% coverage (across all MC runs)", (minCoverage * 100).toFixed(0) + "%");

  if (covP10 !== null) addRow("Worst-year coverage ratio (p10 scenario)", (covP10 * 100).toFixed(1) + "%");
  if (covP50 !== null) addRow("Worst-year coverage ratio (p50 scenario)", (covP50 * 100).toFixed(1) + "%");
  if (covP90 !== null) addRow("Worst-year coverage ratio (p90 scenario)", (covP90 * 100).toFixed(1) + "%");

  const successProbPct = mcResult.successProb * 100;
  if (successProbPct >= 90) {
    const failPercentile =
      mcResult.failurePath && mcResult.failurePath.percentile
        ? (mcResult.failurePath.percentile * 100).toFixed(1)
        : null;
    const baseMsg =
      "Looks robust: high probability of success. Try increasing retirement income or retiring earlier to see sensitivity.";
    if (failPercentile && successProbPct < 100) {
      noteEl.innerHTML =
        `${baseMsg} There is still a rare path around p${failPercentile} that runs out—see the dashed fail line on the chart.`;
    } else {
      noteEl.innerHTML = baseMsg;
    }
    noteEl.className = "small";
  } else if (successProbPct >= 70) {
    noteEl.innerHTML =
      "Borderline comfortable: sequence risk remains. Consider higher savings, later retirement, or lower spending to push success toward 90%+.";
    noteEl.className = "small";
  } else {
    noteEl.innerHTML =
      "<span class='badge warn'>Heads up</span> Low success probability. Historical sequences still deplete assets early; tweak spending or contributions.";
    noteEl.className = "small";
  }
}

function downloadResultsCsv() {
  if (!lastMcResult || !lastYears.length || !lastParams) {
    alert("Run the projection first to generate data.");
    return;
  }
  const pct = lastParams.incomeNeedPct || 0;
  const inflationRate = lastParams.inflation || 0;
  const baselineNeed = lastParams.incomeNeedBaseline || lastParams.incomeNeed || 0;
  const header = [
    "Age",
    "Inflated fixed baseline",
    "MC 10th %ile Balance",
    "Safe-withdrawal 10th %ile",
    "MC 50th %ile Balance",
    "Safe-withdrawal target (portfolio %) 50th %ile",
    "MC 90th %ile Balance",
    "Safe-withdrawal target (portfolio %) 90th %ile"
  ];
  const rows = [header.join(",")];
  lastYears.forEach((age, idx) => {
    const yearsFromToday = age - lastParams.currentAge;
    const isRetired = age >= lastParams.retireAge;
    const inflatedBaseline = isRetired
      ? baselineNeed * Math.pow(1 + inflationRate, Math.max(0, yearsFromToday))
      : 0;
    const swr10 = isRetired ? (lastMcResult.p10[idx] ?? 0) * pct : 0;
    const swr50 = isRetired ? (lastMcResult.p50[idx] ?? 0) * pct : 0;
    const swr90 = isRetired ? (lastMcResult.p90[idx] ?? 0) * pct : 0;

    const baseRow = [
      age,
      inflatedBaseline.toFixed(2),
      (lastMcResult.p10[idx] ?? 0).toFixed(2),
      swr10.toFixed(2),
      (lastMcResult.p50[idx] ?? 0).toFixed(2),
      swr50.toFixed(2),
      (lastMcResult.p90[idx] ?? 0).toFixed(2),
      swr90.toFixed(2)
    ];
    rows.push(baseRow.join(","));
  });
  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "retirement_results.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function runStressScenario(key) {
  const scenario = STRESS_SCENARIOS[key];
  if (!scenario) return;
  const params = gatherParams();
  params.preRetReturn = HISTORICAL_STATS.mean / 100;
  params.postRetReturn = HISTORICAL_STATS.mean / 100;
  const detResult = simulateDeterministic(params, { customReturns: scenario.returns });
  const minBalance = Math.min(...detResult.balances);
  const minAge = detResult.years[detResult.balances.indexOf(minBalance)];
  const finalBalance = detResult.balances[detResult.balances.length - 1];
  const coveragePct = (
    detResult.coverageFlags.reduce((sum, flag) => sum + (flag ? 1 : 0), 0) / detResult.coverageFlags.length
  ) * 100;

  stressResultsEl.innerHTML = `
    <strong>${scenario.label}</strong><br />
    Final balance: $${fmtCurrency(finalBalance)} • Worst-year balance: $${fmtCurrency(minBalance)} @ age ${minAge}<br />
    Income fully met in ${coveragePct.toFixed(0)}% of years in this sequence.
  `;

  if (stressTableBody && stressTableWrap) {
    stressTableBody.innerHTML = "";
    detResult.years.forEach((age, idx) => {
      const tr = document.createElement("tr");
      const cells = [
        age.toString(),
        fmtFullCurrency(detResult.balances[idx] ?? 0),
        detResult.incomeNeeded[idx] > 0 ? fmtFullCurrency(detResult.incomeNeeded[idx]) : "—",
        detResult.coverageFlags[idx] ? "Yes" : "No"
      ];
      cells.forEach(text => {
        const td = document.createElement("td");
        td.textContent = text;
        tr.appendChild(td);
      });
      stressTableBody.appendChild(tr);
    });
    stressTableWrap.style.display = "";
    stressTableWrap.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function getStoredScenarios() {
  try {
    const raw = localStorage.getItem("retireCalcScenarios");
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.warn("Unable to read scenarios", err);
    return [];
  }
}

function setStoredScenarios(list) {
  localStorage.setItem("retireCalcScenarios", JSON.stringify(list));
}

function captureInputsSnapshot() {
  const snapshot = {};
  document.querySelectorAll("input, select, textarea").forEach(el => {
    if (!el.id) return;
    if (el.type === "checkbox") {
      snapshot[el.id] = { type: "checkbox", value: el.checked };
    } else {
      snapshot[el.id] = { type: "value", value: el.value };
    }
  });
  if (goalListEl) {
    snapshot.__goals = { type: "json", value: readGoalRowsRaw() };
  }
  return snapshot;
}

function applySnapshot(snapshot) {
  if (goalListEl && !("__goals" in snapshot)) {
    setGoalRows([]);
  }
  Object.entries(snapshot).forEach(([id, info]) => {
    if (id === "__goals" && info.type === "json") {
      setGoalRows(info.value || []);
      return;
    }
    const el = document.getElementById(id);
    if (!el) return;
    if (info.type === "checkbox") {
      el.checked = info.value;
    } else {
      el.value = info.value;
    }
  });
  updateInflationPresetSelection();
  updateMCNormalFieldsVisibility();
  updateBondTentingFields();
  wireAllCurrencyInputs();
}

function renderScenarioList() {
  const scenarios = getStoredScenarios();
  if (!scenarios.length) {
    scenarioListEl.innerHTML = "<div class='small'>No saved scenarios yet.</div>";
    return;
  }
  scenarioListEl.innerHTML = "";
  scenarios.forEach((scenario, idx) => {
    const wrapper = document.createElement("label");
    wrapper.className = "scenario-pill";
    wrapper.innerHTML = `
      <span>
        <input type="radio" name="scenarioPick" value="${scenario.name}" ${idx === 0 ? "checked" : ""} style="margin-right:0.35rem;" />
        <strong>${scenario.name}</strong>
      </span>
      <span style="font-size:0.75rem;color:#6b7280;">${new Date(scenario.timestamp).toLocaleDateString()}</span>
    `;
    scenarioListEl.appendChild(wrapper);
  });
}

function getSelectedScenarioName() {
  const input = document.querySelector("input[name='scenarioPick']:checked");
  return input ? input.value : null;
}

function handleSaveScenario() {
  const nameInput = document.getElementById("scenarioName");
  const name = nameInput.value.trim();
  if (!name) {
    alert("Enter a scenario name first.");
    return;
  }
  const scenarios = getStoredScenarios();
  const snapshot = captureInputsSnapshot();
  const existingIndex = scenarios.findIndex(s => s.name === name);
  const record = { name, timestamp: Date.now(), snapshot };
  if (existingIndex >= 0) {
    scenarios[existingIndex] = record;
  } else {
    scenarios.push(record);
  }
  setStoredScenarios(scenarios);
  renderScenarioList();
}

function handleLoadScenario() {
  const selected = getSelectedScenarioName();
  if (!selected) {
    alert("Select a saved scenario to load.");
    return;
  }
  const scenarios = getStoredScenarios();
  const scenario = scenarios.find(s => s.name === selected);
  if (!scenario) return;
  applySnapshot(scenario.snapshot);
  document.getElementById("runBtn").click();
}

function handleDeleteScenario() {
  const selected = getSelectedScenarioName();
  if (!selected) {
    alert("Select a saved scenario to delete.");
    return;
  }
  const scenarios = getStoredScenarios().filter(s => s.name !== selected);
  setStoredScenarios(scenarios);
  renderScenarioList();
}

function updateSimulationsTab(yearLabels, mcResult, params) {
  simResults = [...(mcResult.allSims || [])];
  currentSimPage = 1;
  lastYears = yearLabels;
  lastParams = params;
  
  sortSimulations();
  renderSimBubbles();
  renderBalanceBoxplot(yearLabels, mcResult);
}

function sortSimulations() {
  if (!simResults || simResults.length === 0) return;

  simResults.sort((a, b) => {
    // Primary: Severity of the worst year (descending coverage ratio)
    // 1.0 (success) first, 0.0 (total failure) last.
    const aRatio = a.minCoverageRatio ?? 1;
    const bRatio = b.minCoverageRatio ?? 1;
    if (Math.abs(aRatio - bRatio) > 1e-9) {
      return bRatio - aRatio;
    }

    // Secondary: Number of years with shortfall (ascending)
    // 0 years first, then 1, 2, 3...
    const aShort = a.shortfallYears ?? 0;
    const bShort = b.shortfallYears ?? 0;
    if (aShort !== bShort) {
      return aShort - bShort;
    }

    // Tertiary: Final balance (descending)
    // High balance first.
    return (b.finalBalance ?? 0) - (a.finalBalance ?? 0);
  });
}

function renderSimBubbles() {
  const container = document.getElementById("simBubbleContainer");
  const paginationEl = document.getElementById("simPagination");
  if (!container || !paginationEl) return;

  container.innerHTML = "";
  
  const start = (currentSimPage - 1) * simsPerPage;
  const end = Math.min(start + simsPerPage, simResults.length);
  const pageSims = simResults.slice(start, end);

  pageSims.forEach(sim => {
    const bubble = document.createElement("div");
    bubble.className = "sim-bubble";
    
    // Success coloring
    if (sim.success) {
      bubble.classList.add("success");
    } else if (sim.minCoverageRatio >= 0.5) {
      bubble.classList.add("warning");
    } else {
      bubble.classList.add("danger");
    }

    bubble.title = `Sim #${sim.id + 1}\nShortfall Years: ${sim.shortfallYears}\nFinal: ${fmtFullCurrency(sim.finalBalance)}\nMin Coverage: ${(sim.minCoverageRatio * 100).toFixed(1)}%`;
    bubble.textContent = (sim.id + 1).toString();
    
    bubble.addEventListener("click", () => {
      document.querySelectorAll(".sim-bubble").forEach(b => b.classList.remove("active"));
      bubble.classList.add("active");
      showSimDetail(sim);
    });

    container.appendChild(bubble);
  });

  renderSimPagination(paginationEl);
}

function renderSimPagination(el) {
  const totalPages = Math.ceil(simResults.length / simsPerPage);
  el.innerHTML = "";

  if (totalPages <= 1) return;

  const prevBtn = document.createElement("button");
  prevBtn.textContent = "←";
  prevBtn.disabled = currentSimPage === 1;
  prevBtn.addEventListener("click", () => {
    currentSimPage--;
    renderSimBubbles();
  });
  el.appendChild(prevBtn);

  const info = document.createElement("span");
  info.className = "page-info";
  info.textContent = `Page ${currentSimPage} of ${totalPages}`;
  el.appendChild(info);

  const nextBtn = document.createElement("button");
  nextBtn.textContent = "→";
  nextBtn.disabled = currentSimPage === totalPages;
  nextBtn.addEventListener("click", () => {
    currentSimPage++;
    renderSimBubbles();
  });
  el.appendChild(nextBtn);
}

function showSimDetail(sim) {
  const detailEl = document.getElementById("selectedSimDetail");
  const titleEl = document.getElementById("selectedSimTitle");
  const noteEl = document.getElementById("selectedSimNote");
  const canvas = document.getElementById("selectedSimChart");
  
  if (!detailEl || !titleEl || !noteEl || !canvas) return;

  detailEl.style.display = "block";
  titleEl.textContent = `Simulation #${sim.id + 1} Details`;
  
  if (selectedSimChart) selectedSimChart.destroy();

  const ctx = canvas.getContext("2d");
  
  const withdrawalData = (sim.withdrawals || []).map((val, idx) => {
    const age = lastYears[idx];
    return age < lastParams.retireAge ? null : val;
  });

  const benchmarkSeries = (sim.benchmarks || []).map((val, idx) => {
    const age = lastYears[idx];
    if (age < lastParams.retireAge) return null;
    return val > 0 ? val : null;
  });

  const hasBenchmarks = benchmarkSeries.some(v => v !== null);

  const datasets = [
    {
      label: "Balance ($)",
      data: sim.balances,
      borderWidth: 2,
      borderColor: "rgba(21, 128, 61, 1)",
      backgroundColor: "rgba(21, 128, 61, 0.1)",
      tension: 0.15,
      fill: false,
      yAxisID: "y"
    },
    {
      label: "Actual withdrawal ($)",
      data: withdrawalData,
      borderWidth: 2,
      borderColor: "rgba(168, 85, 247, 1)",
      backgroundColor: "rgba(168, 85, 247, 0.1)",
      tension: 0.15,
      fill: false,
      yAxisID: "y",
      spanGaps: true
    }
  ];

  if (hasBenchmarks) {
    datasets.push({
      label: "Inflated fixed baseline ($)",
      data: benchmarkSeries,
      borderWidth: 2,
      borderColor: "rgba(107, 114, 128, 0.9)",
      backgroundColor: "rgba(107, 114, 128, 0.08)",
      tension: 0.15,
      fill: false,
      yAxisID: "y",
      borderDash: [4, 4]
    });
  }

  selectedSimChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: lastYears.map(String),
      datasets
    },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${fmtFullCurrency(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        y: {
          ticks: {
            callback: val => fmtCurrency(val)
          }
        }
      }
    }
  });

  noteEl.textContent = `This simulation had ${sim.shortfallYears} shortfall years and ended with a balance of ${fmtFullCurrency(sim.finalBalance)}. Minimum income coverage was ${(sim.minCoverageRatio * 100).toFixed(1)}%.`;
  
  // Scroll to detail
  detailEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function handleTabClick(e) {
  const tab = e.currentTarget.dataset.tab;
  tabButtons.forEach(btn => btn.classList.toggle("active", btn.dataset.tab === tab));
  tabPanels.forEach(panel => panel.classList.toggle("active", panel.dataset.tab === tab));
}

function updateMCNormalFieldsVisibility() {
  const show = mcModeSelect.value === "normal";
  mcNormalFields.forEach(field => {
    field.style.display = show ? "" : "none";
  });
}


function updateBondTentingFields() {
  const enabled = bondTentingToggle ? bondTentingToggle.checked : false;
  document.querySelectorAll('[data-bond-tenting-field]').forEach(wrapper => {
    wrapper.classList.toggle("stream-disabled", !enabled);
    wrapper.querySelectorAll("input").forEach(input => {
      input.disabled = !enabled;
    });
  });
}

function readCurrencyInput(id) {
  const el = document.getElementById(id);
  if (!el) return 0;
  return parseCurrencyValue(el.value);
}

function formatCurrencyInput(el) {
  if (!el) return;
  const currentValue = el.value.trim();
  if (currentValue === "") return;
  
  // Check if already formatted (contains comma)
  const hasComma = currentValue.includes(',');
  const num = parseCurrencyValue(currentValue);
  
  if (!Number.isFinite(num)) {
    el.value = "";
    return;
  }
  if (num === 0) {
    el.value = "";
    return;
  }
  
  // Only reformat if not already formatted or if formatting would change it
  const formatted = num.toLocaleString('en-US');
  if (!hasComma || formatted !== currentValue) {
    el.value = formatted;
  }
}

function setupCurrencyInput(el) {
  if (!el) return;
  if (el.dataset.currencyWired !== "1") {
    el.dataset.currencyWired = "1";
    el.addEventListener("focus", () => {
      el.value = el.value.replace(/,/g, "");
      requestAnimationFrame(() => {
        if (typeof el.select === "function") el.select();
      });
    });
    el.addEventListener("blur", () => {
      formatCurrencyInput(el);
    });
  }
  formatCurrencyInput(el);
}

function wireAllCurrencyInputs() {
  document.querySelectorAll(".currency-input").forEach(setupCurrencyInput);
}

function createGoalRow(data = {}) {
  if (!goalListEl) return;
  const row = document.createElement("div");
  row.className = "goal-row";

  const labelInput = document.createElement("input");
  labelInput.type = "text";
  labelInput.placeholder = "Label";
  labelInput.className = "goal-label";
  labelInput.value = data.label ?? "";

  const ageInput = document.createElement("input");
  ageInput.type = "number";
  ageInput.min = "20";
  ageInput.max = "110";
  ageInput.placeholder = "Age";
  ageInput.className = "goal-age";
  ageInput.value = data.age ?? "";

  const amountWrap = document.createElement("div");
  amountWrap.className = "inline-unit";
  const amountPrefix = document.createElement("span");
  amountPrefix.textContent = "$";
  const amountInput = document.createElement("input");
  amountInput.type = "text";
  amountInput.inputMode = "decimal";
  amountInput.step = "1000";
  amountInput.placeholder = "Amount";
  amountInput.className = "goal-amount currency-input";
  amountInput.value = data.amount ?? "";
  amountWrap.appendChild(amountPrefix);
  amountWrap.appendChild(amountInput);
  setupCurrencyInput(amountInput);

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "secondary goal-remove-btn";
  removeBtn.textContent = "✕";

  row.appendChild(labelInput);
  row.appendChild(ageInput);
  row.appendChild(amountWrap);
  row.appendChild(removeBtn);
  goalListEl.appendChild(row);
}

function setGoalRows(rows) {
  if (!goalListEl) return;
  goalListEl.innerHTML = "";
  const safeRows = Array.isArray(rows) ? rows : [];
  if (!safeRows.length) {
    createGoalRow();
  } else {
    safeRows.forEach(row => createGoalRow(row));
  }
}

function readGoalRowsRaw() {
  if (!goalListEl) return [];
  return Array.from(goalListEl.querySelectorAll(".goal-row")).map(row => ({
    label: row.querySelector(".goal-label")?.value ?? "",
    age: row.querySelector(".goal-age")?.value ?? "",
    amount: row.querySelector(".goal-amount")?.value ?? ""
  }));
}

wireAllCurrencyInputs();

function resetToDefaults() {
  const assignments = {
    currentAge: 35,
    retireAge: 55,
    endAge: 100,
    currentSavings: 1500000,
    annualContrib: 300000,
    incomeNeed: 200000,
    incomeNeedBaseline: 200000,
    incomeNeedPct: 5.0,
    inflation: 3,
    taxRate: 18,
    numSims: 1000,
    mcMean: HISTORICAL_STATS.mean.toFixed(1),
    mcStdev: HISTORICAL_STATS.stdev.toFixed(1),
    scenarioName: ""
  };
  Object.entries(assignments).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = value;
  });
  if (incomeNeedModeSelect) incomeNeedModeSelect.value = "portfolio_pct";
  document.getElementById("mcMode").value = "historical_regime_markov_1980";
  document.getElementById("inflationMode").value = "historical";
  if (bondTentingToggle) bondTentingToggle.checked = false;
  if (inflationPresetSelect) inflationPresetSelect.value = "since1980";
  resetInflationSelectionNote();
  resetSavingsSuggestionNote();
  updateInflationPresetSelection();
  updateMCNormalFieldsVisibility();
  updateBondTentingFields();
  updateIncomeNeedModeVisibility();
  setGoalRows([]);
  // Reformat currency inputs after setting values
  wireAllCurrencyInputs();
}

function runSimulation() {
  const params = gatherParams();
  const mcConfig = gatherMCConfig();
  const mcResult = runMonteCarlo(params, mcConfig);
  const years = [];
  for (let age = params.currentAge; age <= params.endAge; age++) {
    years.push(age);
  }
  lastMcResult = mcResult;
  lastYears = years;
  lastParams = params;

  updateChart(years, mcResult);
  updateFailureScenarioChart(years, mcResult, params.currentAge, params.retireAge, params);
  updatePercentile10Chart(years, mcResult, params.currentAge, params.retireAge, params);
  updatePercentile50Chart(years, mcResult, params.currentAge, params.retireAge, params);
  updatePercentile90Chart(years, mcResult, params.currentAge, params.retireAge, params);
  updateSummary(params, mcResult);
  updateResultsTable(years, mcResult, params);
  updateSavingsSuggestion(params, mcConfig, mcResult);
  updateSimulationsTab(years, mcResult, params);
}

document.getElementById("runBtn").addEventListener("click", runSimulation);
document.getElementById("resetBtn").addEventListener("click", () => {
  resetToDefaults();
  runSimulation();
});
downloadCsvBtn.addEventListener("click", downloadResultsCsv);

document.querySelectorAll("[data-stress]").forEach(btn => {
  btn.addEventListener("click", () => runStressScenario(btn.dataset.stress));
});

if (inflationPresetSelect) {
  inflationPresetSelect.addEventListener("change", () => {
    updateInflationPresetSelection();
  });
}
mcModeSelect.addEventListener("change", () => {
  updateMCNormalFieldsVisibility();
});
if (bondTentingToggle) {
  bondTentingToggle.addEventListener("change", updateBondTentingFields);
}
if (goalListEl) {
  goalListEl.addEventListener("click", event => {
    const btn = event.target.closest(".goal-remove-btn");
    if (btn) {
      const row = btn.closest(".goal-row");
      row?.remove();
      if (!goalListEl.querySelector(".goal-row")) {
        createGoalRow();
      }
    }
  });
}
if (addGoalBtn) {
  addGoalBtn.addEventListener("click", () => createGoalRow());
}

const simSortSelect = document.getElementById("simSort");
if (simSortSelect) {
  simSortSelect.addEventListener("change", () => {
    currentSimPage = 1;
    sortSimulations();
    renderSimBubbles();
  });
}

tabButtons.forEach(btn => btn.addEventListener("click", handleTabClick));

document.getElementById("saveScenarioBtn").addEventListener("click", handleSaveScenario);
document.getElementById("loadScenarioBtn").addEventListener("click", handleLoadScenario);
document.getElementById("deleteScenarioBtn").addEventListener("click", handleDeleteScenario);

function updateIncomeNeedModeVisibility() {
  const mode = incomeNeedModeSelect?.value || "portfolio_pct";
  const helpEl = document.getElementById("incomeNeedHelp");

  if (incomeNeedFixedRow) incomeNeedFixedRow.style.display = mode === "fixed" ? "" : "none";
  if (incomeNeedPctRow) incomeNeedPctRow.style.display = (mode === "portfolio_pct" || mode === "portfolio_pct_uncapped") ? "" : "none";
  if (incomeNeedBaselineRow) incomeNeedBaselineRow.style.display = (mode === "portfolio_pct" || mode === "portfolio_pct_uncapped") ? "" : "none";

  if (helpEl) {
    if (mode === "portfolio_pct") {
      helpEl.textContent = "In 'Lower of % or fixed amount (capped)' mode, withdrawals are capped at the lower of your inflated baseline need and the chosen % of portfolio value. If you want this to behave mainly as a boom-year spending cap (not an austerity rule), pick a % high enough that it usually doesn’t bind below your baseline in normal years.";
    } else if (mode === "portfolio_pct_uncapped") {
      helpEl.textContent = "In 'Fixed % of portfolio (uncapped)' mode, yearly withdrawals are exactly the chosen percentage of portfolio value, with no upper limit in strong market years. The baseline is used for success probability and table comparisons.";
    } else {
      helpEl.textContent = "";
    }
  }
}

window.addEventListener("load", () => {
  initInflationTools();
  renderScenarioList();
  resetToDefaults();
  runSimulation();
});

if (incomeNeedModeSelect) {
  incomeNeedModeSelect.addEventListener("change", () => {
    updateIncomeNeedModeVisibility();
  });
}
