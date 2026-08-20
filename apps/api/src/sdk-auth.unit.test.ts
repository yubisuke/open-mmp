import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sdkCanonicalString, signSdkRequest } from "./sdk-auth.js";

describe("SDK request signing", () => {
  it("binds method, path, both key identifiers, timestamp, nonce, and raw body digest", () => {
    const input = {
      method: "POST", path: "/v1/events/batch", sdkKeyId: "sdk-key-synthetic",
      installationKeyId: "installation-key-synthetic", timestampMs: 1_787_097_600_000,
      nonce: "Nonce_abcdefghijklmnopqrstu", body: Buffer.from('{"synthetic":true}', "utf8"),
    };
    const canonical = sdkCanonicalString(input);
    assert.equal(canonical.split("\n").length, 8);
    const signature = signSdkRequest("synthetic-secret-that-is-at-least-32-bytes", input);
    for (const changed of [
      { ...input, method: "PUT" }, { ...input, path: "/v1/installations" },
      { ...input, sdkKeyId: "sdk-key-other" }, { ...input, installationKeyId: "installation-key-other" },
      { ...input, timestampMs: input.timestampMs + 1 }, { ...input, nonce: `${input.nonce}x` },
      { ...input, body: Buffer.from('{"synthetic":false}', "utf8") },
    ]) assert.notEqual(signSdkRequest("synthetic-secret-that-is-at-least-32-bytes", changed), signature);
  });
});
