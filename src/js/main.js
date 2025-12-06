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
  estimateAdditionalWorkYears
} from "./simulation.js";

const ctx = document.getElementById("chart").getContext("2d");
const failScenarioCtx = document.getElementById("failScenarioChart")?.getContext("2d");
const percentile10Ctx = document.getElementById("percentile10Chart").getContext("2d");
const percentile50Ctx = document.getElementById("percentile50Chart").getContext("2d");
const percentile90Ctx = document.getElementById("percentile90Chart").getContext("2d");
const resultsTableBody = document.getElementById("resultsTableBody");
const mcModeSelect = document.getElementById("mcMode");
const mcNormalFields = document.querySelectorAll(".mc-normal-field");
const ssToggle = document.getElementById("ssEnabled");
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
  if (!suggestion) {
    savingsSuggestionEl.textContent = "Unable to compute a savings suggestion for these inputs.";
    return;
  }
  const targetPct = (suggestion.target * 100).toFixed(0);
  const successPct = (suggestion.achievedSuccess * 100).toFixed(1);
  const maxBump = fmtFullCurrency(MAX_SAVINGS_SEARCH);
  if (suggestion.extraAnnual === 0) {
    let msg = `<span class="badge">On track</span> Success probability is already ${successPct}%, clearing the ${targetPct}% goal.`;
    if (workSuggestion && workSuggestion.extraYears > 0) {
      const yearsText = workSuggestion.extraYears === 1 ? "1 extra year" : `${workSuggestion.extraYears} extra years`;
      const workPct = (workSuggestion.achievedSuccess * 100).toFixed(1);
      msg += ` Working ${yearsText} (retire age ${workSuggestion.retireAge}) would raise it further to ${workPct}%.`;
    }
    savingsSuggestionEl.innerHTML = msg;
  } else if (suggestion.extraAnnual === null) {
    let msg = `<span class="badge warn">Heads up</span> Even adding ${maxBump} per year kept success below ${targetPct}%.`;
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
    savingsSuggestionEl.innerHTML = msg;
  } else {
    let msg = `Adding about ${fmtFullCurrency(suggestion.extraAnnual)} per year lifts success to ${successPct}% (target ${targetPct}%).`;
    if (workSuggestion && workSuggestion.extraYears > 0) {
      const yearsText =
        workSuggestion.extraYears === 1 ? "1 extra year" : `${workSuggestion.extraYears} extra years`;
      const workPct = (workSuggestion.achievedSuccess * 100).toFixed(1);
      msg += ` Alternatively, working ${yearsText} (retire age ${workSuggestion.retireAge}) hits ${workPct}%.`;
    } else if (workSuggestion && workSuggestion.extraYears === 0) {
      msg += " Working longer isn’t required for the 90% goal.";
    } else if (workSuggestion && workSuggestion.extraYears === null) {
      msg += ` Working up to ${MAX_EXTRA_WORK_YEARS} extra years stayed below ${targetPct}%.`;
    }
    savingsSuggestionEl.innerHTML = msg;
  }
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

