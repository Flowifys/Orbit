// Orbit VR — put this (OrbitApp) on an empty GameObject in a scene that has a VR rig (XR Origin).
// It builds the purple void and Orbit's floating panels when you press Play.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading.Tasks;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace OrbitVR
{
    public class OrbitApp : MonoBehaviour
    {
        [Tooltip("Your Orbit server.")]
        public string serverUrl = "https://orbital.sbs";
        [Tooltip("How far the main chat panel floats in front of you, in metres.")]
        public float panelDistance = 1.45f;

        // ---------- state ----------
        Transform space;
        OrbitSocket sock;
        VoiceOrbs orbs;
        object me;
        List<object> servers = new List<object>(), dms = new List<object>();
        readonly Dictionary<string, object> users = new Dictionary<string, object>();
        readonly Dictionary<string, object> serverData = new Dictionary<string, object>();
        readonly Dictionary<string, List<string>> voice = new Dictionary<string, List<string>>();
        readonly HashSet<string> speaking = new HashSet<string>();
        readonly HashSet<string> unread = new HashSet<string>();
        string currentServer = "@me", currentChannel, watchingVoice;
        string MyId => J.S(me, "id");

        // ---------- panels ----------
        RectTransform loginCanvas, navCanvas, chatCanvas, sideCanvas;
        RectTransform serverStrip, navList, msgList, peopleList;
        ScrollRect msgScroll;
        TextMeshProUGUI navTitle, chatTitle, chatSub, connText;
        TextField composer;

        async void Start()
        {
            OrbitApi.BaseUrl = serverUrl;
            OrbitApi.Token = PlayerPrefs.GetString("orbit-token", "");
            EnsureEventSystem();
            await Task.Delay(600);   // give the headset a moment to report where your head is
            space = new GameObject("Orbit Space").transform;
            PlaceInFrontOfYou();
            VoidWorld.Build(space, FloorY());
            VRKeyboard.Build(space, new Vector3(0, -0.5f, 0.85f));
            sock = gameObject.AddComponent<OrbitSocket>();
            sock.OnEvent += OnSocketEvent;
            sock.OnConnectionChanged += on => { if (connText) connText.text = on ? "" : "Reconnecting…"; if (on) Refresh().ContinueWith(t => { if (t.Exception != null) Debug.LogWarning(t.Exception.InnerException?.Message); }); };
            orbs = new VoiceOrbs(space);
            if (string.IsNullOrEmpty(OrbitApi.Token)) ShowLogin();
            else await Boot();
        }

        void PlaceInFrontOfYou()
        {
            var cam = Camera.main;
            if (!cam || !space) return;
            var f = cam.transform.forward; f.y = 0;
            if (f.sqrMagnitude < 0.01f) f = Vector3.forward;
            space.SetPositionAndRotation(cam.transform.position, Quaternion.LookRotation(f.normalized));
        }

        float FloorY()
        {
            var origin = FindObjectsByType<Transform>(FindObjectsSortMode.None).FirstOrDefault(t => t.name.StartsWith("XR Origin"));
            if (origin) return origin.position.y;
            var cam = Camera.main;
            return cam ? cam.transform.position.y - 1.6f : 0;
        }

        static void EnsureEventSystem()
        {
            if (FindFirstObjectByType<EventSystem>()) return;
            var go = new GameObject("EventSystem", typeof(EventSystem));
            // the VR template's input module if it's installed, otherwise the new Input System one, otherwise the old one
            var t = Type.GetType("UnityEngine.XR.Interaction.Toolkit.UI.XRUIInputModule, Unity.XR.Interaction.Toolkit")
                 ?? Type.GetType("UnityEngine.InputSystem.UI.InputSystemUIInputModule, Unity.InputSystem");
            if (t != null) go.AddComponent(t); else go.AddComponent<StandaloneInputModule>();
        }

        // =====================================================================
        // Sign in
        // =====================================================================
        void ShowLogin(string error = null)
        {
            if (navCanvas) { Destroy(navCanvas.gameObject); Destroy(chatCanvas.gameObject); Destroy(sideCanvas.gameObject); navCanvas = null; }
            if (loginCanvas) Destroy(loginCanvas.gameObject);
            orbs?.Show(new List<string>(), this);
            loginCanvas = UIKit.WorldCanvas("Orbit Sign In", space, new Vector2(660, 720), new Vector3(0, 0.02f, panelDistance - 0.1f), 0);
            var card = UIKit.Box(loginCanvas, Pal.Panel, "Card"); UIKit.Fill(card.rectTransform);
            var col = UIKit.VList(card, 18, 44); col.padding = new RectOffset(48, 48, 50, 40);

            var title = UIKit.Text(card.transform, "Orbit", 64, Pal.Text, FontStyles.Bold, TextAlignmentOptions.Center); UIKit.Size(title, -1, 80);
            var sub = UIKit.Text(card.transform, "Sign in to float into your chats.", 28, Pal.Muted, FontStyles.Normal, TextAlignmentOptions.Center); UIKit.Size(sub, -1, 44);
            var who = TextField.Make(card.transform, "Email or username");
            var pass = TextField.Make(card.transform, "Password", true);
            var err = UIKit.Text(card.transform, error ?? "", 24, Pal.Red, FontStyles.Normal, TextAlignmentOptions.Center); UIKit.Size(err, -1, 60);
            Button go = null;
            async void Submit()
            {
                if (string.IsNullOrWhiteSpace(who.Value) || string.IsNullOrEmpty(pass.Value)) { err.text = "Enter your email or username and password."; return; }
                go.interactable = false; err.color = Pal.Muted; err.text = "Signing in…";
                try
                {
                    var r = await OrbitApi.Post("/api/auth/login", new Dictionary<string, object> { ["email"] = who.Value.Trim(), ["password"] = pass.Value });
                    if (J.B(r, "twofa")) { AskCode(J.S(r, "ticket"), J.S(r, "to")); return; }
                    if (J.B(r, "needs_verification")) { err.color = Pal.Red; err.text = "Verify your email on orbital.sbs first, then sign in here."; go.interactable = true; return; }
                    await SignedIn(J.S(r, "token"));
                }
                catch (Exception e) { err.color = Pal.Red; err.text = e.Message; if (go) go.interactable = true; }
            }
            go = UIKit.Button(card.transform, "Sign in", Submit, Pal.Accent, Color.white, 30, 76);
            pass.OnSubmit = Submit; who.OnSubmit = () => VRKeyboard.Instance.Focus(pass);
            var note = UIKit.Text(card.transform, "No account yet? Make one at orbital.sbs", 22, Pal.Dim, FontStyles.Normal, TextAlignmentOptions.Center); UIKit.Size(note, -1, 40);
            VRKeyboard.Instance.Focus(who);
        }

        void AskCode(string ticket, string to)
        {
            UIKit.Clear(loginCanvas.GetChild(0));
            var card = loginCanvas.GetChild(0);
            var title = UIKit.Text(card, "Two-step sign in", 44, Pal.Text, FontStyles.Bold, TextAlignmentOptions.Center); UIKit.Size(title, -1, 70);
            var sub = UIKit.Text(card, "We sent a 6-digit code to " + to + ".", 26, Pal.Muted, FontStyles.Normal, TextAlignmentOptions.Center); UIKit.Size(sub, -1, 70);
            var code = TextField.Make(card, "Code");
            code.MaxLength = 12;
            var err = UIKit.Text(card, "", 24, Pal.Red, FontStyles.Normal, TextAlignmentOptions.Center); UIKit.Size(err, -1, 60);
            async void Submit()
            {
                try { var r = await OrbitApi.Post("/api/auth/2fa", new Dictionary<string, object> { ["ticket"] = ticket, ["code"] = code.Value.Trim() }); await SignedIn(J.S(r, "token")); }
                catch (Exception e) { err.text = e.Message; }
            }
            UIKit.Button(card, "Continue", Submit, Pal.Accent, Color.white, 30, 76);
            UIKit.Button(card, "Back", () => ShowLogin(), Pal.Card2, Pal.Text, 26, 64);
            code.OnSubmit = Submit;
            VRKeyboard.Instance.Focus(code);
        }

        async Task SignedIn(string token)
        {
            OrbitApi.Token = token;
            PlayerPrefs.SetString("orbit-token", token); PlayerPrefs.Save();
            VRKeyboard.Instance.Hide();
            await Boot();
        }

        void SignOut()
        {
            _ = OrbitApi.Post("/api/logout", null);
            OrbitApi.Token = ""; PlayerPrefs.DeleteKey("orbit-token");
            sock.Close();
            ShowLogin();
        }

        // =====================================================================
        // Main view
        // =====================================================================
        async Task Boot()
        {
            try { await Refresh(); }
            catch (OrbitError e) when (e.Status == 401) { OrbitApi.Token = ""; PlayerPrefs.DeleteKey("orbit-token"); ShowLogin("You were signed out. Sign in again."); return; }
            catch (Exception e) { ShowLogin(e.Message); return; }
            if (loginCanvas) { Destroy(loginCanvas.gameObject); loginCanvas = null; }
            BuildPanels();
            sock.Open();
            OpenServer("@me");
        }

        async Task Refresh()
        {
            var r = await OrbitApi.Get("/api/me");
            var upgrade = J.S(r, "session_token");
            if (!string.IsNullOrEmpty(upgrade)) { OrbitApi.Token = upgrade; PlayerPrefs.SetString("orbit-token", upgrade); }
            me = J.G(r, "me");
            servers = J.A(J.G(r, "servers"));
            dms = J.A(J.G(r, "dms"));
            users[MyId] = me;
            foreach (var d in dms) { var u = J.G(d, "user"); if (u != null) users[J.S(u, "id")] = u; foreach (var m in J.A(J.G(d, "members"))) users[J.S(m, "id")] = m; }
            voice.Clear();
            if (J.G(r, "voice") is Dictionary<string, object> v) foreach (var kv in v) voice[kv.Key] = J.A(kv.Value).Select(x => J.S(x, "user_id")).ToList();
            if (navCanvas) { DrawServerStrip(); DrawNav(); DrawPeople(); }
        }

        void BuildPanels()
        {
            // left: servers + channels
            navCanvas = UIKit.WorldCanvas("Orbit Nav", space, new Vector2(460, 760), new Vector3(-0.98f, 0, panelDistance - 0.38f), -40);
            var nav = UIKit.Box(navCanvas, Pal.Panel, "Card"); UIKit.Fill(nav.rectTransform);
            var navCol = UIKit.VList(nav, 10); navCol.padding = new RectOffset(18, 18, 18, 18);
            serverStrip = UIKit.Rect("Servers", nav.transform);
            var grid = serverStrip.gameObject.AddComponent<GridLayoutGroup>(); grid.cellSize = new Vector2(64, 64); grid.spacing = new Vector2(10, 10);
            navTitle = UIKit.Text(nav.transform, "", 30, Pal.Text, FontStyles.Bold); UIKit.Size(navTitle, -1, 46);
            navList = UIKit.Scroll(nav.transform, out _, 2); UIKit.Size(navList.parent.GetComponent<Image>(), -1, -1, 1, 1);
            var bottom = UIKit.Rect("Bottom", nav.transform); UIKit.HList(bottom, 10); UIKit.Size(bottom, -1, 60);
            var rc = UIKit.Button(bottom, "Recenter", PlaceInFrontOfYou, Pal.Card2, Pal.Text, 22, 56); UIKit.Size(rc.GetComponent<Image>(), -1, 56, 1);
            var so = UIKit.Button(bottom, "Sign out", SignOut, Pal.Card2, Pal.Muted, 22, 56); UIKit.Size(so.GetComponent<Image>(), -1, 56, 1);

            // middle: messages
            chatCanvas = UIKit.WorldCanvas("Orbit Chat", space, new Vector2(1060, 760), new Vector3(0, 0, panelDistance), 0);
            var chat = UIKit.Box(chatCanvas, Pal.Panel, "Card"); UIKit.Fill(chat.rectTransform);
            var chatCol = UIKit.VList(chat, 8); chatCol.padding = new RectOffset(24, 24, 18, 20);
            var head = UIKit.Rect("Head", chat.transform); UIKit.HList(head, 12); UIKit.Size(head, -1, 54);
            chatTitle = UIKit.Text(head, "", 34, Pal.Text, FontStyles.Bold, TextAlignmentOptions.MidlineLeft); UIKit.Size(chatTitle, -1, 54, 1);
            chatSub = UIKit.Text(head, "", 22, Pal.Muted, FontStyles.Normal, TextAlignmentOptions.MidlineRight); UIKit.Size(chatSub, 300, 54);
            connText = UIKit.Text(chat.transform, "", 20, Pal.Muted); UIKit.Size(connText, -1, 4);
            msgList = UIKit.Scroll(chat.transform, out msgScroll, 6); UIKit.Size(msgList.parent.GetComponent<Image>(), -1, -1, 1, 1);
            var send = UIKit.Rect("Composer", chat.transform); UIKit.HList(send, 10); UIKit.Size(send, -1, 72);
            composer = TextField.Make(send, "Message", false, 72); UIKit.Size(composer.Back, -1, 72, 1);
            composer.OnSubmit = SendMessage;
            var sb = UIKit.Button(send, "Send", SendMessage, Pal.Accent, Color.white, 26, 72); UIKit.Size(sb.GetComponent<Image>(), 130, 72);

            // right: voice + who's here
            sideCanvas = UIKit.WorldCanvas("Orbit People", space, new Vector2(460, 760), new Vector3(0.98f, 0, panelDistance - 0.38f), 40);
            var side = UIKit.Box(sideCanvas, Pal.Panel, "Card"); UIKit.Fill(side.rectTransform);
            var sideCol = UIKit.VList(side, 10); sideCol.padding = new RectOffset(18, 18, 18, 18);
            var st = UIKit.Text(side.transform, "Voice", 30, Pal.Text, FontStyles.Bold); UIKit.Size(st, -1, 46);
            peopleList = UIKit.Scroll(side.transform, out _, 4); UIKit.Size(peopleList.parent.GetComponent<Image>(), -1, -1, 1, 1);
            var hint = UIKit.Text(side.transform, "Pick a voice channel to see who's hanging out around you. Talking in VR comes next.", 20, Pal.Dim); UIKit.Size(hint, -1, 64);

            DrawServerStrip();
        }

        void DrawServerStrip()
        {
            UIKit.Clear(serverStrip);
            ServerButton("@me", "Home", null, "H");
            foreach (var s in servers) ServerButton(J.S(s, "id"), J.S(s, "name"), J.S(s, "icon"), null);
        }

        void ServerButton(string id, string name, string icon, string letter)
        {
            var b = UIKit.Button(serverStrip, "", () => OpenServer(id), currentServer == id ? Pal.Accent : Pal.Card2, Pal.Text, 22, 64);
            var initials = letter ?? string.Concat(name.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries).Take(2).Select(w => char.ToUpperInvariant(w[0])));
            var t = UIKit.Text(b.transform, initials, 22, Color.white, FontStyles.Bold, TextAlignmentOptions.Center); UIKit.Fill(t.rectTransform);
            if (!string.IsNullOrEmpty(icon)) { var av = UIKit.Avatar(b.transform, id, name, icon, 64); UIKit.Fill(av); av.GetComponentInChildren<TextMeshProUGUI>().text = initials; }
        }

        async void OpenServer(string id)
        {
            currentServer = id;
            DrawServerStrip();
            if (id != "@me" && !serverData.ContainsKey(id))
            {
                try { var d = await OrbitApi.Get("/api/servers/" + id); serverData[id] = d; foreach (var m in J.A(J.G(d, "members"))) users[J.S(m, "id")] = m; }
                catch (Exception e) { chatTitle.text = "Couldn't open that server"; chatSub.text = e.Message; return; }
            }
            DrawNav();
            DrawPeople();
            // open the first text channel (or the newest DM)
            var first = id == "@me" ? dms.Select(d => J.S(d, "id")).FirstOrDefault()
                : Channels(id).Where(c => J.S(c, "type") == "text").Select(c => J.S(c, "id")).FirstOrDefault();
            if (first != null) OpenChannel(first); else { currentChannel = null; UIKit.Clear(msgList); chatTitle.text = id == "@me" ? "No messages yet" : "No text channels"; chatSub.text = ""; }
        }

        List<object> Channels(string sid) => J.A(J.G(serverData.TryGetValue(sid, out var d) ? d : null, "channels"));

        void DrawNav()
        {
            UIKit.Clear(navList);
            if (currentServer == "@me")
            {
                navTitle.text = "Direct Messages";
                foreach (var d in dms)
                {
                    var id = J.S(d, "id"); var group = J.S(d, "type") == "group";
                    var u = J.G(d, "user");
                    var name = group ? J.S(d, "name") : J.S(u, "display_name");
                    var row = UIKit.Row(navList, () => OpenChannel(id), 70);
                    UIKit.Avatar(row.transform, group ? id : J.S(u, "id"), name, group ? J.S(d, "icon") : J.S(u, "avatar"), 46);
                    var t = UIKit.Text(row.transform, name, 26, unread.Contains(id) || id == currentChannel ? Pal.Text : Pal.Muted, unread.Contains(id) ? FontStyles.Bold : FontStyles.Normal, TextAlignmentOptions.MidlineLeft);
                    UIKit.Size(t, -1, 46, 1);
                    if (id == currentChannel) row.GetComponent<Image>().color = Pal.AccentSoft;
                }
                if (dms.Count == 0) { var e = UIKit.Text(navList, "No DMs yet. Add friends on orbital.sbs.", 22, Pal.Dim); UIKit.Size(e, -1, 80); }
                return;
            }
            var server = servers.FirstOrDefault(s => J.S(s, "id") == currentServer);
            navTitle.text = J.S(server, "name");
            var chans = Channels(currentServer);
            var cats = chans.Where(c => J.S(c, "type") == "category").ToList();
            void Rows(IEnumerable<object> list)
            {
                foreach (var c in list)
                {
                    var type = J.S(c, "type"); var id = J.S(c, "id");
                    if (type != "text" && type != "voice") continue;
                    var row = UIKit.Row(navList, () => { if (type == "voice") WatchVoice(id); else OpenChannel(id); }, 58);
                    var label = (type == "voice" ? "♪  " : "#  ") + J.S(c, "name");
                    var inVoice = type == "voice" && voice.TryGetValue(id, out var vl) && vl.Count > 0 ? "  · " + vl.Count : "";
                    var t = UIKit.Text(row.transform, label + inVoice, 25, id == currentChannel || id == watchingVoice ? Pal.Text : unread.Contains(id) ? Pal.Text : Pal.Muted,
                        unread.Contains(id) ? FontStyles.Bold : FontStyles.Normal, TextAlignmentOptions.MidlineLeft);
                    t.richText = false; UIKit.Size(t, -1, 40, 1);
                    if (id == currentChannel || id == watchingVoice) row.GetComponent<Image>().color = Pal.AccentSoft;
                }
            }
            Rows(chans.Where(c => string.IsNullOrEmpty(J.S(c, "parent_id")) && J.S(c, "type") != "category"));
            foreach (var cat in cats)
            {
                var h = UIKit.Text(navList, J.S(cat, "name").ToUpperInvariant(), 19, Pal.Dim, FontStyles.Bold); UIKit.Size(h, -1, 40);
                h.margin = new Vector4(10, 14, 0, 0);
                Rows(chans.Where(c => J.S(c, "parent_id") == J.S(cat, "id")));
            }
        }

        // ---------- messages ----------
        async void OpenChannel(string id)
        {
            currentChannel = id;
            unread.Remove(id);
            DrawNav();
            UIKit.Clear(msgList);
            chatTitle.text = ChannelName(id); chatSub.text = "Loading…";
            List<object> msgs;
            try { msgs = J.A(await OrbitApi.Get("/api/channels/" + id + "/messages?limit=50")); }
            catch (Exception e) { chatSub.text = e.Message; return; }
            if (currentChannel != id) return;
            chatSub.text = "";
            foreach (var m in msgs) await AddMessage(m, false);
            ScrollToBottom();
        }

        string ChannelName(string id)
        {
            var dm = dms.FirstOrDefault(d => J.S(d, "id") == id);
            if (dm != null) return J.S(dm, "type") == "group" ? J.S(dm, "name") : "@" + J.S(J.G(dm, "user"), "display_name");
            foreach (var kv in serverData) { var c = J.A(J.G(kv.Value, "channels")).FirstOrDefault(x => J.S(x, "id") == id); if (c != null) return "#" + J.S(c, "name"); }
            return "Chat";
        }

        async Task<object> UserById(string id)
        {
            if (users.TryGetValue(id, out var u)) return u;
            try { u = await OrbitApi.Get("/api/users/" + id); users[id] = u; return u; } catch { return null; }
        }

        async Task AddMessage(object m, bool live)
        {
            bool atBottom = msgScroll.verticalNormalizedPosition < 0.05f || msgList.rect.height < ((RectTransform)msgScroll.transform).rect.height;
            var authorId = J.S(m, "author_id");
            var u = await UserById(authorId);
            var name = u != null ? J.S(u, "display_name") : "Someone";
            var row = UIKit.Rect("Message", msgList);
            var h = UIKit.HList(row, 16); h.childAlignment = TextAnchor.UpperLeft; h.padding = new RectOffset(8, 8, 8, 8);
            row.name = "Message " + J.S(m, "id");
            if (J.B(m, "system"))
            {
                var st = UIKit.Text(row, "→  " + J.S(m, "content"), 23, Pal.Muted); st.richText = false; UIKit.Size(st, -1, -1, 1);
            }
            else
            {
                UIKit.Avatar(row, authorId, name, J.S(u, "avatar"), 52);
                var body = UIKit.Rect("Body", row); UIKit.VList(body, 4); UIKit.Size(body, -1, -1, 1);
                var when = DateTimeOffset.FromUnixTimeMilliseconds((long)J.N(m, "created")).ToLocalTime();
                var meta = UIKit.Text(body, "<b>" + Esc(name) + "</b>   <color=#6e6884><size=19>" + when.ToString("h:mm tt", CultureInfo.InvariantCulture) + "</size></color>", 24, authorId == MyId ? Pal.Hex("#c9b8ff") : Pal.Text);
                UIKit.Size(meta, -1, 32);
                var text = J.S(m, "content");
                var atts = J.A(J.G(m, "attachments"));
                if (atts.Count > 0) text += (text.Length > 0 ? "\n" : "") + string.Join("\n", atts.Select(a => "[" + (J.S(a, "type").StartsWith("image") ? "picture" : J.S(a, "voice") == "True" ? "voice message" : "file") + ": " + J.S(a, "name") + "]"));
                if (J.G(m, "poll") != null) text += (text.Length > 0 ? "\n" : "") + "[poll: " + J.S(J.G(m, "poll"), "question") + "]";
                if (J.G(m, "sticker") != null) text += "[sticker]";
                if (text.Length > 0) { var t = UIKit.Text(body, text, 26, Pal.Text); t.richText = false; t.overflowMode = TextOverflowModes.Overflow; }
            }
            // keep the list light: the last 120 messages
            while (msgList.childCount > 120) DestroyImmediate(msgList.GetChild(0).gameObject);
            if (live && atBottom) ScrollToBottom();
        }

        static string Esc(string s) => (s ?? "").Replace("<", "‹").Replace(">", "›");

        async void ScrollToBottom()
        {
            await Task.Yield();
            if (!msgScroll) return;
            Canvas.ForceUpdateCanvases();
            LayoutRebuilder.ForceRebuildLayoutImmediate(msgList);
            msgScroll.verticalNormalizedPosition = 0;
        }

        async void SendMessage()
        {
            var text = composer.Value.Trim();
            if (text.Length == 0 || currentChannel == null) return;
            var cid = currentChannel;
            composer.Set("");
            try { await OrbitApi.Post("/api/channels/" + cid + "/messages", new Dictionary<string, object> { ["content"] = text }); }
            catch (Exception e) { composer.Set(text); chatSub.text = e.Message; }
        }

        // ---------- voice ----------
        void WatchVoice(string cid)
        {
            watchingVoice = watchingVoice == cid ? null : cid;
            DrawNav(); DrawPeople();
        }

        void DrawPeople()
        {
            if (!peopleList) return;
            UIKit.Clear(peopleList);
            var chans = currentServer == "@me" ? new List<object>() : Channels(currentServer).Where(c => J.S(c, "type") == "voice").ToList();
            if (chans.Count == 0) { var e = UIKit.Text(peopleList, currentServer == "@me" ? "Open a server to see its voice channels." : "This server has no voice channels.", 22, Pal.Dim); UIKit.Size(e, -1, 80); }
            foreach (var c in chans)
            {
                var id = J.S(c, "id");
                var row = UIKit.Row(peopleList, () => WatchVoice(id), 56);
                var t = UIKit.Text(row.transform, "♪  " + J.S(c, "name"), 25, id == watchingVoice ? Pal.Text : Pal.Muted, FontStyles.Bold, TextAlignmentOptions.MidlineLeft);
                t.richText = false; UIKit.Size(t, -1, 40, 1);
                if (id == watchingVoice) row.GetComponent<Image>().color = Pal.AccentSoft;
                if (!voice.TryGetValue(id, out var list)) continue;
                foreach (var uid in list)
                {
                    users.TryGetValue(uid, out var u);
                    var pr = UIKit.Rect("Person", peopleList); UIKit.HList(pr, 12).padding = new RectOffset(34, 8, 2, 2); UIKit.Size(pr, -1, 50);
                    var av = UIKit.Avatar(pr, uid, J.S(u, "display_name"), J.S(u, "avatar"), 40);
                    if (speaking.Contains(uid)) { var ring = av.gameObject.AddComponent<Outline>(); ring.effectColor = Pal.Green; ring.effectDistance = new Vector2(3, -3); }
                    var nt = UIKit.Text(pr, J.S(u, "display_name"), 23, speaking.Contains(uid) ? Pal.Green : Pal.Text, FontStyles.Normal, TextAlignmentOptions.MidlineLeft);
                    nt.richText = false; UIKit.Size(nt, -1, 40, 1);
                }
            }
            orbs.Show(watchingVoice != null && voice.TryGetValue(watchingVoice, out var w) ? w : new List<string>(), this);
        }

        public object UserInfo(string id) => users.TryGetValue(id, out var u) ? u : null;
        public bool IsSpeaking(string id) => speaking.Contains(id);

        // ---------- live updates ----------
        void OnSocketEvent(string name, object data)
        {
            switch (name)
            {
                case "message:new":
                    var cid = J.S(data, "channel_id");
                    if (!string.IsNullOrEmpty(J.S(data, "thread_id"))) break;
                    if (cid == currentChannel) _ = AddMessage(data, true);
                    else if (J.S(data, "author_id") != MyId) { unread.Add(cid); DrawNav(); }
                    break;
                case "message:update":
                case "message:delete":
                    if (J.S(data, "channel_id") == currentChannel) OpenChannel(currentChannel);
                    break;
                case "voice:state":
                    voice[J.S(data, "channel_id")] = J.A(J.G(data, "users")).Select(x => J.S(x, "user_id")).ToList();
                    foreach (var uid in voice[J.S(data, "channel_id")]) if (!users.ContainsKey(uid)) _ = UserById(uid);
                    DrawPeople(); DrawNav();
                    break;
                case "voice:speaking":
                    var who = J.S(data, "user_id");
                    if (J.B(data, "on")) speaking.Add(who); else speaking.Remove(who);
                    orbs.SetSpeaking(who, J.B(data, "on"));
                    break;
                case "server:refresh":
                    var sid = J.S(data, "server_id");
                    serverData.Remove(sid);
                    if (sid == currentServer) OpenServer(sid);
                    break;
            }
        }
    }

    /// Friends in the voice channel you're watching float around the ring as glowing bubbles.
    public class VoiceOrbs
    {
        readonly Transform root;
        readonly Dictionary<string, (RectTransform rt, Image glow)> shown = new Dictionary<string, (RectTransform, Image)>();
        static readonly float[] Angles = { 75, 105, -75, -105, 135, -135, 160, -160, 180, 60, -60 };

        public VoiceOrbs(Transform space) { root = new GameObject("Voice Orbs").transform; root.SetParent(space, false); }

        public void Show(List<string> ids, OrbitApp app)
        {
            foreach (var id in shown.Keys.ToList()) if (!ids.Contains(id)) { UnityEngine.Object.Destroy(shown[id].rt.gameObject); shown.Remove(id); }
            for (int i = 0; i < ids.Count && i < Angles.Length; i++)
            {
                var id = ids[i];
                var pos = Quaternion.Euler(0, Angles[i], 0) * new Vector3(0, -0.1f, 1.7f);
                if (shown.TryGetValue(id, out var have)) { have.rt.localPosition = pos; continue; }
                var u = app.UserInfo(id);
                var rt = UIKit.WorldCanvas("Orb " + id, root, new Vector2(300, 360), pos, 0);
                UnityEngine.Object.Destroy(rt.GetComponent<GraphicRaycaster>());
                rt.gameObject.AddComponent<FaceCamera>();
                rt.gameObject.AddComponent<Bob>();
                var glow = UIKit.Box(rt, Pal.Green, "Glow", false); glow.sprite = UIKit.Circle;
                glow.rectTransform.sizeDelta = new Vector2(250, 250); glow.rectTransform.anchoredPosition = new Vector2(0, 40);
                glow.color = new Color(0.14f, 0.65f, 0.35f, app.IsSpeaking(id) ? 0.9f : 0);
                var av = UIKit.Avatar(rt, id, J.S(u, "display_name"), J.S(u, "avatar"), 220);
                av.anchoredPosition = new Vector2(0, 40);
                var name = UIKit.Text(rt, J.S(u, "display_name"), 34, Color.white, FontStyles.Bold, TextAlignmentOptions.Center);
                name.richText = false; name.rectTransform.sizeDelta = new Vector2(300, 50); name.rectTransform.anchoredPosition = new Vector2(0, -120);
                shown[id] = (rt, glow);
            }
        }

        public void SetSpeaking(string id, bool on)
        {
            if (shown.TryGetValue(id, out var o) && o.glow) o.glow.color = new Color(0.14f, 0.65f, 0.35f, on ? 0.9f : 0);
        }
    }

    /// Gentle floating motion for the voice bubbles.
    public class Bob : MonoBehaviour
    {
        Vector3 start; float phase;
        void Start() { start = transform.localPosition; phase = UnityEngine.Random.value * 6.28f; }
        void Update() => transform.localPosition = start + new Vector3(0, Mathf.Sin(Time.time * 0.8f + phase) * 0.03f, 0);
    }
}
