// Builds Orbit's floating panels in code: rounded cards, text, buttons and scroll lists.
using System;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace OrbitVR
{
    public static class Pal
    {
        public static Color Bg = Hex("#0c0a11");
        public static Color Panel = new Color(0.075f, 0.066f, 0.105f, 0.94f);
        public static Color Card = Hex("#1b1726");
        public static Color Card2 = Hex("#241f33");
        public static Color Hover = Hex("#2d2740");
        public static Color Line = new Color(0.84f, 0.8f, 1f, 0.09f);
        public static Color Text = Hex("#f2eff9");
        public static Color Muted = Hex("#9c96b0");
        public static Color Dim = Hex("#6e6884");
        public static Color Accent = Hex("#8b6dff");
        public static Color AccentSoft = new Color(0.545f, 0.427f, 1f, 0.22f);
        public static Color Green = Hex("#23a55a");
        public static Color Red = Hex("#f23f43");
        public static Color Hex(string h) { ColorUtility.TryParseHtmlString(h, out var c); return c; }

        static readonly Color[] avatarColors = { Hex("#8b6dff"), Hex("#e07a3a"), Hex("#5b8def"), Hex("#2bb5a8"), Hex("#e05cb7"), Hex("#3fbf74"), Hex("#e8b23a") };
        public static Color ForId(string id) { int h = 0; foreach (var c in id ?? "") h = h * 31 + c; return avatarColors[Mathf.Abs(h) % avatarColors.Length]; }
    }

    public static class UIKit
    {
        static Sprite round, circle;

        /// A white rounded-rectangle sprite that stretches without blurring its corners.
        public static Sprite Round
        {
            get
            {
                if (round) return round;
                const int size = 64, r = 24;
                var t = new Texture2D(size, size, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Bilinear };
                var px = new Color32[size * size];
                for (int y = 0; y < size; y++)
                    for (int x = 0; x < size; x++)
                    {
                        float cx = Mathf.Clamp(x + 0.5f, r, size - r), cy = Mathf.Clamp(y + 0.5f, r, size - r);
                        float d = Vector2.Distance(new Vector2(x + 0.5f, y + 0.5f), new Vector2(cx, cy));
                        byte a = (byte)(Mathf.Clamp01(r - d + 0.5f) * 255);
                        px[y * size + x] = new Color32(255, 255, 255, a);
                    }
                t.SetPixels32(px); t.Apply();
                round = Sprite.Create(t, new Rect(0, 0, size, size), new Vector2(0.5f, 0.5f), 100, 0, SpriteMeshType.FullRect, new Vector4(r, r, r, r));
                return round;
            }
        }

        public static Sprite Circle
        {
            get
            {
                if (circle) return circle;
                const int size = 128; float r = size / 2f;
                var t = new Texture2D(size, size, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp };
                var px = new Color32[size * size];
                for (int y = 0; y < size; y++)
                    for (int x = 0; x < size; x++)
                    {
                        float d = Vector2.Distance(new Vector2(x + 0.5f, y + 0.5f), new Vector2(r, r));
                        px[y * size + x] = new Color32(255, 255, 255, (byte)(Mathf.Clamp01(r - d) * 255));
                    }
                t.SetPixels32(px); t.Apply();
                circle = Sprite.Create(t, new Rect(0, 0, size, size), new Vector2(0.5f, 0.5f), 100);
                return circle;
            }
        }

        // ---------- canvases ----------
        /// A floating panel in the world. 1 unit of size = 1 millimetre.
        public static RectTransform WorldCanvas(string name, Transform parent, Vector2 sizeMm, Vector3 localPos, float yawDeg, float pitchDeg = 0)
        {
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            var canvas = go.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;
            canvas.worldCamera = Camera.main;
            var scaler = go.AddComponent<CanvasScaler>(); scaler.dynamicPixelsPerUnit = 4;
            go.AddComponent<GraphicRaycaster>();
            // pointing with VR controllers (XR Interaction Toolkit), added only if that package is installed
            var tracked = Type.GetType("UnityEngine.XR.Interaction.Toolkit.UI.TrackedDeviceGraphicRaycaster, Unity.XR.Interaction.Toolkit");
            if (tracked != null) go.AddComponent(tracked);
            var rt = (RectTransform)go.transform;
            rt.sizeDelta = sizeMm;
            rt.localScale = Vector3.one * 0.001f;
            rt.localPosition = localPos;
            rt.localRotation = Quaternion.Euler(pitchDeg, yawDeg, 0);
            return rt;
        }

        public static RectTransform Rect(string name, Transform parent)
        {
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            return (RectTransform)go.transform;
        }

        public static RectTransform Fill(RectTransform rt, float l = 0, float t = 0, float r = 0, float b = 0)
        {
            rt.anchorMin = Vector2.zero; rt.anchorMax = Vector2.one;
            rt.offsetMin = new Vector2(l, b); rt.offsetMax = new Vector2(-r, -t);
            return rt;
        }

        public static Image Box(Transform parent, Color c, string name = "Box", bool rounded = true)
        {
            var rt = Rect(name, parent);
            var img = rt.gameObject.AddComponent<Image>();
            img.color = c;
            if (rounded) { img.sprite = Round; img.type = Image.Type.Sliced; img.pixelsPerUnitMultiplier = 1; }
            return img;
        }

        public static TextMeshProUGUI Text(Transform parent, string s, float size, Color c, FontStyles style = FontStyles.Normal, TextAlignmentOptions align = TextAlignmentOptions.TopLeft)
        {
            var rt = Rect("Text", parent);
            var t = rt.gameObject.AddComponent<TextMeshProUGUI>();
            t.text = s; t.fontSize = size; t.color = c; t.fontStyle = style; t.alignment = align;
            t.textWrappingMode = TextWrappingModes.Normal; t.overflowMode = TextOverflowModes.Ellipsis; t.raycastTarget = false;
            return t;
        }

        public static LayoutElement Size(Component c, float w = -1, float h = -1, float flexW = -1, float flexH = -1)
        {
            var le = c.GetComponent<LayoutElement>(); if (le == null) le = c.gameObject.AddComponent<LayoutElement>();
            if (w >= 0) le.preferredWidth = w; if (h >= 0) { le.preferredHeight = h; le.minHeight = h; }
            if (flexW >= 0) le.flexibleWidth = flexW; if (flexH >= 0) le.flexibleHeight = flexH;
            return le;
        }

        public static VerticalLayoutGroup VList(Component c, float spacing = 8, int pad = 0)
        {
            var v = c.gameObject.AddComponent<VerticalLayoutGroup>();
            v.spacing = spacing; v.padding = new RectOffset(pad, pad, pad, pad);
            v.childControlWidth = true; v.childControlHeight = true; v.childForceExpandWidth = true; v.childForceExpandHeight = false;
            return v;
        }

        public static HorizontalLayoutGroup HList(Component c, float spacing = 8, int pad = 0)
        {
            var h = c.gameObject.AddComponent<HorizontalLayoutGroup>();
            h.spacing = spacing; h.padding = new RectOffset(pad, pad, pad, pad);
            h.childControlWidth = true; h.childControlHeight = true; h.childForceExpandWidth = false; h.childForceExpandHeight = false;
            h.childAlignment = TextAnchor.MiddleLeft;
            return h;
        }

        /// A button: a rounded box that lights up when pointed at.
        public static Button Button(Transform parent, string label, UnityAction onClick, Color bg, Color fg, float fontSize = 26, float height = 64)
        {
            var img = Box(parent, Color.white, "Button: " + label);
            var b = img.gameObject.AddComponent<Button>();
            var cb = b.colors;
            cb.normalColor = bg; cb.highlightedColor = Color.Lerp(bg, Color.white, 0.12f); cb.pressedColor = Color.Lerp(bg, Color.black, 0.2f);
            cb.selectedColor = bg; cb.disabledColor = new Color(bg.r, bg.g, bg.b, 0.4f); cb.fadeDuration = 0.08f;
            b.colors = cb;
            if (onClick != null) b.onClick.AddListener(onClick);
            if (!string.IsNullOrEmpty(label))
            {
                var t = Text(img.transform, label, fontSize, fg, FontStyles.Bold, TextAlignmentOptions.Center);
                Fill(t.rectTransform, 14, 0, 14, 0);
                t.textWrappingMode = TextWrappingModes.NoWrap;
            }
            Size(img, -1, height);
            return b;
        }

        /// A list row (channel, DM, server) that highlights when pointed at.
        public static Button Row(Transform parent, UnityAction onClick, float height = 64)
        {
            var img = Box(parent, Color.white, "Row");
            var b = img.gameObject.AddComponent<Button>();
            var cb = b.colors;
            cb.normalColor = new Color(1, 1, 1, 0); cb.highlightedColor = Pal.Hover; cb.pressedColor = Pal.Card2; cb.selectedColor = new Color(1, 1, 1, 0); cb.fadeDuration = 0.06f;
            b.colors = cb;
            b.onClick.AddListener(onClick);
            HList(img, 14, 10).padding = new RectOffset(14, 14, 8, 8);
            Size(img, -1, height);
            return b;
        }

        /// A vertical scrolling list. Returns the content to add rows to.
        public static RectTransform Scroll(Transform parent, out ScrollRect scroll, float spacing = 4)
        {
            var view = Rect("Scroll", parent);
            var mask = view.gameObject.AddComponent<RectMask2D>();
            var hit = view.gameObject.AddComponent<Image>(); hit.color = new Color(0, 0, 0, 0.001f);   // so dragging anywhere scrolls
            scroll = view.gameObject.AddComponent<ScrollRect>();
            scroll.horizontal = false; scroll.movementType = ScrollRect.MovementType.Clamped; scroll.scrollSensitivity = 40; scroll.inertia = true;
            var content = Rect("Content", view);
            content.anchorMin = new Vector2(0, 1); content.anchorMax = new Vector2(1, 1); content.pivot = new Vector2(0.5f, 1);
            content.offsetMin = Vector2.zero; content.offsetMax = Vector2.zero;
            VList(content, spacing);
            var fit = content.gameObject.AddComponent<ContentSizeFitter>(); fit.verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            scroll.content = content; scroll.viewport = view;
            return content;
        }

        /// A round avatar: the picture if it loads, otherwise the first letter on a colored circle.
        public static RectTransform Avatar(Transform parent, string id, string name, string url, float size)
        {
            var holder = Box(parent, Pal.ForId(id), "Avatar", false);
            holder.sprite = Circle;
            Size(holder, size, size);
            holder.rectTransform.sizeDelta = new Vector2(size, size);
            var ini = Text(holder.transform, string.IsNullOrEmpty(name) ? "?" : name.Substring(0, 1).ToUpperInvariant(), size * 0.42f, Color.white, FontStyles.Bold, TextAlignmentOptions.Center);
            Fill(ini.rectTransform);
            if (!string.IsNullOrEmpty(url)) LoadInto(holder, ini, url);
            return holder.rectTransform;
        }

        static async void LoadInto(Image holder, TextMeshProUGUI ini, string url)
        {
            var tex = await OrbitApi.Image(url);
            if (tex == null || holder == null) return;
            var m = holder.gameObject.AddComponent<Mask>(); m.showMaskGraphic = true;
            var raw = Rect("Picture", holder.transform).gameObject.AddComponent<RawImage>();
            raw.texture = tex; raw.raycastTarget = false;
            Fill(raw.rectTransform);
            if (ini) ini.gameObject.SetActive(false);
        }

        public static void Clear(Transform t) { for (int i = t.childCount - 1; i >= 0; i--) UnityEngine.Object.Destroy(t.GetChild(i).gameObject); }
    }
}
