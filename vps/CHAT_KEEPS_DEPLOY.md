# Vesper chat screenshots and keeps

`chat_capture_messages` uses the existing private history service to select original visible messages, then draws one JPEG with Pillow. It does not open Vesper Web, start Chrome, or depend on Web login state. The existing Worker path sends the JPEG into the current chat and can save the same file to Vesper's album.

Deploy `vesper_chat_screenshot.py` and all three `vesper-chat-background*.jpg` assets together in `/home/ubuntu/vesper-codex-history`. Install `python3-pil` or an equivalent Pillow package and a Chinese font such as `fonts-noto-cjk`. Restart `vesper-codex-history.service`. The history endpoint and Worker screenshot contract do not change.

The native iPhone app writes its current palette, wallpaper URL, shade, glass style, glass finish, classic transparency, and Reduce Transparency setting to the `chatCaptureAppearance` state document when the app opens or an appearance setting changes. A custom wallpaper is uploaded once to Vesper media; no image data is stored in the state document. The renderer reads that document through the authenticated API and uses the matching bundled palette background when no custom wallpaper is selected. It approximates the iOS glass materials with background blur, tint and edge highlights; Pillow cannot reproduce Apple's system GlassEffect exactly. Deploy the Worker document-key addition and updated native app before relying on appearance matching.

The renderer reads at most 12 original messages in chronological order and rejects private/control records. Photo URLs must be fixed Vesper media URLs. A missing photo or renderer dependency is an error, rather than a screenshot with omitted content. The history bearer token is not passed to the image subprocess.

Acceptance: find exact IDs with `chat_search_messages`, capture them, and verify a single JPEG arrives in chat with Vera on the left and Ash on the right. Multiple original text bubbles and photos are laid out separately on the current iPhone background. With `save:true`, verify the same JPEG is in the Vesper album. Deleted, private, cross-conversation and reordered IDs must fail before rendering.
