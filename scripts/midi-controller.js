import { MidiConfigApp } from "./config-app.js";

const { AudioHelper } = foundry.audio;

// --------------------
// Learn mode state
// --------------------
export let learnState = {
  active: false,
  resolve: null
};

let midiAccess = null;
let midiWatchdog = null;
let windowFocused = true; // Track window focus state

// --------------------
// Volume overlay
// --------------------
let volumeOverlay;
let overlayTimeout;

function showVolumeOverlay(label, normalized) {
  const percent = Math.round(normalized * 100);

  if (!volumeOverlay) {
    volumeOverlay = document.createElement("div");
    volumeOverlay.id = "midi-volume-overlay";

    Object.assign(volumeOverlay.style, {
      position: "fixed",
      left: "50%",
      bottom: "30px",
      transform: "translateX(-50%)",
      padding: "10px 16px",
      background: "rgba(20,20,20,0.9)",
      border: "1px solid #666",
      color: "#fff",
      fontSize: "18px",
      borderRadius: "8px",
      zIndex: 99999,
      pointerEvents: "none",
      opacity: "0",
      transition: "opacity 0.2s ease"
    });

    document.querySelector("#ui-top")?.appendChild(volumeOverlay) 
  ?? document.body.appendChild(volumeOverlay);
  }

  volumeOverlay.textContent = `${label}: ${percent}%`;
  volumeOverlay.style.opacity = "1";

  clearTimeout(overlayTimeout);
  overlayTimeout = setTimeout(() => {
    volumeOverlay.style.opacity = "0";
  }, 800);
}

// --------------------
// Soft Takeover State
// --------------------
const pickupState = {}; // { "cc-7": { active: false, lastValue: 0 } }
const PICKUP_THRESHOLD = 0.05; // ~5%

function checkPickup(key, normalized) {
  if (!pickupState[key]) {
    pickupState[key] = { active: false };
  }

  const state = pickupState[key];

  // First movement after mapping: require pickup
  if (!state.active) {
    const current = getCurrentVolumeEstimate();

    if (Math.abs(normalized - current) <= PICKUP_THRESHOLD) {
      state.active = true;
    } else {
      return false; // ignore until knob "catches"
    }
  }

  return true;
}

// Rough estimate of current volume (best-effort)
function getCurrentVolumeEstimate() {
  const sounds = game.audio.sounds;
  if (!sounds.length) return 0;

  // Average gain → convert back to approx normalized
  const avgGain =
    sounds.reduce((sum, s) => sum + (s.gain?.value ?? 0), 0) /
    sounds.length;

  // Inverse of inputToVolume is not exposed, so approximate
  return Math.min(Math.max(avgGain, 0), 1);
}

// --------------------
// INIT
// --------------------
Hooks.once("init", () => {
  console.log("[MIDI] Init hook fired");

  // Track window focus for MIDI command filtering
  window.addEventListener("focus", () => {
    windowFocused = true;
    console.log("[MIDI] Window FOCUSED - focus event fired, windowFocused=", windowFocused);
  });

  window.addEventListener("blur", () => {
    windowFocused = false;
    console.log("[MIDI] Window BLURRED - blur event fired, windowFocused=", windowFocused);
  });

  // Initial focus state check
  if (document.hasFocus()) {
    windowFocused = true;
    console.log("[MIDI] Initial state: document has focus, windowFocused=true");
  } else {
    windowFocused = false;
    console.log("[MIDI] Initial state: document does not have focus, windowFocused=false");
  }

  game.settings.register("midi-controller", "mappings", {
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.registerMenu("midi-controller", "configMenu", {
    name: "MIDI Controller Config",
    label: "Open Config",
    hint: "Map MIDI inputs to actions",
    icon: "fas fa-music",
    type: MidiConfigApp,
    restricted: true
  });
});

// Verify handlers after all modules have loaded
Hooks.once("setup", () => {
  console.log("[MIDI] Setup hook fired");
  // Note: waitdog will be started once MIDI is initialized
});

// --------------------
// READY → MIDI INIT
// --------------------
Hooks.once("ready", async () => {
  console.log("[MIDI] Ready hook fired");

  if (!navigator.requestMIDIAccess) {
    console.error("[MIDI] Web MIDI API not supported");
    ui.notifications.error("Web MIDI API not supported.");
    return;
  }

  console.log("[MIDI] Web MIDI API is available, delaying initialization to allow device enumeration...");

  // Delay MIDI initialization to allow browser to enumerate connected devices
  // This helps catch devices that were plugged in before page load
  setTimeout(async () => {
    console.log("[MIDI] Attempting MIDI access after 3 second delay...");

    try {
      // Set a timeout for MIDI access request in case it hangs (e.g., blocked by other modules)
      const midiPromise = navigator.requestMIDIAccess();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("MIDI access request timed out")), 3000)
      );

      try {
        midiAccess = await Promise.race([midiPromise, timeoutPromise]);
        console.log("[MIDI] MIDI Access granted:", midiAccess);
        initializeMIDI();
      } catch (timeoutErr) {
        console.warn("[MIDI] MIDI access request timed out, will retry on user interaction...");
        // Retry on next user interaction
        document.addEventListener("click", retryMIDIAccess, { once: true });
        document.addEventListener("keydown", retryMIDIAccess, { once: true });
        document.addEventListener("mousemove", retryMIDIAccess, { once: true });
      }
    } catch (err) {
      console.error("[MIDI] Failed to request MIDI access:", err);
      ui.notifications.error(`MIDI access failed: ${err.message}`);
    }
  }, 3000);
});

