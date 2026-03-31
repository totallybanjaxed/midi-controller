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
      zIndex: 10000,
      pointerEvents: "none",
      opacity: "0",
      transition: "opacity 0.2s ease"
    });

    document.body.appendChild(volumeOverlay);
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

// --------------------
// READY → MIDI INIT
// --------------------
Hooks.once("ready", async () => {
  if (!navigator.requestMIDIAccess) {
    ui.notifications.error("Web MIDI API not supported.");
    return;
  }

  try {
    midiAccess = await navigator.requestMIDIAccess();
    initializeMIDI();
  } catch (err) {
    console.error("MIDI access failed", err);
  }
});

// --------------------
// MIDI SETUP
// --------------------
function initializeMIDI() {
  for (let input of midiAccess.inputs.values()) {
    console.log(`MIDI Connected: ${input.name}`);
    input.onmidimessage = handleMIDIMessage;
  }

  midiAccess.onstatechange = (event) => {
    if (event.port.type === "input" && event.port.state === "connected") {
      event.port.onmidimessage = handleMIDIMessage;
    }
  };
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

  // --------------------
  // LEARN MODE
  // --------------------
  if (learnState.active && learnState.resolve) {
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
  if (!action) return;

  // --------------------
  // EXECUTE ACTION
  // --------------------
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
      if (!checkPickup(key, normalized)) return;

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
  const macro = game.macros.getName(name);
  if (!macro) return ui.notifications.warn(`Macro not found: ${name}`);
  macro.execute();
}

async function activateScene(name) {
  const scene = game.scenes.getName(name);
  if (!scene) return ui.notifications.warn(`Scene not found: ${name}`);
  await scene.activate();
}

async function rollDice(formula) {
  try {
    const roll = await new Roll(formula).evaluate();
    roll.toMessage({
      speaker: ChatMessage.getSpeaker(),
      flavor: "MIDI Roll"
    });
  } catch {
    ui.notifications.error(`Invalid roll: ${formula}`);
  }
}
