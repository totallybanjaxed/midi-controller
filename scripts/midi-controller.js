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
  game.settings.register("midi-controller", "mappings", {
    scope: "world",
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
  console.log("[MIDI] Setup hook fired, verifying MIDI handlers...");
  setTimeout(() => {
    verifyMIDIHandlers();
  }, 500);
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

  console.log("[MIDI] Web MIDI API is available, requesting access...");

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
}

// Recovery function in case handlers get lost
function verifyMIDIHandlers() {
  if (!midiAccess) {
    console.warn("[MIDI] midiAccess not initialized");
    return false;
  }

  let allAttached = true;
  for (let input of midiAccess.inputs.values()) {
    if (!input.onmidimessage) {
      console.warn(`[MIDI] Handler missing on ${input.name}, re-attaching...`);
      input.onmidimessage = handleMIDIMessage;
      allAttached = false;
    }
  }

  if (allAttached) {
    console.log("[MIDI] All handlers verified");
  }

  return true;
}

// --------------------
// MIDI HANDLER
// --------------------
async function handleMIDIMessage(event) {
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
  console.log("Overlay trigger", target, normalized);
  
  let label = "";

  switch (target) {
    case "master":
      label = "Master";
      for (const sound of game.audio.sounds) {
        sound.gain.value = volume;
      }
      break;

    case "music":
      label = "Music";
      for (const playlist of game.playlists.contents) {
        for (const s of playlist.sounds) {
          s.debounceVolume(volume);
        }
      }
      break;

    case "ambient":
      label = "Ambient";
      canvas.sounds?.placeables.forEach(s => {
        s.document.update({ volume: normalized });
      });
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
