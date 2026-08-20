using System;

namespace AOT
{
    [AttributeUsage(AttributeTargets.Method)]
    public sealed class MonoPInvokeCallbackAttribute : Attribute
    {
        public MonoPInvokeCallbackAttribute(Type delegateType) { }
    }
}

namespace UnityEngine
{
    public class AndroidJavaObject : IDisposable
    {
        public void Dispose() { }
        public T Call<T>(string method, params object[] args) => default(T);
        public void Call(string method, params object[] args) { }
    }
    public class AndroidJavaClass : AndroidJavaObject
    {
        public AndroidJavaClass(string name) { }
        public T GetStatic<T>(string name) => default(T);
        public void CallStatic(string method, params object[] args) { }
    }
    public class AndroidJavaProxy
    {
        protected AndroidJavaProxy(string interfaceName) { }
    }
    public static class AndroidJNI
    {
        public static int AttachCurrentThread() => 0;
    }
}
