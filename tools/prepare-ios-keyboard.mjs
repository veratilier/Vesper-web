import { readFileSync, writeFileSync } from 'node:fs';

// Capacitor Keyboard 8.0.5's SPM umbrella header omits Keyboard.h, so Swift
// sees the module but cannot instantiate its plugin for explicit registration.
// Apply this after dependency installation, before Capacitor/Xcode sync.
const header = new URL('../node_modules/@capacitor/keyboard/ios/Sources/KeyboardPlugin/include/KeyboardPlugin.h', import.meta.url);
const source = readFileSync(header, 'utf8');
if (!/^\s*#\s*(?:import|include)\s*[<"](?:[^">]*\/)?Keyboard\.h[">]/m.test(source)) {
  writeFileSync(header, `${source.trimEnd()}\n\n#import "Keyboard.h"\n`);
}
