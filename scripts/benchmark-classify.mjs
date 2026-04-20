const baseUrl = process.env.CLASSIFY_BASE_URL || "http://127.0.0.1:3000";
const repeats = Number.parseInt(process.env.CLASSIFY_BENCHMARK_REPEATS || "1", 10);

const cases = [
  { text: "hello", expectedKind: "word" },
  { text: "12345", expectedKind: "number" },
  { text: "The weather is nice.", expectedKind: "declarative" },
  { text: "Is the weather nice?", expectedKind: "interrogative" },
  { text: "Close the door.", expectedKind: "imperative" },
  { text: "What a beautiful day!", expectedKind: "exclamatory" },
  { text: "Please sit down.", expectedKind: "imperative" },
  { text: "Wow!", expectedKind: "exclamatory" },
  { text: "Blue", expectedKind: "word" }
];

function percentile(values, p) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);

  return sorted[index];
}

function average(values) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundMs(value) {
  return Math.round(value);
}

async function classify(text) {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}/api/classify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ text })
  });
  const latencyMs = performance.now() - startedAt;
  const payload = await response.json();

  return {
    latencyMs: roundMs(latencyMs),
    response,
    payload
  };
}

async function runCase(testCase, iteration) {
  try {
    const result = await classify(testCase.text);
    const actualKind = result.payload.ok ? result.payload.data.kind : null;
    const passed =
      result.response.ok &&
      result.payload.ok &&
      actualKind === testCase.expectedKind;

    return {
      iteration,
      text: testCase.text,
      expectedKind: testCase.expectedKind,
      actualKind,
      status: result.response.status,
      latencyMs: result.latencyMs,
      passed,
      error: result.payload.ok ? "" : result.payload.error
    };
  } catch (error) {
    return {
      iteration,
      text: testCase.text,
      expectedKind: testCase.expectedKind,
      actualKind: null,
      status: 0,
      latencyMs: 0,
      passed: false,
      error: error instanceof Error ? error.message : "Request failed"
    };
  }
}

async function main() {
  const normalizedRepeats = Number.isFinite(repeats) && repeats > 0 ? repeats : 1;
  const results = [];

  for (let iteration = 1; iteration <= normalizedRepeats; iteration += 1) {
    for (const testCase of cases) {
      results.push(await runCase(testCase, iteration));
    }
  }

  const latencies = results
    .filter((result) => result.status > 0)
    .map((result) => result.latencyMs);
  const passedCount = results.filter((result) => result.passed).length;
  const failedResults = results.filter((result) => !result.passed);

  console.log("Classify route stability benchmark");
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Cases: ${cases.length}`);
  console.log(`Repeats: ${normalizedRepeats}`);
  console.log(
    `Correctness: ${passedCount}/${results.length} passed`
  );
  console.log(
    `Latency: avg ${roundMs(average(latencies))} ms, median ${roundMs(
      percentile(latencies, 0.5)
    )} ms, p90 ${roundMs(percentile(latencies, 0.9))} ms`
  );
  console.table(
    results.map((result) => ({
      iteration: result.iteration,
      input: result.text,
      expected: result.expectedKind,
      actual: result.actualKind,
      status: result.status,
      latencyMs: result.latencyMs,
      passed: result.passed
    }))
  );

  if (failedResults.length > 0) {
    console.error("Regression failures:");
    console.error(JSON.stringify(failedResults, null, 2));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
