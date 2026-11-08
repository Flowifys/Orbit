# Orbit VR — the purple void

Orbit as its own VR app for Meta Quest. You float in a deep purple void with star dust and a
glowing orbit ring on the floor, with three floating panels around you:

- **Left:** your servers and DMs, and the channels in the server you're in.
- **Middle:** the chat, live, with a message box and a floating keyboard.
- **Right:** voice channels and who's in them. Pick one and those people float around you as
  glowing bubbles, which light up green when they talk.

Everything is built by code when the app starts, so there's only one thing to put in your scene.
It uses no paid plugins and no extra packages.

**Not in this first version yet:** talking in voice (you can see who's there and who's talking, but
you can't hear them yet), pictures inside messages (they show as `[picture: name]`), reactions and
replies. Those come next.

## Set it up (about 15 minutes, first time only)

1. **Make the project.** In Unity Hub, click **New project**, choose Unity 6, and pick the **VR**
   template (Unity calls it "VR Core" in some versions). Name it `OrbitVR` and create it.
2. **Copy the scripts.** Copy this repo's `vr/Assets/OrbitVR` folder into your project's `Assets`
   folder.
3. **Import the text font.** Go to **Window → TextMeshPro → Import TMP Essential Resources** and
   click Import.
4. **Make the scene.**
   - **File → New Scene → Basic (URP)**, then save it as `Assets/OrbitVR/Orbit.unity`.
   - Delete the **Main Camera** that the new scene came with.
   - In the Project window, search for **XR Interaction Setup** and drag that prefab into the scene.
     It brings the headset camera, both controllers with their laser pointers, and the EventSystem.
   - Click **GameObject → Create Empty**, name it `Orbit`, then **Add Component → Orbit App**.
5. **Try it in the editor.** Press Play. You can click the panels with the mouse and type on your
   real keyboard. To test like a headset without one, turn on the XR Device Simulator that came
   with the template.
6. **Build for Quest.**
   - Go to **File → Build Profiles**, pick **Meta Quest** (or Android), and click **Switch Platform**.
   - In **Edit → Project Settings → XR Plug-in Management**, on the Android tab, make sure
     **OpenXR** is ticked, with **Meta Quest Support** under it.
   - In **Project Settings → Player → Android → Other Settings**, set **Internet Access** to
     **Require**. Without this, the app can't reach Orbit.
   - Click **Build**. You get an APK you can send to your headset like your other Unity builds.

## How to use it

- Point a controller at things and pull the trigger to click.
- Point at the message box to type. The keyboard floats below the chat; **Enter** sends.
- **Recenter** (bottom of the left panel) moves everything back in front of you.
- You stay signed in. Use **Sign out** to switch accounts.

## Settings

Select the `Orbit` object to change these:

- **Server Url:** `https://orbital.sbs`.
- **Panel Distance:** how far away the chat floats, in metres.

## Files

| File | What it does |
|---|---|
| `OrbitApp.cs` | The app: sign in, servers, DMs, channels, chat, voice bubbles |
| `VoidWorld.cs` | The purple sky, fog, star dust and floor ring |
| `UIKit.cs` | Builds the rounded floating panels, buttons, lists and avatars |
| `VRKeyboard.cs` | The floating keyboard and text boxes |
| `OrbitApi.cs` | Talks to Orbit's server |
| `OrbitSocket.cs` | Live updates (new messages, who's in voice, who's talking) |
| `Json.cs` | Reads and writes JSON without needing any package |
