# Web / iOS parity update — 2026-10-07

## Included

- Chat paragraph bubbles; native `metadata.bubbles` and `replyTo` rendering; independent media; one assistant disclosure per turn; user timestamps removed.
- Long press (420 ms) / right click / Shift+F10 overlay with subtle lift, copy, per-excerpt bookmark, quote and delete. User quotes persist with the original message identity.
- `send_web_bubbles` client tool validates exact quote excerpts and persists delivered bubbles before acknowledging success. New threads get this catalog; existing threads show the existing upgrade notice because app-server does not replace tools on resume. Ordinary paragraphs work in existing threads.
- Sending / Thinking states; queued stickers plus captions; single-image alignment and existing photo-stack gestures retained.
- `send_web_voice` generates and persists voice using this browser’s configured TTS connection; native bubble/voice tool aliases are accepted when resuming native threads. Live provider generation was not invoked during testing.
- Voice bars show native transcripts and saved Chinese translations. New local translation is feature-detected (LanguageDetector + Translator). Browsers without those APIs show a clear limitation. Uploaded audio without a transcript still requires transcription in the native app; no unsupported “all languages” claim or silent third-party upload.
- Contacts heatmap with daily counts, Monday-first weeks, welcome before heatmap, no legend.
- Diary name, author icon, date rail/month picker, six recent moods, six-column dictionary, stronger selection, fixed paper header/footer with scrolling body. Shared native mood schema and existing persistence hooks preserved.
- Appearance entry, custom backgrounds retained, glass-opacity slider, Vesper/native-style toggle, browser favicon options. Browser-native-style is CSS; iOS app icons and Apple's native materials are not web APIs.
- Existing grouped settings/contact/Collection glass maintained. Connection/Voice direct navigation rows; compact error icon and Dismiss button. Letter mailbox icon toggle; existing All/Unread/Kept and Upcoming placeholder retained.
- Root-page music dock, secondary-page hiding, player return button, solid transport icons, timed lyrics and seeking, saved track/position restoration without autoplay. Web keeps its existing NetEase library and playback isolation from native MusicKit.

## Verification

- TypeScript noEmit and production vinext build.
- Existing Codex merge/approval/model/sticker tests, web-context tests, journal mood read/write tests, web music isolation/persistence tests.
- New paragraph/code-preservation, exact-quote validation and lyric timestamp tests.
- Chrome desktop and 390px mobile fixtures with mocked services: fixed diary scroll/header/footer, six-column mood sheet, heatmap count 53, one text/audio timestamp, right-click quote into composer, native cached voice translation under bar, photo stack, root music dock and lyrics layout. No production messages sent for tests.
- Existing lint debt remains: page.tsx React hook purity/ref rules and chat-contacts effect rule. New modules have zero lint errors; page.tsx error count is below the baseline (22 before).
