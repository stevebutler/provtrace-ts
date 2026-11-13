import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type { LoadedPolicy, loadPolicySync as LoadPolicySyncFn } from "@open-policy-agent/opa-wasm";
import type { ProvStore } from "../db/store.js";

const require = createRequire(import.meta.url);
const { loadPolicySync } = require("@open-policy-agent/opa-wasm") as {
  loadPolicySync: typeof LoadPolicySyncFn;
};
import type {
  AnomalySeverity,
  ProcessAnomaly,
  ProvActivity,
  ProvAgent,
  ProvEntity,
  ProvRelation,
  RequirementTrace,
} from "./types.js";

export interface GovernanceContext {
  entities: ProvEntity[];
  activities: ProvActivity[];
  agents: ProvAgent[];
  relations: ProvRelation[];
  requirementTraces: RequirementTrace[];
}

export interface GovernanceRuleFinding {
  nodeId: string;
  label: string;
  detail: string;
}

export interface GovernanceRuleMetadata {
  id: string;
  category: string;
  severity: AnomalySeverity;
  description: string;
}

export interface GovernanceRule extends GovernanceRuleMetadata {
  evaluate: (ctx: GovernanceContext) => GovernanceRuleFinding[];
}

const DEFAULT_REGO_PATH = path.resolve(process.cwd(), "policies/governance.rego");
const DEFAULT_WASM_PATH = path.resolve(process.cwd(), "policies/policy.wasm");

let cachedPolicy: LoadedPolicy | null = null;
let cachedWasmMtimeMs = 0;

function ensureFreshWasmBundle(wasmPath: string): void {
  if (wasmPath !== DEFAULT_WASM_PATH || !fs.existsSync(DEFAULT_REGO_PATH)) {
    return;
  }
  const regoStat = fs.statSync(DEFAULT_REGO_PATH);
  const wasmExists = fs.existsSync(wasmPath);
  const wasmStat = wasmExists ? fs.statSync(wasmPath) : null;

  if (!wasmStat || regoStat.mtimeMs > wasmStat.mtimeMs) {
    const tmpBundle = path.join(os.tmpdir(), `provtrace-opa-${process.pid}.tar.gz`);
    try {
      execFileSync(
        "opa",
        [
          "build",
          "-t",
          "wasm",
          "-e",
          "provtrace/governance/anomalies",
          "-e",
          "provtrace/governance/rules",
          "-e",
          "provtrace/governance/findings",
          "-o",
          tmpBundle,
          DEFAULT_REGO_PATH,
        ],
        { stdio: "pipe" }
      );
      execFileSync("tar", ["-m", "-xzf", tmpBundle, "-C", path.dirname(wasmPath), "/policy.wasm"], {
        stdio: "pipe",
      });
    } finally {
      fs.rmSync(tmpBundle, { force: true });
    }
  }
}

function getOpaPolicy(wasmPath: string = DEFAULT_WASM_PATH): LoadedPolicy {
  ensureFreshWasmBundle(wasmPath);
  const wasmStat = fs.statSync(wasmPath);

  if (!cachedPolicy || wasmPath !== DEFAULT_WASM_PATH || wasmStat.mtimeMs !== cachedWasmMtimeMs) {
    const wasmBuffer = fs.readFileSync(wasmPath);
    const loaded = loadPolicySync(wasmBuffer);
    if (wasmPath === DEFAULT_WASM_PATH) {
      cachedPolicy = loaded;
      cachedWasmMtimeMs = wasmStat.mtimeMs;
    }
    return loaded;
  }
  return cachedPolicy;
}

function unwrapOpaResult<T>(rawResult: unknown, fallback: T): T {
  if (Array.isArray(rawResult) && rawResult.length > 0 && rawResult[0] && "result" in rawResult[0]) {
    return (rawResult[0] as { result: T }).result ?? fallback;
  }
  return fallback;
}

/**
 * Loads rule metadata (id, category, severity, description) defined in policies/governance.rego
 * and binds each rule's evaluate() function to the compiled OPA WebAssembly policy.
 */
export function loadGovernanceRulesFromOpa(wasmPath: string = DEFAULT_WASM_PATH): readonly GovernanceRule[] {
  const policy = getOpaPolicy(wasmPath);
  const metadataList = unwrapOpaResult<GovernanceRuleMetadata[]>(
    policy.evaluate({}, "provtrace/governance/rules"),
    []
  );

  return metadataList.map((meta) => ({
    ...meta,
    evaluate(ctx: GovernanceContext): GovernanceRuleFinding[] {
      const allFindings = unwrapOpaResult<Record<string, GovernanceRuleFinding[]>>(
        policy.evaluate(ctx, "provtrace/governance/findings"),
        {}
      );
      return allFindings[meta.id] ?? [];
    },
  }));
}

/**
 * Central registry of software development process-mining governance rules,
 * loaded directly from the compiled OPA Rego policy (policies/governance.rego -> policies/policy.wasm).
 */
export const GOVERNANCE_RULES: readonly GovernanceRule[] = loadGovernanceRulesFromOpa();

export function evaluateGovernanceRules(
  store: ProvStore,
  rules: readonly GovernanceRule[] = GOVERNANCE_RULES,
  precomputedTraces?: RequirementTrace[]
): ProcessAnomaly[] {
  const ctx: GovernanceContext = {
    entities: store.getEntities(),
    activities: store.getActivities(),
    agents: store.getAgents(),
    relations: store.getRelations(),
    requirementTraces: precomputedTraces ?? store.getRequirementTraces(),
  };

  // Fast path: evaluate the default Rego rule catalog in a single Wasm invocation
  if (rules === GOVERNANCE_RULES) {
    const policy = getOpaPolicy();
    return unwrapOpaResult<ProcessAnomaly[]>(
      policy.evaluate(ctx, "provtrace/governance/anomalies"),
      []
    );
  }

  const anomalies: ProcessAnomaly[] = [];
  for (const rule of rules) {
    for (const finding of rule.evaluate(ctx)) {
      anomalies.push({
        ruleId: rule.id,
        severity: rule.severity,
        category: rule.category,
        nodeId: finding.nodeId,
        label: finding.label,
        detail: finding.detail,
      });
    }
  }
  return anomalies;
}