// Retry function for MIDI access
async function retryMIDIAccess() {
  console.log("[MIDI] Retrying MIDI access after user interaction...");
  if (midiAccess) {
    console.log("[MIDI] MIDI already initialized, skipping retry");
    return;
  }

  try {
    console.log("[MIDI] Attempting requestMIDIAccess...");
    midiAccess = await navigator.requestMIDIAccess();
    console.log("[MIDI] MIDI Access granted on retry:", midiAccess);
    initializeMIDI();
    ui.notifications.info("MIDI controllers connected");
  } catch (err) {
    console.error("[MIDI] Retry failed:", err);
    ui.notifications.warn("Could not connect MIDI controllers");
  }
}

// --------------------
// MIDI SETUP
// --------------------
function initializeMIDI() {
  if (!midiAccess) {
    console.warn("[MIDI] midiAccess is null, cannot initialize");
    return;
  }

  console.log(`[MIDI] Initializing with ${midiAccess.inputs.size} input(s)`);

  for (let input of midiAccess.inputs.values()) {
    console.log(`[MIDI] Connected: ${input.name}`);
    input.onmidimessage = handleMIDIMessage;
  }

  // Verify handlers are attached
  let handlerCount = 0;
  for (let input of midiAccess.inputs.values()) {
    if (input.onmidimessage) handlerCount++;
  }
  console.log(`[MIDI] Handlers attached to ${handlerCount}/${midiAccess.inputs.size} inputs`);

  midiAccess.onstatechange = (event) => {
    console.log(`[MIDI] State change: ${event.port.name} (${event.port.state})`);
    if (event.port.type === "input" && event.port.state === "connected") {
      console.log(`[MIDI] Re-attaching handler to ${event.port.name}`);
      event.port.onmidimessage = handleMIDIMessage;
    }
  };

  // Start watchdog to catch devices that appear after initialization
  startMIDIWatchdog();
}

// Watchdog timer to periodically check for new MIDI inputs
function startMIDIWatchdog() {
  if (midiWatchdog) {
    clearInterval(midiWatchdog);
  }

  let checkCount = 0;
  let lastInputCount = midiAccess.inputs.size;

  console.log(`[MIDI] Starting watchdog with ${lastInputCount} initial input(s)`);

  midiWatchdog = setInterval(() => {
    checkCount++;
    const currentInputCount = midiAccess.inputs.size;

    // Log every 5 checks initially
    if (checkCount % 5 === 0 || currentInputCount > lastInputCount) {
      console.log(`[MIDI] Watchdog check #${checkCount}: ${currentInputCount} input(s) found`);
    }

    // If input count changed, we have new devices
    if (currentInputCount > lastInputCount) {
      console.log(`[MIDI] New MIDI device(s) detected! (was ${lastInputCount}, now ${currentInputCount})`);
      lastInputCount = currentInputCount;
    }

    // Always verify handlers are attached
    verifyMIDIHandlers();

    // Switch to slower polling after 2 minutes
    if (checkCount > 240) {
      clearInterval(midiWatchdog);
      console.log("[MIDI] Switching to slow polling mode (2 second interval)");
      midiWatchdog = setInterval(() => {
        verifyMIDIHandlers();
      }, 2000);
    }
  }, 500);

  console.log("[MIDI] Watchdog started with 500ms check interval");
}

// Recovery function in case handlers get lost or devices appear after init
function verifyMIDIHandlers() {
  if (!midiAccess) {
    console.warn("[MIDI] midiAccess not initialized");
    return false;
  }

  let inputCount = midiAccess.inputs.size;
  let allAttached = true;
  let reattached = 0;

  for (let input of midiAccess.inputs.values()) {
    if (!input.onmidimessage) {
      console.warn(`[MIDI] Handler missing on "${input.name}", re-attaching...`);
      input.onmidimessage = handleMIDIMessage;
      allAttached = false;
      reattached++;
    }
  }

  if (reattached > 0) {
    console.log(`[MIDI] Re-attached ${reattached} handler(s), total inputs: ${inputCount}`);
  }

  return reattached > 0;
}

