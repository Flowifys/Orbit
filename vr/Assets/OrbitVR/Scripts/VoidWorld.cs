// The purple void: deep violet sky, soft fog, drifting star dust and a glowing orbit ring on the floor.
// Everything uses the UI shader, which every Unity project ships with, so nothing goes pink in a build.
using UnityEngine;

namespace OrbitVR
{
    public static class VoidWorld
    {
        public static void Build(Transform root, float floorY)
        {
            var cam = Camera.main;
            if (cam)
            {
                cam.clearFlags = CameraClearFlags.SolidColor;
                cam.backgroundColor = Pal.Hex("#0b0716");
            }
            RenderSettings.skybox = null;
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Exponential;
            RenderSettings.fogColor = Pal.Hex("#140b2a");
            RenderSettings.fogDensity = 0.035f;
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight = Pal.Hex("#3b2a6e");

            var mat = new Material(Shader.Find("UI/Default"));
            mat.mainTexture = SoftDot();

            Particles(root, "Star dust", mat, 1400, 28f, 0.012f, 0.035f, new Color(1f, 0.95f, 1f, 0.9f), new Color(0.75f, 0.65f, 1f, 0.6f), 0.02f);
            Particles(root, "Nebula", mat, 26, 22f, 6f, 12f, new Color(0.55f, 0.35f, 1f, 0.07f), new Color(0.9f, 0.3f, 0.8f, 0.05f), 0.01f);
            Ring(root, floorY);
        }

        static void Particles(Transform root, string name, Material mat, int count, float radius, float minSize, float maxSize, Color a, Color b, float drift)
        {
            var go = new GameObject(name);
            go.transform.SetParent(root, false);
            var ps = go.AddComponent<ParticleSystem>();
            ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            var main = ps.main;
            main.loop = true; main.playOnAwake = true; main.maxParticles = count;
            main.startLifetime = 100000f; main.startSpeed = 0;
            main.startSize = new ParticleSystem.MinMaxCurve(minSize, maxSize);
            main.startColor = new ParticleSystem.MinMaxGradient(a, b);
            main.simulationSpace = ParticleSystemSimulationSpace.Local;
            var em = ps.emission; em.rateOverTime = 0; em.SetBursts(new[] { new ParticleSystem.Burst(0, (short)count) });
            var shape = ps.shape; shape.shapeType = ParticleSystemShapeType.Sphere; shape.radius = radius; shape.radiusThickness = 0.7f;
            var noise = ps.noise; noise.enabled = true; noise.strength = drift; noise.frequency = 0.05f; noise.scrollSpeed = 0.02f;
            var rot = ps.rotationOverLifetime; rot.enabled = false;
            var r = go.GetComponent<ParticleSystemRenderer>();
            r.material = mat; r.renderMode = ParticleSystemRenderMode.Billboard;
            ps.Play();
            go.AddComponent<SlowSpin>().DegPerSec = name == "Nebula" ? 0.4f : 0.8f;
        }

        static void Ring(Transform root, float floorY)
        {
            var rt = UIKit.WorldCanvas("Orbit ring", root, new Vector2(3600, 3600), Vector3.zero, 0, 90);
            rt.position = new Vector3(root.position.x, floorY + 0.005f, root.position.z);
            var img = UIKit.Rect("Ring", rt).gameObject.AddComponent<UnityEngine.UI.Image>();
            img.sprite = RingSprite(); img.color = new Color(0.62f, 0.5f, 1f, 0.55f); img.raycastTarget = false;
            UIKit.Fill(img.rectTransform);
            var glow = UIKit.Rect("Glow", rt).gameObject.AddComponent<UnityEngine.UI.Image>();
            glow.sprite = UIKit.Circle; glow.color = new Color(0.55f, 0.43f, 1f, 0.06f); glow.raycastTarget = false;
            UIKit.Fill(glow.rectTransform, 500, 500, 500, 500);
            rt.GetComponent<Canvas>().sortingOrder = -10;
            Object.Destroy(rt.GetComponent<UnityEngine.UI.GraphicRaycaster>());
        }

        static Texture2D SoftDot()
        {
            const int s = 64; var t = new Texture2D(s, s, TextureFormat.RGBA32, false);
            for (int y = 0; y < s; y++) for (int x = 0; x < s; x++)
            {
                float d = Vector2.Distance(new Vector2(x, y), new Vector2(s / 2f, s / 2f)) / (s / 2f);
                float a = Mathf.Clamp01(1 - d); a = a * a;
                t.SetPixel(x, y, new Color(1, 1, 1, a));
            }
            t.Apply(); return t;
        }

        static Sprite RingSprite()
        {
            const int s = 512; var t = new Texture2D(s, s, TextureFormat.RGBA32, false);
            float r = s / 2f - 6;
            var px = new Color32[s * s];
            for (int y = 0; y < s; y++) for (int x = 0; x < s; x++)
            {
                float d = Vector2.Distance(new Vector2(x + 0.5f, y + 0.5f), new Vector2(s / 2f, s / 2f));
                float a = Mathf.Clamp01(1.6f - Mathf.Abs(d - r)) + Mathf.Clamp01(1 - Mathf.Abs(d - r) / 10f) * 0.35f;
                px[y * s + x] = new Color32(255, 255, 255, (byte)(Mathf.Clamp01(a) * 255));
            }
            t.SetPixels32(px); t.Apply();
            return Sprite.Create(t, new Rect(0, 0, s, s), new Vector2(0.5f, 0.5f), 100);
        }
    }

    public class SlowSpin : MonoBehaviour
    {
        public float DegPerSec = 1;
        void Update() => transform.Rotate(0, DegPerSec * Time.deltaTime, 0, Space.World);
    }

    /// Keeps a floating label or avatar turned toward you.
    public class FaceCamera : MonoBehaviour
    {
        void LateUpdate()
        {
            var c = Camera.main; if (!c) return;
            var d = transform.position - c.transform.position; d.y = 0;
            if (d.sqrMagnitude > 0.0001f) transform.rotation = Quaternion.LookRotation(d);
        }
    }
}
