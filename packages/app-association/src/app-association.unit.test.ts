import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appleAssociationDocument, assetLinksDocument, associationBytes, validateAppLinkIdentity } from "./index.js";

const fingerprint = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, "0").toUpperCase()).join(":");

describe("M7 application association documents", () => {
  it("DL-A-06 emits strict assetlinks entries for two synthetic apps", () => {
    const value = assetLinksDocument([
      { app_id: "app-b", android_package_name: "dev.openmasu.synthetic.b", android_sha256_fingerprints: [fingerprint] },
      { app_id: "app-a", android_package_name: "dev.openmasu.synthetic.a", android_sha256_fingerprints: [fingerprint] },
    ]) as any[];
    assert.equal(value.length, 2);
    assert.deepEqual(value[0].relation, ["delegate_permission/common.handle_all_urls"]);
    assert.equal(value[0].target.namespace, "android_app");
    assert.throws(() => validateAppLinkIdentity({ app_id: "bad", android_package_name: "dev.openmasu.bad", android_sha256_fingerprints: [fingerprint.toLowerCase()] }), /fingerprint_invalid/);
  });

  it("DL-A-07 emits strict AASA components without legacy paths", () => {
    const value = appleAssociationDocument([{ app_id: "app-a", apple_team_id: "ABCDE12345", apple_bundle_id: "dev.openmasu.synthetic" }]) as any;
    assert.deepEqual(value.applinks.details[0], { appIDs: ["ABCDE12345.dev.openmasu.synthetic"], components: [{ "/": "/r/*" }] });
    assert.equal("paths" in value.applinks.details[0], false);
    assert.deepEqual(JSON.parse(associationBytes(value).toString("utf8")), value);
  });
});
