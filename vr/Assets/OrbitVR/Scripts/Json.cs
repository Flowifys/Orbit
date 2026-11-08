// Tiny JSON reader/writer so Orbit VR needs no extra packages.
// Objects -> Dictionary<string, object>, arrays -> List<object>, numbers -> double.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace OrbitVR
{
    public static class Json
    {
        public static object Parse(string s)
        {
            if (string.IsNullOrEmpty(s)) return null;
            int i = 0;
            var v = Value(s, ref i);
            return v;
        }

        static void Ws(string s, ref int i) { while (i < s.Length && char.IsWhiteSpace(s[i])) i++; }

        static object Value(string s, ref int i)
        {
            Ws(s, ref i);
            if (i >= s.Length) return null;
            char c = s[i];
            if (c == '{') return Obj(s, ref i);
            if (c == '[') return Arr(s, ref i);
            if (c == '"') return Str(s, ref i);
            if (c == 't' && string.CompareOrdinal(s, i, "true", 0, 4) == 0) { i += 4; return true; }
            if (c == 'f' && string.CompareOrdinal(s, i, "false", 0, 5) == 0) { i += 5; return false; }
            if (c == 'n' && string.CompareOrdinal(s, i, "null", 0, 4) == 0) { i += 4; return null; }
            int st = i;
            while (i < s.Length && "+-0123456789.eE".IndexOf(s[i]) >= 0) i++;
            double.TryParse(s.Substring(st, i - st), NumberStyles.Float, CultureInfo.InvariantCulture, out var d);
            return d;
        }

        static Dictionary<string, object> Obj(string s, ref int i)
        {
            var o = new Dictionary<string, object>();
            i++; Ws(s, ref i);
            if (i < s.Length && s[i] == '}') { i++; return o; }
            while (i < s.Length)
            {
                Ws(s, ref i); var k = Str(s, ref i); Ws(s, ref i);
                i++; // :
                o[k] = Value(s, ref i); Ws(s, ref i);
                if (i < s.Length && s[i] == ',') { i++; continue; }
                i++; break; // }
            }
            return o;
        }

        static List<object> Arr(string s, ref int i)
        {
            var a = new List<object>();
            i++; Ws(s, ref i);
            if (i < s.Length && s[i] == ']') { i++; return a; }
            while (i < s.Length)
            {
                a.Add(Value(s, ref i)); Ws(s, ref i);
                if (i < s.Length && s[i] == ',') { i++; continue; }
                i++; break; // ]
            }
            return a;
        }

        static string Str(string s, ref int i)
        {
            var sb = new StringBuilder();
            i++; // opening quote
            while (i < s.Length)
            {
                char c = s[i++];
                if (c == '"') break;
                if (c != '\\') { sb.Append(c); continue; }
                char e = s[i++];
                switch (e)
                {
                    case 'n': sb.Append('\n'); break;
                    case 'r': sb.Append('\r'); break;
                    case 't': sb.Append('\t'); break;
                    case 'b': sb.Append('\b'); break;
                    case 'f': sb.Append('\f'); break;
                    case 'u': sb.Append((char)Convert.ToInt32(s.Substring(i, 4), 16)); i += 4; break;
                    default: sb.Append(e); break;
                }
            }
            return sb.ToString();
        }

        public static string Write(object v)
        {
            var sb = new StringBuilder(); W(sb, v); return sb.ToString();
        }

        static void W(StringBuilder sb, object v)
        {
            switch (v)
            {
                case null: sb.Append("null"); break;
                case string s:
                    sb.Append('"');
                    foreach (var c in s)
                    {
                        if (c == '"') sb.Append("\\\""); else if (c == '\\') sb.Append("\\\\");
                        else if (c == '\n') sb.Append("\\n"); else if (c == '\r') sb.Append("\\r"); else if (c == '\t') sb.Append("\\t");
                        else if (c < ' ') sb.Append("\\u").Append(((int)c).ToString("x4")); else sb.Append(c);
                    }
                    sb.Append('"'); break;
                case bool b: sb.Append(b ? "true" : "false"); break;
                case IDictionary d:
                    sb.Append('{'); bool first = true;
                    foreach (DictionaryEntry kv in d) { if (!first) sb.Append(','); first = false; W(sb, kv.Key.ToString()); sb.Append(':'); W(sb, kv.Value); }
                    sb.Append('}'); break;
                case IEnumerable e:
                    sb.Append('['); bool f2 = true;
                    foreach (var x in e) { if (!f2) sb.Append(','); f2 = false; W(sb, x); }
                    sb.Append(']'); break;
                case IFormattable n: sb.Append(n.ToString(null, CultureInfo.InvariantCulture)); break;
                default: W(sb, v.ToString()); break;
            }
        }
    }

    /// Small helpers for reading parsed JSON without casts everywhere.
    public static class J
    {
        public static Dictionary<string, object> O(object v) => v as Dictionary<string, object>;
        public static List<object> A(object v) => v as List<object> ?? new List<object>();
        public static object G(object o, string k) => O(o) != null && O(o).TryGetValue(k, out var v) ? v : null;
        public static string S(object o, string k) { var v = G(o, k); return v == null ? "" : v is double d ? d.ToString(CultureInfo.InvariantCulture) : v.ToString(); }
        public static double N(object o, string k) => G(o, k) is double d ? d : 0;
        public static bool B(object o, string k) => G(o, k) is bool b && b;
    }
}
