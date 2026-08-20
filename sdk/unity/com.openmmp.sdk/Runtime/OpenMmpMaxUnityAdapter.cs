#if OPENMMP_APPLOVIN_MAX
using UnityEngine;

namespace OpenMmp.Unity
{
    public static class OpenMmpMaxUnityAdapter
    {
        public static void Subscribe()
        {
            MaxSdkCallbacks.Interstitial.OnAdRevenuePaidEvent += OnAdRevenuePaid;
            MaxSdkCallbacks.Rewarded.OnAdRevenuePaidEvent += OnAdRevenuePaid;
            MaxSdkCallbacks.Banner.OnAdRevenuePaidEvent += OnAdRevenuePaid;
            MaxSdkCallbacks.MRec.OnAdRevenuePaidEvent += OnAdRevenuePaid;
        }

        public static void Unsubscribe()
        {
            MaxSdkCallbacks.Interstitial.OnAdRevenuePaidEvent -= OnAdRevenuePaid;
            MaxSdkCallbacks.Rewarded.OnAdRevenuePaidEvent -= OnAdRevenuePaid;
            MaxSdkCallbacks.Banner.OnAdRevenuePaidEvent -= OnAdRevenuePaid;
            MaxSdkCallbacks.MRec.OnAdRevenuePaidEvent -= OnAdRevenuePaid;
        }

        private static void OnAdRevenuePaid(string adUnitId, MaxSdk.AdInfo adInfo)
        {
#if UNITY_IOS && !UNITY_EDITOR
            OpenMmpiOSPlatform.TrackMaxRevenue(
                adInfo.Revenue,
                adInfo.RevenuePrecision,
                adInfo.NetworkName,
                adInfo.AdUnitIdentifier,
                "unknown",
                adInfo.Placement,
                adInfo.NetworkPlacement,
                _ => { });
#elif UNITY_ANDROID && !UNITY_EDITOR
            using (var bridge = new AndroidJavaClass("dev.openmmp.unity.OpenMmpUnityBridge"))
            {
                bridge.CallStatic<bool>(
                    "trackMaxRevenue",
                    adInfo.Revenue,
                    adInfo.RevenuePrecision,
                    adInfo.NetworkName,
                    adInfo.AdUnitIdentifier,
                    adInfo.Placement,
                    adInfo.NetworkPlacement);
            }
#endif
        }
    }
}
#endif
