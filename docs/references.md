# Primary References

Checked on 2026-08-11.

## Apple

- [AdAttributionKit](https://developer.apple.com/documentation/AdAttributionKit)
- [Measuring ad performance with AdAttributionKit](https://developer.apple.com/app-store/ad-attribution/)
- [SKAdNetwork](https://developer.apple.com/documentation/storekit/skadnetwork)
- [App Tracking Transparency](https://developer.apple.com/documentation/apptrackingtransparency)

Design implications:

- Use AdAttributionKit as the primary direction for Apple privacy-preserving app attribution while accounting for SKAdNetwork interoperability.
- Never present privacy-preserving aggregate results as deterministic user-level attribution.
- Distinguish tracking that requires ATT from AdAttributionKit measurement that does not require ATT by itself.
- Device fingerprinting is outside the project scope.

## Google

- [Google Play Install Referrer](https://developer.android.com/google/play/installreferrer)
- [Attribution Reporting for mobile](https://privacysandbox.google.com/private-advertising/attribution-reporting/android)
- [Attribution Reporting API integration guide](https://privacysandbox.google.com/private-advertising/attribution-reporting/android/integration-guide)
- [Advertising ID policy](https://support.google.com/googleplay/android-developer/answer/6048248)
- [Google Play User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311)

Design implications:

- Android Phase 1 uses the referrer URL and timing evidence from Install Referrer.
- Privacy Sandbox event-level and aggregatable reports remain distinct data series.
- The initial MVP does not collect Advertising ID.
- SDK providers and app developers remain responsible for identifier and user-data policy compliance.

## Media integration

- [Google Ads App Conversion Tracking API](https://developers.google.com/app-conversion-tracking/api)
- [AppLovin MAX S2S Impression Revenue API](https://developers.applovin.com/en/max/advanced-features/s2s-impression-level-api/)

These references demonstrate possible integration paths, not completed approval or production support.

## Change warning

Android Attribution Reporting documentation states that the design may change. Recheck enrollment requirements, available API versions, reporting limits, and testing procedures immediately before implementation and again before release.
