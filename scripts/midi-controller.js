import { MidiConfigApp } from "./config-app.js";

// 🎯 Learn mode shared state
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
    ui.notifications.error("Web MIDI API not supported in this browser.");
    return;
  }

  try {
    midiAccess = await navigator.requestMIDIAccess();
    initializeMIDI();
  } catch (err) {
    console.error("MIDI Controller | MIDI access failed", err);
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
    console.log(`MIDI ${event.port.state}: ${event.port.name}`);

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
  const key = `${status}-${data1}`;

  // 🎯 Learn mode
  if (learnState.active && learnState.resolve) {
    learnState.resolve(key);
    learnState.active = false;
    learnState.resolve = null;
    ui.notifications.info(`Captured MIDI input: ${key}`);
    return;
  }

  const mappings = game.settings.get("midi-controller", "mappings");
  const action = mappings[key];
  if (!action) return;

  console.log("MIDI Trigger:", key, action);

  switch (action.type) {
    case "macro":
      return triggerMacro(action.name);

    case "scene":
      return activateScene(action.name);

    case "roll":
      return rollDice(action.formula);
  }
}

// --------------------
// ACTIONS
// --------------------
function triggerMacro(name) {
  const macro = game.macros.getName(name);
  if (!macro) {
    ui.notifications.warn(`Macro not found: ${name}`);
    return;
  }
  macro.execute();
}

async function activateScene(name) {
  const scene = game.scenes.getName(name);
  if (!scene) {
    ui.notifications.warn(`Scene not found: ${name}`);
    return;
  }
  await scene.activate();
}

async function rollDice(formula) {
  try {
    const roll = await new Roll(formula).evaluate();
    roll.toMessage({
      speaker: ChatMessage.getSpeaker(),
      flavor: "🎹 MIDI Roll"
    });
  } catch (err) {
    ui.notifications.error(`Invalid roll: ${formula}`);
  }
}
