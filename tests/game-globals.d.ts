// Browser-side globals the specs use inside page.evaluate(). They live in the shared classic-script
// scope of web/js/*.js (and in the init scripts), not in an ES module, so they are declared globally
// here instead of being imported. Keep this list in sync with what the specs actually touch.

declare const VXDBG: any;        // test bridge from web/js/controls.js
declare const VXCTRL: any;       // web/js/controls.js public API (calibrate, gyro, touch…)
declare const VXHORN: any;       // web/js/horn.js public API (hold, events, honks)
declare const VXAUTOAPI: any;    // web/js/autodrive.js public API (on, stats, set, toggle…)
declare const VXAUDAPI: any;     // web/js/audio.js public API (probe, unlock)
declare function persist(): void;              // save writer from web/js/game.js
declare function pauseGame(): void;            // web/js/features.js
declare function resume(): void;               // web/js/game.js
declare function finish(): void;               // web/js/game.js — shows the real results screen
declare function showGarage(): void;           // web/js/extras.js
declare function vxRemapKey(action: string): void;   // settings remap entry point

// Helpers installed by stubPad() in tests/controls.spec.ts.
declare const __btn: (index: number, value: number) => void;
declare const __axis: (index: number, value: number) => void;
declare const __unplug: () => void;
declare const __pad: any;

interface Window {
  VXDBG: any;
  __pad: any;
  __plugs: any[];
  __btn: (index: number, value: number) => void;
  __axis: (index: number, value: number) => void;
  __unplug: () => void;
}
