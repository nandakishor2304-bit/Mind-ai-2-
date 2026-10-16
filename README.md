# Mind — private offline AI (Android / iOS)

Runs a Qwen vision-language model **on the phone CPU** (llama.cpp via llama.rn). No server, no API.
Text, tables, photos, PDFs, and text/code/CSV files. White UI, black text. No model names shown.

## Build the APK (needs a PC with Node 18+, Android Studio/SDK, JDK 17)
    npm install            # also copies pdf.js into assets (postinstall)
    npx expo prebuild
    npx expo run:android --variant release
APK appears in android/app/build/outputs/apk/release/. Install it on the phone.
(No Android SDK? `npm i -g eas-cli && eas build -p android --profile apk` builds in the cloud.)
Expo Go will NOT work (native code) — use the built APK.

## First launch
Tap "Set up Mind" once on Wi‑Fi (~3.3 GB). After that, airplane mode works forever.
Recommended: phone with 6 GB+ RAM. Speed is a few words/second on mid-range phones.

## Change the brain
Edit URLs in `src/config.js` (any Qwen GGUF + matching mmproj file). Edit the personality in SYSTEM_PROMPT.

## Easiest: build APK with GitHub (no PC)
1. Create a free GitHub repo, upload all files from this folder (keep the .github folder).
2. Open the repo > Actions > "Build APK" > wait ~15 min.
3. Open the finished run > Artifacts > download "Mind-APK" > unzip > install the .apk.
