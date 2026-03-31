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
// INIT + SETTINGS
// --------------------
Hooks.once("init", () => {
  console.log("MIDI Controller | Init");

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
// READY → INIT MIDI
// --------------------
Hooks.once("ready", async () => {
  console.log("MIDI Controller | Ready");

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

  // 🎛 CC (knobs / sliders)
  if (command === 0xb0) {
    key = `cc-${data1}`;
  }
  // 🎹 Note
  else if (command === 0x90) {
    key = `note-${data1}`;
  } else {
    return;
  }

  // --------------------
  // LEARN MODE
  // --------------------
  if (learnState.active && learnState.resolve) {
    learnState.resolve({
      key,
      type: command === 0xb0 ? "cc" : "note"
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
      return handleVolume(action.target, data2);
  }
}

// --------------------
// VOLUME HANDLING (V13)
// --------------------
const debouncedVolume = foundry.utils.debounce(_setVolume, 50);

function handleVolume(target, midiValue) {
  debouncedVolume(target, midiValue);
}

async function _setVolume(target, midiValue) {
  const normalized = midiValue / 127;
  const volume = foundry.audio.AudioHelper.inputToVolume(normalized);

  switch (target) {
    case "master":
      // Apply to all active sounds
      for (const sound of game.audio.sounds) {
        sound.gain.value = volume;
      }
      break;

    case "music":
      for (const playlist of game.playlists) {
        for (const s of playlist.sounds) {
          s.debounceVolume(volume);
        }
      }
      break;

    case "ambient":
      canvas.sounds?.placeables.forEach(s => {
        s.document.update({ volume: normalized });
      });
      break;
  }
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
