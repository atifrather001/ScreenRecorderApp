# ScreenRecorderApp

**An App by NexaSecure Cloud and AI** · free and open source for macOS and Windows

## Download

Get the latest installer from the [Releases page](https://github.com/atifrather001/ScreenRecorderApp/releases):
| System | File |
| --- | --- |
| macOS, Apple silicon (M1 and later) | `ScreenRecorderApp-<version>-mac-arm64.dmg` |
| macOS, Intel | `ScreenRecorderApp-<version>-mac-x64.dmg` |
| Windows 10 / 11 (64-bit) | `ScreenRecorderApp-<version>-windows-x64-setup.exe` |

The builds are not signed with an Apple Developer ID or a Windows certificate yet, so the first launch needs one extra step:

- **macOS:** open the app once; when macOS says it can't verify the developer, click **Done**, then go to
  **System Settings › Privacy & Security** and click **Open Anyway**. If macOS instead says the app **"is damaged and can't be
  opened"**, run this once in Terminal and open it again:
  ```bash
  xattr -cr /Applications/ScreenRecorderApp.app
  ```
- **Windows:** in the SmartScreen prompt choose **More info › Run anyway**.

A desktop screen recorder and video editor for macOS, Windows and Linux, built with Electron, React and ffmpeg.

Record your screen (or one window, or a dragged-out area) with microphone, system audio and camera, then trim,
split, annotate and zoom on a multi-track timeline and export to MP4, WebM, ProRes, GIF or audio.

## Status

| Area | State |
| --- | --- |
| Screen / window / area capture | Working (needs Screen Recording permission on macOS) |
| Microphone, camera, system audio | Working; each saved as its own file and timeline track. System audio needs macOS 13+ (or Windows) |
| Pause / resume, countdown, floating control bar, global shortcuts | Working |
| Timeline: move, trim, split, ripple delete, multi-select, snapping, undo/redo, tracks (mute/hide/lock) | Working |
| Preview: real-time compositing, picture-in-picture camera, drag/resize in the canvas | Working |
| Annotations: text, arrow, box, ellipse, highlight, spotlight, blur, numbered steps | Working |
| Zoom & pan with easing (camera stays put) | Working |
| Export presets with progress and cancel, hardware encoders when available | Working |
| Projects (`.srproj`), autosave, recent projects with thumbnails, relinking moved media | Working |
| Red frame around the recorded screen/area (not captured in the video) | Working |
| Smaller files: resolution cap (default 1440p), screen-tuned bitrates, size estimate | Working |
| AI captions: local Whisper, live while recording and "Transcribe timeline" in the editor; SRT/VTT/TXT export; burn-in | Working (model downloads once, ~150 MB) |
| AI notes: Claude writes summary, key points, decisions, action items from the transcript; Markdown export | Working with your own Anthropic API key (Settings › AI) |
| Windows 10/11 installer (`npm run dist:win`, bundles ffmpeg) | Builds; not yet tested on a real PC |
| Not yet: cursor click highlights / keystroke overlay, transitions, audio waveforms, auto-update, code signing | Planned |

## Getting started

Requirements: Node.js 20+. The installers ship their own ffmpeg; in development the npm `@ffmpeg-installer` build is used
(or a system ffmpeg if that is missing). You can pick a different binary in Settings.

```bash
npm install
npm run dev        # start with hot reload
npm test           # unit tests + real ffmpeg export tests
npm run type-check
npm run dist:mac   # build unsigned .dmg files (Apple silicon + Intel) into release/
npm run dist:win   # build an unsigned Windows installer (works from a Mac too)
```

### macOS permissions

The first time you record, macOS asks for Screen Recording access. Allow the app in
System Settings › Privacy & Security › Screen Recording, then click **Quit & Reopen** in the app. During `npm run dev`
the entry is called **Electron**. Microphone and camera access is requested when you switch them on.

If the app keeps saying permission is denied even though it's switched on (this can happen after installing an
update of version 0.4.2 or earlier), reset the entry and allow it again:

```bash
tccutil reset ScreenCapture com.nexasecure.screenrecorderapp
```

Since 0.4.3 the permission is kept across updates. Keep the app in the Applications folder.

## How it works

```
src/
  shared/          Pure TypeScript used by every process (unit tested)
    types.ts         Project model: assets, tracks, clips, annotations, zooms (all positions normalised 0..1)
    timeline.ts      Immutable edit operations: place, move, trim, split, ripple delete, snapping
    zoom.ts          Zoom/pan easing, shared by the preview and the ffmpeg expressions
    export-graph.ts  Project + preset -> ffmpeg filter graph and arguments
    presets.ts       Export presets and default settings
  main/            Electron main process
    index.ts         Windows, menus, IPC, global shortcuts, getDisplayMedia source handling
    recording.ts     Streams MediaRecorder chunks to disk, remuxes (H.264 -> MP4, VP8/9 -> WebM)
    exporter.ts      Export jobs with progress/cancel
    projects.ts      .srproj read/write, thumbnails, media relinking
    ffmpeg.ts        Locates ffmpeg/ffprobe, probes media
    media-protocol.ts media:// protocol with HTTP range support for the preview
  preload/         Typed, minimal bridge exposed as window.api
  renderer/        React UI
    lib/recorder-engine.ts  Screen/mic/camera capture with MediaRecorder
    lib/playback.ts         Real-time preview compositor
    lib/annotations.ts      Annotation drawing (also renders the PNGs used by export)
    views/                  Home, Recorder, Editor (timeline, preview, inspector, media bin, export), Settings
    overlays/               Floating control bar, countdown, area selector
```

Recording uses the browser capture APIs (`getDisplayMedia`, `getUserMedia`, `MediaRecorder`). Each source is written to
its own file so the screen, camera and microphone land on separate tracks. Area recordings capture the whole display
and store the area as a crop, so it can be changed later.

The preview and the export share the same model and maths: the preview composites with a canvas, the export builds an
ffmpeg filter graph (one input per clip, `overlay` for layers and annotations, `boxblur` for blur, `zoompan` for zooms,
`amix` for audio). Annotations are drawn by the same canvas code in both cases, so exports match the preview.

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Start / stop recording (global) | ⌘⇧9 / Ctrl+Shift+9 (configurable) |
| Pause / resume recording (global) | ⌘⇧0 / Ctrl+Shift+0 (configurable) |
| Play / pause | Space |
| Split at playhead | S or ⌘B |
| Delete / ripple delete | Delete / Shift+Delete |
| Step a frame / a second | ← → / Shift+← → |
| Timeline zoom | + / − or ⌘+scroll |
| Undo / redo | ⌘Z / ⌘⇧Z |
| New recording, open, save, export | ⌘R, ⌘O, ⌘S, ⌘E |

## License

ScreenRecorderApp is © 2026 NexaSecure Cloud and AI and released under the [MIT License](LICENSE).

The installers bundle third-party software under their own licenses, listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) (regenerate with `npm run notices` after changing dependencies).
In particular, the bundled ffmpeg/ffprobe executables are GPL v3 builds; the licence text ships in
`resources/licenses/GPL-3.0.txt` and source is available from https://ffmpeg.org.
