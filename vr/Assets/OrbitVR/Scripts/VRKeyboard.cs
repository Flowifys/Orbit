// A floating keyboard you type on by pointing and clicking, plus the text boxes it types into.
using System;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace OrbitVR
{
    /// A text box. Point at it to start typing on the floating keyboard.
    public class TextField : MonoBehaviour
    {
        public string Value = "";
        public string Placeholder = "";
        public bool Secret;
        public int MaxLength = 4000;
        public Action OnSubmit;
        public Action OnChanged;
        public TextMeshProUGUI Label;
        public Image Back;
        bool focused;

        public static TextField Make(Transform parent, string placeholder, bool secret = false, float height = 70)
        {
            var bg = UIKit.Box(parent, Pal.Card2, "Field: " + placeholder);
            UIKit.Size(bg, -1, height);
            var f = bg.gameObject.AddComponent<TextField>();
            f.Back = bg; f.Placeholder = placeholder; f.Secret = secret;
            var b = bg.gameObject.AddComponent<Button>();
            var cb = b.colors; cb.normalColor = new Color(0.88f, 0.88f, 0.9f, 1); cb.highlightedColor = Color.white; cb.selectedColor = cb.normalColor; b.colors = cb;
            b.onClick.AddListener(() => VRKeyboard.Instance?.Focus(f));
            f.Label = UIKit.Text(bg.transform, "", 28, Pal.Text, FontStyles.Normal, TextAlignmentOptions.MidlineLeft);
            f.Label.richText = false;
            UIKit.Fill(f.Label.rectTransform, 20, 6, 20, 6);
            f.Redraw();
            return f;
        }

        public void SetFocused(bool on) { focused = on; Redraw(); }

        public void Set(string v) { Value = v ?? ""; Redraw(); OnChanged?.Invoke(); }

        public void Redraw()
        {
            if (!Label) return;
            if (string.IsNullOrEmpty(Value) && !focused) { Label.text = Placeholder; Label.color = Pal.Dim; }
            else { Label.text = (Secret ? new string('*', Value.Length) : Value) + (focused ? "|" : ""); Label.color = Pal.Text; }
            if (Back) Back.color = focused ? Color.Lerp(Pal.Card2, Pal.Accent, 0.18f) : Pal.Card2;
        }
    }

    public class VRKeyboard : MonoBehaviour
    {
        public static VRKeyboard Instance;
        public TextField Target { get; private set; }
        bool shift, symbols;
        readonly List<(TextMeshProUGUI label, string lower, string upper, string sym)> keys = new List<(TextMeshProUGUI, string, string, string)>();
        TextMeshProUGUI shiftLabel, symLabel;

        static readonly string[][] Rows =
        {
            new[] { "1|!", "2|@", "3|#", "4|$", "5|%", "6|^", "7|&", "8|*", "9|(", "0|)" },
            new[] { "q|+", "w|=", "e|-", "r|_", "t|/", "y|\\", "u|:", "i|;", "o|'", "p|\"" },
            new[] { "a|[", "s|]", "d|{", "f|}", "g|<", "h|>", "j|~", "k|`", "l||" },
            new[] { "z|!", "x|?", "c|,", "v|.", "b|@", "n|#", "m|:" },
        };

        public static VRKeyboard Build(Transform parent, Vector3 localPos)
        {
            var rt = UIKit.WorldCanvas("Orbit Keyboard", parent, new Vector2(1000, 360), localPos, 0, 28);
            var kb = rt.gameObject.AddComponent<VRKeyboard>();
            Instance = kb;
            var bg = UIKit.Box(rt, Pal.Panel, "Keyboard Back");
            UIKit.Fill(bg.rectTransform);
            UIKit.VList(bg, 8, 14);

            foreach (var row in Rows)
            {
                var line = UIKit.Rect("Row", bg.transform);
                var h = UIKit.HList(line, 8); h.childForceExpandWidth = true; h.childAlignment = TextAnchor.MiddleCenter;
                UIKit.Size(line, -1, 58);
                if (row.Length == 7) kb.AddKey(line, "Shift", () => kb.ToggleShift(), 1.5f, true);
                foreach (var k in row)
                {
                    string lo = k.Substring(0, 1), sym = k.Length > 2 ? k.Substring(2) : lo;
                    var label = kb.AddKey(line, lo, null, 1, false);
                    kb.keys.Add((label, lo, lo.ToUpperInvariant(), sym));
                    var btn = label.GetComponentInParent<Button>();
                    var idx = kb.keys.Count - 1;
                    btn.onClick.AddListener(() => kb.Type(kb.Current(idx)));
                }
                if (row.Length == 7) kb.AddKey(line, "Del", () => kb.Backspace(), 1.5f, true);
            }
            var last = UIKit.Rect("Row", bg.transform);
            var h2 = UIKit.HList(last, 8); h2.childForceExpandWidth = true;
            UIKit.Size(last, -1, 58);
            kb.symLabel = kb.AddKey(last, "#+=", () => kb.ToggleSymbols(), 1.5f, true);
            kb.AddKey(last, ",", () => kb.Type(","), 1, false);
            kb.AddKey(last, "space", () => kb.Type(" "), 5, false);
            kb.AddKey(last, ".", () => kb.Type("."), 1, false);
            kb.AddKey(last, "?", () => kb.Type("?"), 1, false);
            kb.AddKey(last, "Enter", () => kb.Enter(), 2, true, true);
            rt.gameObject.SetActive(false);
            return kb;
        }

        TextMeshProUGUI AddKey(Transform row, string text, Action click, float width, bool special, bool accent = false)
        {
            var b = UIKit.Button(row, text, click == null ? null : new UnityEngine.Events.UnityAction(click), accent ? Pal.Accent : special ? Pal.Card2 : Pal.Card, Pal.Text, 28, 58);
            UIKit.Size(b.GetComponent<Image>(), 60 * width, 58, width);
            var label = b.GetComponentInChildren<TextMeshProUGUI>();
            if (text == "Shift") shiftLabel = label;
            return label;
        }

        string Current(int i) { var k = keys[i]; return symbols ? k.sym : shift ? k.upper : k.lower; }

        void Refresh()
        {
            foreach (var k in keys) k.label.text = symbols ? k.sym : shift ? k.upper : k.lower;
            if (shiftLabel) shiftLabel.color = shift ? Pal.Accent : Pal.Text;
            if (symLabel) symLabel.text = symbols ? "abc" : "#+=";
        }

        void ToggleShift() { shift = !shift; Refresh(); }
        void ToggleSymbols() { symbols = !symbols; Refresh(); }

        public void Focus(TextField f)
        {
            if (Target && Target != f) Target.SetFocused(false);
            Target = f;
            if (f) f.SetFocused(true);
            gameObject.SetActive(f != null);
        }

        public void Hide() => Focus(null);

        void Type(string s)
        {
            if (!Target || Target.Value.Length >= Target.MaxLength) return;
            Target.Set(Target.Value + s);
            if (shift && !symbols) { shift = false; Refresh(); }
        }

        void Backspace()
        {
            if (!Target || Target.Value.Length == 0) return;
            // remove a whole emoji / surrogate pair at once
            int cut = Target.Value.Length >= 2 && char.IsLowSurrogate(Target.Value[Target.Value.Length - 1]) ? 2 : 1;
            Target.Set(Target.Value.Substring(0, Target.Value.Length - cut));
        }

        void Enter() { if (Target) Target.OnSubmit?.Invoke(); }

        // typing on a real keyboard also works (handy when testing in the Unity editor)
        bool noOldInput;
        void Update()
        {
            if (!Target || noOldInput) return;
            string s;
            try { s = Input.inputString; } catch { noOldInput = true; return; }   // project uses only the new Input System
            if (string.IsNullOrEmpty(s)) return;
            foreach (var c in s)
            {
                if (c == '\b') Backspace();
                else if (c == '\n' || c == '\r') Enter();
                else if (!char.IsControl(c)) Type(c.ToString());
            }
        }
    }
}
