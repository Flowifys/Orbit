// Talks to Orbit's server: the same HTTP API the website uses.
using System;
using System.Collections.Generic;
using System.Runtime.CompilerServices;
using System.Text;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Networking;

namespace OrbitVR
{
    public class OrbitError : Exception { public long Status; public OrbitError(string m, long s) : base(m) { Status = s; } }

    public static class OrbitApi
    {
        public static string BaseUrl = "https://orbital.sbs";
        public static string Token = "";

        public static string Abs(string url) => string.IsNullOrEmpty(url) ? "" : url.StartsWith("http") ? url : BaseUrl.TrimEnd('/') + url;

        public static async Task<object> Call(string method, string path, object body = null)
        {
            using var req = new UnityWebRequest(BaseUrl.TrimEnd('/') + path, method);
            req.downloadHandler = new DownloadHandlerBuffer();
            if (body != null)
            {
                req.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(Json.Write(body)));
                req.SetRequestHeader("Content-Type", "application/json");
            }
            if (!string.IsNullOrEmpty(Token)) req.SetRequestHeader("Authorization", "Bearer " + Token);
            req.timeout = 20;
            await req.SendWebRequest();
            var text = req.downloadHandler.text;
            object data = null;
            try { data = Json.Parse(text); } catch { }
            if (req.result != UnityWebRequest.Result.Success || req.responseCode >= 400)
            {
                var msg = J.S(data, "error");
                if (string.IsNullOrEmpty(msg)) msg = req.responseCode == 0 ? "Can't reach Orbit. Check your internet." : "Something went wrong (" + req.responseCode + ")";
                throw new OrbitError(msg, req.responseCode);
            }
            return data;
        }

        public static Task<object> Get(string path) => Call("GET", path);
        public static Task<object> Post(string path, object body) => Call("POST", path, body ?? new Dictionary<string, object>());

        // ---- pictures (avatars, server icons). PNG/JPG only; anything else returns null and we draw initials instead.
        static readonly Dictionary<string, Texture2D> texCache = new Dictionary<string, Texture2D>();
        public static async Task<Texture2D> Image(string url)
        {
            if (string.IsNullOrEmpty(url)) return null;
            url = Abs(url);
            if (texCache.TryGetValue(url, out var hit)) return hit;
            using var req = UnityWebRequestTexture.GetTexture(url);
            await req.SendWebRequest();
            Texture2D t = null;
            if (req.result == UnityWebRequest.Result.Success) { try { t = DownloadHandlerTexture.GetContent(req); } catch { t = null; } }
            texCache[url] = t;
            return t;
        }
    }

    // lets us write "await request.SendWebRequest()"
    public static class UnityWebRequestAwaiter
    {
        public static TaskAwaiter<UnityWebRequest.Result> GetAwaiter(this UnityWebRequestAsyncOperation op)
        {
            var tcs = new TaskCompletionSource<UnityWebRequest.Result>();
            if (op.isDone) tcs.SetResult(op.webRequest.result);
            else op.completed += _ => tcs.TrySetResult(op.webRequest.result);
            return tcs.Task.GetAwaiter();
        }
    }
}