function gatherIncomeStreams() {
  const streams = [];
  if (ssToggle && ssToggle.checked) {
    streams.push({
      type: "socialSecurity",
      startAge: parseFloat(document.getElementById("ssStartAge").value),
      amount: readCurrencyInput("ssAmount"),
      cola: document.getElementById("ssCola").checked
    });
  }
  return streams.filter(
    stream =>
      Number.isFinite(stream.startAge) &&
      Number.isFinite(stream.amount) &&
      stream.amount > 0
  );
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
    incomeStreams: gatherIncomeStreams(),
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
      label: "Withdrawal ($)",
      data: withdrawalData,
      borderWidth: 2,
      borderColor: "rgba(168, 85, 247, 1)",
      backgroundColor: "rgba(168, 85, 247, 0.1)",
      tension: 0.15,
      fill: false,
      yAxisID: "y1",
      spanGaps: true
    },
    params?.incomeNeedMode === "portfolio_pct" && hasBenchmarks
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
      label: "Withdrawal ($)",
      data: withdrawalData,
      borderWidth: 2,
      borderColor: "rgba(168, 85, 247, 1)",
      backgroundColor: "rgba(168, 85, 247, 0.1)",
      tension: 0.15,
      fill: false,
      yAxisID: "y1",
      spanGaps: true
    },
    params?.incomeNeedMode === "portfolio_pct" && hasBenchmarks
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
      borderColor: "rgba(239, 68, 68, 1)",
      backgroundColor: "rgba(239, 68, 68, 0.1)",
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
      label: "Withdrawal ($)",
      data: withdrawalData,
      borderWidth: 2,
      borderColor: "rgba(168, 85, 247, 1)",
      backgroundColor: "rgba(168, 85, 247, 0.1)",
      tension: 0.15,
      fill: false,
      yAxisID: "y1",
      spanGaps: true
    },
    params?.incomeNeedMode === "portfolio_pct" && hasBenchmarks
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
      label: "Withdrawal ($)",
      data: withdrawalData,
      borderWidth: 2,
      borderColor: "rgba(168, 85, 247, 1)",
      backgroundColor: "rgba(168, 85, 247, 0.1)",
      tension: 0.15,
      fill: false,
      yAxisID: "y1",
      spanGaps: true
    },
    params?.incomeNeedMode === "portfolio_pct" && hasBenchmarks
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

  yearLabels.forEach((age, idx) => {
    const yearsFromToday = age - (params?.currentAge || age);
    const isRetired = age >= (params?.retireAge || age + 1);
    const inflatedBaseline = isRetired
      ? baselineNeed * Math.pow(1 + inflationRate, Math.max(0, yearsFromToday))
      : 0;
    const swr10 = isRetired ? (mcResult.p10[idx] ?? 0) * pct : 0;
    const swr50 = isRetired ? (mcResult.p50[idx] ?? 0) * pct : 0;
    const swr90 = isRetired ? (mcResult.p90[idx] ?? 0) * pct : 0;
    const formatSWR = value => {
      if (!isRetired || inflatedBaseline <= 0) return fmtFullCurrency(value);
      const indicator = value > inflatedBaseline ? "✅" : "❌";
      return `${fmtFullCurrency(value)} ${indicator}`;
    };

    const tr = document.createElement("tr");
    const cellConfigs = [
      { value: age.toString() },
      { value: fmtFullCurrency(inflatedBaseline), key: "inflatedNeed" },
      { value: fmtFullCurrency(mcResult.p10[idx] ?? 0) },
      { value: formatSWR(swr10) },
      { value: fmtFullCurrency(mcResult.p50[idx] ?? 0) },
      { value: formatSWR(swr50) },
      { value: fmtFullCurrency(mcResult.p90[idx] ?? 0) },
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
  addRow("Probability of not running out of money", (mcResult.successProb * 100).toFixed(1) + "%");
  addRow("Lowest annual income coverage (MC)", (minCoverage * 100).toFixed(0) + "%");

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
        detResult.incomeOffsets[idx] > 0 ? fmtFullCurrency(detResult.incomeOffsets[idx]) : "—",
        detResult.netNeeds[idx] > 0 ? fmtFullCurrency(detResult.netNeeds[idx]) : "—",
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
  updateIncomeStreamFields();
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

function updateIncomeStreamFields() {
  const enabled = ssToggle ? ssToggle.checked : false;
  document.querySelectorAll('[data-stream-group="ss"]').forEach(wrapper => {
    wrapper.classList.toggle("stream-disabled", !enabled);
    wrapper.querySelectorAll("input").forEach(input => {
      input.disabled = !enabled;
    });
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
    currentSavings: 1250000,
    annualContrib: 300000,
    incomeNeed: 200000,
    incomeNeedBaseline: 200000,
    incomeNeedPct: 3.5,
    inflation: 3,
    taxRate: 25,
    numSims: 1000,
    mcMean: HISTORICAL_STATS.mean.toFixed(1),
    mcStdev: HISTORICAL_STATS.stdev.toFixed(1),
    ssStartAge: 67,
    ssAmount: 40000,
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
  if (ssToggle) ssToggle.checked = false;
  document.getElementById("ssCola").checked = false;
  if (bondTentingToggle) bondTentingToggle.checked = false;
  if (inflationPresetSelect) inflationPresetSelect.value = "since1980";
  resetInflationSelectionNote();
  resetSavingsSuggestionNote();
  updateInflationPresetSelection();
  updateMCNormalFieldsVisibility();
  updateIncomeStreamFields();
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
if (ssToggle) {
  ssToggle.addEventListener("change", updateIncomeStreamFields);
}
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

tabButtons.forEach(btn => btn.addEventListener("click", handleTabClick));

document.getElementById("saveScenarioBtn").addEventListener("click", handleSaveScenario);
document.getElementById("loadScenarioBtn").addEventListener("click", handleLoadScenario);
document.getElementById("deleteScenarioBtn").addEventListener("click", handleDeleteScenario);

function updateIncomeNeedModeVisibility() {
  const mode = incomeNeedModeSelect?.value || "portfolio_pct";
  if (incomeNeedFixedRow) incomeNeedFixedRow.style.display = mode === "fixed" ? "" : "none";
  if (incomeNeedPctRow) incomeNeedPctRow.style.display = mode === "portfolio_pct" ? "" : "none";
  if (incomeNeedBaselineRow) incomeNeedBaselineRow.style.display = mode === "portfolio_pct" ? "" : "none";
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
