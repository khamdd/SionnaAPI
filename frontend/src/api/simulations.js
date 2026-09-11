import { requestJson } from "./http";

export function runNetworkCoverage(payload) {
  return requestJson("/api/v1/network-coverage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function runNetworkCoverageOptimization(payload) {
  return requestJson("/api/v1/optimizations/network-coverage/run", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function runCoverageMap(payload) {
  return requestJson("/api/v1/coverage-map", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function runRsrpSimulation(payload) {
  return requestJson("/api/v1/rsrp-simulation", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function runSinr(payload) {
  return requestJson("/api/v1/sinr", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function runThroughputComparison(payload) {
  return requestJson("/api/v1/throughput-comparison", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}
