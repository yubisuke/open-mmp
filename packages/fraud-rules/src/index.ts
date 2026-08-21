import { createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";

export type FraudAction = "allow" | "flag" | "exclude" | "quarantine";
export type FraudRuleHit = {
  ruleId: string;
  decision: "clear" | "suspected" | "confirmed";
  action: FraudAction;
  reasonCode: "click_injection_suspected" | "referrer_time_inconsistent" | "click_flooding_suspected";
  evidenceType: "ctit_category" | "server_clock_order" | "source_day_distribution";
};

export type ClickInjectionPolicy = {
  threshold_seconds: number;
  authority: "server";
  policy_version: string;
  policy_digest: string;
};

export type InstallRuleInput = {
  installBeginAtServer?: string;
  referrerClickAtServer?: string;
  referrerClickAtServerStatus?: "available" | "missing" | "invalid";
  redirectorClickAt?: string;
  policy: ClickInjectionPolicy;
};

export type SourceDayInput = {
  clicks: number;
  installs: number;
  medianCvr: number;
  ctitP50Ms?: number;
  ctitP95Ms?: number;
};

export type FraudBundle = {
  id: string;
  version: string;
  layers: {
    base: Record<string, unknown>;
    operator?: Record<string, unknown>;
    private?: Record<string, unknown>;
  };
  rules: readonly { id: string; inputs: readonly string[]; action: FraudAction }[];
};

export function sha256Jcs(value: unknown): string {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

export function clickInjectionPolicyDigest(policy: Omit<ClickInjectionPolicy, "policy_digest">): string {
  return sha256Jcs(policy);
}

export function assertClickInjectionPolicy(policy: ClickInjectionPolicy): void {
  const expected = clickInjectionPolicyDigest({
    threshold_seconds: policy.threshold_seconds,
    authority: policy.authority,
    policy_version: policy.policy_version,
  });
  if (policy.policy_digest !== expected) throw new Error("click_injection_policy.policy_digest does not match its canonical policy fields");
}

function instant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("fraud_timestamp_invalid");
  return parsed;
}

export function evaluateInstallRules(input: InstallRuleInput): readonly FraudRuleHit[] {
  assertClickInjectionPolicy(input.policy);
  const output: FraudRuleHit[] = [];
  if (input.referrerClickAtServerStatus === "available" && input.referrerClickAtServer && input.installBeginAtServer) {
    if (instant(input.referrerClickAtServer) >= instant(input.installBeginAtServer) + 1_000) {
      output.push({
        ruleId: "referrer-server-order-v1",
        decision: "confirmed",
        action: "flag",
        reasonCode: "referrer_time_inconsistent",
        evidenceType: "server_clock_order",
      });
    }
  }
  if (input.redirectorClickAt && input.installBeginAtServer) {
    const delta = instant(input.installBeginAtServer) - instant(input.redirectorClickAt);
    if (delta < 0) return output;
    if (delta < input.policy.threshold_seconds * 1_000) {
      output.push({
        ruleId: "ctit-lower-bound-v1",
        decision: "suspected",
        action: "flag",
        reasonCode: "click_injection_suspected",
        evidenceType: "ctit_category",
      });
    }
    if (input.referrerClickAtServer && Math.abs(instant(input.referrerClickAtServer) - instant(input.redirectorClickAt)) > 300_000) {
      output.push({
        ruleId: "referrer-redirector-divergence-v1",
        decision: "suspected",
        action: "flag",
        reasonCode: "referrer_time_inconsistent",
        evidenceType: "server_clock_order",
      });
    }
  }
  return output;
}

export function evaluateSourceDay(input: SourceDayInput): FraudRuleHit | undefined {
  if (input.clicks < 1_000 || input.installs / input.clicks > input.medianCvr * 0.2 ||
      input.ctitP50Ms === undefined || input.ctitP50Ms < 86_400_000 ||
      input.ctitP95Ms === undefined || input.ctitP95Ms / input.ctitP50Ms > 3) return undefined;
  return {
    ruleId: "source-day-click-flooding-v1",
    decision: "suspected",
    action: "flag",
    reasonCode: "click_flooding_suspected",
    evidenceType: "source_day_distribution",
  };
}

export function assertFraudBundle(bundle: FraudBundle): void {
  for (const rule of bundle.rules) {
    if (rule.inputs.length > 0 && rule.inputs.every((input) => input === "integrity_verdict")) {
      throw new Error(`integrity_only_rule_forbidden:${rule.id}`);
    }
  }
}

export function fraudBundleHash(bundle: FraudBundle): string {
  assertFraudBundle(bundle);
  return sha256Jcs({ id: bundle.id, version: bundle.version, layers: bundle.layers, rules: bundle.rules });
}

export function publicBundleProvenance(bundle: FraudBundle): {
  id: string; version: string; hash: string; private_layer_digest?: string;
} {
  return {
    id: bundle.id,
    version: bundle.version,
    hash: fraudBundleHash(bundle),
    ...(bundle.layers.private ? { private_layer_digest: sha256Jcs(bundle.layers.private) } : {}),
  };
}
