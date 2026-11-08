// Live updates (new messages, who's in voice, who's talking) over Socket.IO, written by hand
// so no extra Unity packages are needed. Speaks Engine.IO v4 over a plain WebSocket.
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;

namespace OrbitVR
{
    public class OrbitSocket : MonoBehaviour
    {
        public event Action<string, object> OnEvent;     // (event name, data)
        public event Action<bool> OnConnectionChanged;
        public bool Connected { get; private set; }

        ClientWebSocket ws;
        CancellationTokenSource cts;
        readonly ConcurrentQueue<Action> mainThread = new ConcurrentQueue<Action>();
        bool wantOpen;
        float retryAt;
        int retries;

        public void Open()
        {
            wantOpen = true;
            _ = Run();
        }

        public void Close()
        {
            wantOpen = false;
            try { cts?.Cancel(); } catch { }
            try { ws?.Abort(); } catch { }
            ws = null;
            SetConnected(false);
        }

        void OnDestroy() => Close();

        void Update()
        {
            while (mainThread.TryDequeue(out var a)) { try { a(); } catch (Exception e) { Debug.LogException(e); } }
            // reconnect with a growing delay if we dropped
            if (wantOpen && ws == null && retryAt > 0 && Time.unscaledTime > retryAt) { retryAt = 0; _ = Run(); }
        }

        void SetConnected(bool on)
        {
            if (Connected == on) return;
            Connected = on;
            mainThread.Enqueue(() => OnConnectionChanged?.Invoke(on));
        }

        void ScheduleRetry()
        {
            ws = null;
            SetConnected(false);
            if (!wantOpen) return;
            retries++;
            float delay = Mathf.Min(30f, 1.5f * retries);
            mainThread.Enqueue(() => retryAt = Time.unscaledTime + delay);
        }

        async Task Run()
        {
            cts = new CancellationTokenSource();
            var sock = new ClientWebSocket();
            ws = sock;
            var url = OrbitApi.BaseUrl.TrimEnd('/').Replace("https://", "wss://").Replace("http://", "ws://") + "/socket.io/?EIO=4&transport=websocket";
            try
            {
                await sock.ConnectAsync(new Uri(url), cts.Token);
                var buf = new byte[64 * 1024];
                var sb = new StringBuilder();
                while (sock.State == WebSocketState.Open)
                {
                    sb.Clear();
                    WebSocketReceiveResult r;
                    do
                    {
                        r = await sock.ReceiveAsync(new ArraySegment<byte>(buf), cts.Token);
                        if (r.MessageType == WebSocketMessageType.Close) throw new Exception("closed");
                        sb.Append(Encoding.UTF8.GetString(buf, 0, r.Count));
                    } while (!r.EndOfMessage);
                    await Handle(sock, sb.ToString());
                }
            }
            catch (Exception e)
            {
                if (wantOpen) Debug.Log("[Orbit] live connection dropped: " + e.Message);
            }
            if (ws == sock) ScheduleRetry();
        }

        async Task Handle(ClientWebSocket sock, string pkt)
        {
            if (pkt.Length == 0) return;
            switch (pkt[0])
            {
                case '0': // engine.io open -> socket.io connect with our login
                    var auth = new Dictionary<string, object> { ["token"] = OrbitApi.Token, ["platform"] = "vr", ["status"] = "online" };
                    await Send(sock, "40" + Json.Write(auth));
                    break;
                case '2': // ping
                    await Send(sock, "3");
                    break;
                case '4':
                    if (pkt.StartsWith("40")) { retries = 0; SetConnected(true); }
                    else if (pkt.StartsWith("44")) { Debug.LogWarning("[Orbit] live connection refused: " + pkt); wantOpen = false; }
                    else if (pkt.StartsWith("42"))
                    {
                        // 42["event", data]
                        var arr = Json.Parse(pkt.Substring(2)) as List<object>;
                        if (arr != null && arr.Count > 0)
                        {
                            var name = arr[0] as string; var data = arr.Count > 1 ? arr[1] : null;
                            mainThread.Enqueue(() => OnEvent?.Invoke(name, data));
                        }
                    }
                    break;
            }
        }

        static readonly SemaphoreSlim sendLock = new SemaphoreSlim(1, 1);
        static async Task Send(ClientWebSocket sock, string text)
        {
            await sendLock.WaitAsync();
            try { await sock.SendAsync(new ArraySegment<byte>(Encoding.UTF8.GetBytes(text)), WebSocketMessageType.Text, true, CancellationToken.None); }
            finally { sendLock.Release(); }
        }

        /// Send an event to the server, e.g. Emit("presence", "idle").
        public void Emit(string name, object data)
        {
            var s = ws; if (s == null || !Connected) return;
            _ = Send(s, "42" + Json.Write(new List<object> { name, data }));
        }
    }
}
