import assert from "node:assert/strict";
import {
  splitChatBubbles,
  splitCaptureBubbles,
  verifiedChatQuote,
} from "../lib/chat-presentation.ts";
import { parseLyrics, activeLyric } from "../lib/music-lyrics.ts";
assert.deepEqual(splitChatBubbles("第一句。\n\n第二句。继续这句。"), [
  "第一句。",
  "第二句。继续这句。",
]);
const code = "Example:\n\n```js\nconst a = 1;\n\nconsole.log(a);\n```";
assert.deepEqual(splitChatBubbles(code), [code]);
const history = [
  { id: "a", role: "user", content: "今天很开心。" },
  { id: "system", role: "system", content: "Internal event" },
];
assert.equal(verifiedChatQuote(history, "a", "很开心", "chat").text, "很开心");
assert.throws(() => verifiedChatQuote(history, "a", "很难过", "chat"));
assert.throws(() => verifiedChatQuote(history, "missing", "很开心", "chat"));
assert.throws(() =>
  verifiedChatQuote(history, "system", "Internal event", "chat"),
);
assert.throws(() => verifiedChatQuote(history, "a", "", "chat"));
assert.deepEqual(
  parseLyrics("[ar:Vesper]\n[00:12.50][01:12.50]Again\n[00:01]First"),
  [
    { time: 1, text: "First" },
    { time: 12.5, text: "Again" },
    { time: 72.5, text: "Again" },
  ],
);
assert.equal(activeLyric(parseLyrics("[00:01]One\n[00:05]Two"), 0), -1);
assert.equal(activeLyric(parseLyrics("[00:01]One\n[00:05]Two"), 6), 1);
console.log(
  "Web presentation: paragraphs, fenced code, verified quotes, timed lyrics passed",
);

for (const original of ["  你好。\n\n第二句。  ", "重复\n\n重复\n", code, "\t\n ", "😀西语：Hola！中文保留。"]) {
  assert.equal(splitCaptureBubbles(original).join(""), original, "Exports preserve exact originals including whitespace and Unicode");
}
assert.equal(splitCaptureBubbles("一\n\n二").length, 2);
