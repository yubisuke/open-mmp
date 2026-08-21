using System;
using System.Collections.Generic;
using UnityEngine;

namespace OpenMasu.Unity
{
    public interface IOpenMasuPlatform : IDisposable
    {
        void Initialize(OpenMasuOptions options);
        void TrackCustomEvent(string eventKey);
        void StartSession();
        void SetCollectionEnabled(bool enabled);
        void ResetInstallationId(Action<bool> completion);
        void PingFromBackground(string value, Action<string> completion);
        void SetDeepLinkListener(Action<string> listener);
        void HandleDeepLink(string url);
    }

    public sealed class OpenMasuDeepLink
    {
        public string Value { get; private set; }
        public string OpenSource { get; private set; }
        public string DestinationStatus { get; private set; }
        public string LinkSlug { get; private set; }
        public IReadOnlyDictionary<string, string> Parameters { get; private set; }

        internal static OpenMasuDeepLink Parse(string value)
        {
            var fields = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var pair in (value ?? string.Empty).Split('&'))
            {
                var parts = pair.Split(new[] { '=' }, 2);
                if (parts.Length == 2) fields[Uri.UnescapeDataString(parts[0])] = Uri.UnescapeDataString(parts[1]);
            }
            var parameters = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var field in fields)
                if (field.Key.StartsWith("p_", StringComparison.Ordinal)) parameters[field.Key.Substring(2)] = field.Value;
            return new OpenMasuDeepLink {
                Value = fields.TryGetValue("value", out var destination) ? destination : null,
                OpenSource = fields.TryGetValue("open_source", out var source) ? source : string.Empty,
                DestinationStatus = fields.TryGetValue("destination_status", out var status) ? status : string.Empty,
                LinkSlug = fields.TryGetValue("link_slug", out var slug) ? slug : null,
                Parameters = parameters,
            };
        }
    }

    public sealed class OpenMasuOptions
    {
        public string Endpoint { get; set; } = string.Empty;
        public string SdkKeyId { get; set; } = string.Empty;
        public string SdkSecret { get; set; } = string.Empty;
        public string WrapperVersion { get; set; } = "0.1.0";
        public string[] DeepLinkHosts { get; set; } = Array.Empty<string>();
        public string[] DeepLinkSchemes { get; set; } = Array.Empty<string>();
    }

    public sealed class OpenMasuClient : IDisposable
    {
        private readonly IOpenMasuPlatform platform;
        private readonly OpenMasuDispatcher dispatcher;
        private bool disposed;
        private bool unityDeepLinksAttached;

        public OpenMasuClient(IOpenMasuPlatform platform, OpenMasuDispatcher dispatcher)
        {
            this.platform = platform ?? throw new ArgumentNullException(nameof(platform));
            this.dispatcher = dispatcher ?? throw new ArgumentNullException(nameof(dispatcher));
        }

        public void Initialize(OpenMasuOptions options) => platform.Initialize(options);
        public void TrackCustomEvent(string eventKey) => platform.TrackCustomEvent(eventKey);
        public void StartSession() => platform.StartSession();
        public void SetCollectionEnabled(bool enabled) => platform.SetCollectionEnabled(enabled);
        public void ResetInstallationId(Action<bool> completion) =>
            platform.ResetInstallationId(value => dispatcher.Post(() => completion(value)));
        public void PingFromBackground(string value, Action<string> completion) =>
            platform.PingFromBackground(value, result => dispatcher.Post(() => completion(result)));
        public void SetDeepLinkListener(Action<OpenMasuDeepLink> listener) =>
            platform.SetDeepLinkListener(result => dispatcher.Post(() => listener(OpenMasuDeepLink.Parse(result))));
        public void HandleDeepLink(string url) => platform.HandleDeepLink(url);
        public void AttachUnityDeepLinkForwarding()
        {
            if (unityDeepLinksAttached) return;
            unityDeepLinksAttached = true;
            Application.deepLinkActivated += HandleDeepLink;
            if (!string.IsNullOrEmpty(Application.absoluteURL)) HandleDeepLink(Application.absoluteURL);
        }
        public int PumpCallbacks() => dispatcher.Pump();

        public void Dispose()
        {
            if (disposed) return;
            disposed = true;
            if (unityDeepLinksAttached) Application.deepLinkActivated -= HandleDeepLink;
            platform.Dispose();
        }
    }

    public static class MaxRevenueSubscriptions
    {
        public static readonly IReadOnlyList<string> Formats = new[] { "Interstitial", "Rewarded", "Banner", "MRec" };
    }
}