// --------------------
// MIDI HANDLER
// --------------------
async function handleMIDIMessage(event) {
  // 🪟 Only process MIDI in the focused window
  // Check multiple indicators of focus state
  const hasDocFocus = document.hasFocus();
  const isVisible = document.visibilityState === "visible";

  console.log(`[MIDI] Focus check - windowFocused=${windowFocused}, document.hasFocus()=${hasDocFocus}, visibilityState=${document.visibilityState}`);

  if (!windowFocused) {
    console.log("[MIDI] Ignoring input - windowFocused=false");
    return;
  }

  console.log("[MIDI] Processing input - windowFocused=true");

  const [status, data1, data2] = event.data;
  const command = status & 0xf0;

  let key;
  let controlType;

  // 🎛 CC (knobs)
  if (command === 0xb0) {
    key = `cc-${data1}`;
    controlType = "cc";
  }
  // 🎹 Note (buttons)
  else if (command === 0x90 && data2 > 0) {
    key = `note-${data1}`;
    controlType = "note";
  } else {
    return;
  }

  console.log(`[MIDI] Received: ${key}`);

  // --------------------
  // LEARN MODE
  // --------------------
  if (learnState.active && learnState.resolve) {
    console.log(`[MIDI] Learn mode: resolved with ${key}`);
    learnState.resolve({
      key,
      type: controlType
    });

    learnState.active = false;
    learnState.resolve = null;

    ui.notifications.info(`Captured ${key}`);
    return;
  }

  const mappings = game.settings.get("midi-controller", "mappings");
  const action = mappings[key];
  console.log(`[MIDI] Looking up mapping for ${key}:`, action);
  if (!action) return;

  // --------------------
  // EXECUTE ACTION
  // --------------------
  console.log(`[MIDI] Executing action type: ${action.type}`);
  switch (action.type) {
    case "macro":
      return triggerMacro(action.name);

    case "scene":
      return activateScene(action.name);

    case "roll":
      return rollDice(action.formula);

    case "volume":
      // 🎯 Soft takeover check
      const normalized = data2 / 127;
      if (!checkPickup(key, normalized)) {
        console.log(`[MIDI] Soft takeover: pickup threshold not met`);
        return;
      }

      return handleVolume(key, action.target, data2);
  }
}

// --------------------
// VOLUME (V13 SAFE)
// --------------------
const debouncedVolume = foundry.utils.debounce(_setVolume, 50);

function handleVolume(key, target, midiValue) {
  debouncedVolume(key, target, midiValue);
}

async function _setVolume(key, target, midiValue) {
  const normalized = midiValue / 127;
  const volume = AudioHelper.inputToVolume(normalized);
  console.log("[MIDI] Volume control - target:", target, "normalized:", normalized);

  let label = "";

  switch (target) {
    case "music":
      label = "Music";
      console.log("[MIDI] Controlling Music playlists");
      for (const playlist of game.playlists.contents) {
        for (const s of playlist.sounds) {
          s.debounceVolume(volume);
        }
      }
      break;

    case "environment":
      label = "Environment";
      console.log("[MIDI] Controlling Environment/Ambient sounds");
      canvas.sounds?.placeables.forEach(s => {
        s.document.update({ volume: normalized });
      });
      break;

    case "interface":
      label = "Interface";
      console.log("[MIDI] Controlling Interface/UI sounds");
      for (const sound of game.audio.sounds) {
        sound.gain.value = volume;
      }
      break;
  }

  showVolumeOverlay(label, normalized);
}

// --------------------
// ACTIONS
// --------------------
function triggerMacro(name) {
  console.log(`[MIDI] Attempting to trigger macro: ${name}`);
  try {
    const macro = game.macros.getName(name);
    if (!macro) {
      console.error(`[MIDI] Macro not found: ${name}`);
      return ui.notifications.warn(`Macro not found: ${name}`);
    }
    console.log(`[MIDI] Executing macro: ${name}`);
    macro.execute();
  } catch (err) {
    console.error(`[MIDI] Error executing macro ${name}:`, err);
  }
}

async function activateScene(name) {
  console.log(`[MIDI] Attempting to activate scene: ${name}`);
  try {
    const scene = game.scenes.getName(name);
    if (!scene) {
      console.error(`[MIDI] Scene not found: ${name}`);
      return ui.notifications.warn(`Scene not found: ${name}`);
    }
    console.log(`[MIDI] Activating scene: ${name}`);
    await scene.activate();
  } catch (err) {
    console.error(`[MIDI] Error activating scene ${name}:`, err);
  }
}

async function rollDice(formula) {
  console.log(`[MIDI] Attempting to roll: ${formula}`);
  try {
    const roll = await new Roll(formula).evaluate();
    roll.toMessage({
      speaker: ChatMessage.getSpeaker(),
      flavor: "MIDI Roll"
    });
    console.log(`[MIDI] Roll created successfully`);
  } catch (err) {
    console.error(`[MIDI] Error rolling ${formula}:`, err);
    ui.notifications.error(`Invalid roll: ${formula}`);
  }
}
