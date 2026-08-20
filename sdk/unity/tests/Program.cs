using System;
using System.Linq;
using System.Threading;
using OpenMmp.Unity;

internal static class Program
{
    private static int Main()
    {
        var mainThread = Environment.CurrentManagedThreadId;
        var dispatcher = new OpenMmpDispatcher(20_000);
        using (var platform = new SyntheticPlatform())
        using (var client = new OpenMmpClient(platform, dispatcher))
        {
            var received = 0;
            for (var index = 0; index < 10_000; index++)
            {
                var expected = "value-" + index;
                client.PingFromBackground(expected, actual =>
                {
                    Require(actual == expected, "Unity callback value changed");
                    Require(Environment.CurrentManagedThreadId == mainThread, "Unity callback did not reach the main thread");
                    received++;
                });
            }
            platform.WaitForCallbacks();
            while (received < 10_000) client.PumpCallbacks();
            Require(received == 10_000, "Unity callback count mismatch");
            Require(dispatcher.DroppedCount == 0, "Unity dispatcher dropped callbacks");
        }
        Require(OpenMmpAndroidPlatform.ActiveAndroidObjectCount == 0, "AndroidJavaObject lease leaked");
        Require(MaxRevenueSubscriptions.Formats.SequenceEqual(new[] { "Interstitial", "Rewarded", "Banner", "MRec" }), "MAX format subscription table is incomplete");
        Console.WriteLine("Unity bridge probe passed: 10000 background callbacks, main-thread dispatch, 0 Android object leaks, 4 MAX formats.");
        return 0;
    }

    private static void Require(bool value, string message)
    {
        if (!value) throw new InvalidOperationException(message);
    }

    private sealed class SyntheticPlatform : IOpenMmpPlatform
    {
        private readonly CountdownEvent callbacks = new CountdownEvent(10_000);
        public void Initialize(OpenMmpOptions options) { }
        public void TrackCustomEvent(string eventKey) { }
        public void StartSession() { }
        public void SetCollectionEnabled(bool enabled) { }
        public void ResetInstallationId(Action<bool> completion) => completion(true);
        public void PingFromBackground(string value, Action<string> completion)
        {
            new Thread(() => { completion(value); callbacks.Signal(); }) { IsBackground = true }.Start();
        }
        public void WaitForCallbacks() => callbacks.Wait(TimeSpan.FromSeconds(30));
        public void Dispose() => callbacks.Dispose();
    }
}
