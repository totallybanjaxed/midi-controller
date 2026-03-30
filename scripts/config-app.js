import { learnState } from "./midi-controller.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class MidiConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "midi-config",
    tag: "form",
    classes: ["midi-config"],
    window: {
      title: "MIDI Controller Mapping",
      resizable: true
    },
    position: {
      width: 650,
      height: "auto"
    }
  };

  static PARTS = {
    content: {
      template: "modules/midi-controller/templates/midi-config.html"
    }
  };

  async _prepareContext() {
    const mappings = game.settings.get("midi-controller", "mappings");

    return {
      mappings: Object.entries(mappings).map(([key, val]) => {
        const [control, number] = key.split("-");

        return {
          rawKey: key,
          displayKey: control === "cc" ? `CC ${number}` : `Note ${number}`,
          type: val.type,
          target: val.target ?? "",
          value: val.name ?? val.formula ?? ""
        };
      })
    };
  }

  // --------------------
  // RENDER / EVENTS
  // --------------------
  _onRender(context, options) {
    super._onRender(context, options);

    const html = this.element;

    // 🎯 Event delegation (clean + no rebinding issues)
    html.addEventListener("click", async (e) => {
      // LEARN
      if (e.target.matches(".learn-btn")) {
        const row = e.target.closest(".mapping-row");
        const keyInput = row.querySelector(".key");

        const result = await this._learnMidi();

        keyInput.value = result.key;
        row.querySelector(".display-key").textContent =
          result.type === "cc"
            ? `CC ${result.key.split("-")[1]}`
            : `Note ${result.key.split("-")[1]}`;
      }

      // ADD ROW
      if (e.target.matches("#add-mapping")) {
        this._appendRow();
      }

      // DELETE
      if (e.target.matches(".delete-btn")) {
        e.target.closest(".mapping-row").remove();
      }

      // SAVE
      if (e.target.matches("#save")) {
        this._save();
      }
    });
  }

  async _learnMidi() {
    return new Promise(resolve => {
      learnState.active = true;
      learnState.resolve = resolve;
      ui.notifications.info("Move a knob or press a key...");
    });
  }

  // --------------------
  // UI BUILDING
  // --------------------
  _appendRow() {
    const container = this.element.querySelector("#mappings");

    const div = document.createElement("div");
    div.classList.add("mapping-row");

    div.innerHTML = `
      <span class="display-key">Unassigned</span>
      <input class="key" type="hidden" />

      <select class="type">
        <option value="macro">Macro</option>
        <option value="scene">Scene</option>
        <option value="roll">Roll</option>
        <option value="volume">Volume</option>
      </select>

      <input class="value" type="text" placeholder="Name or Formula" />

      <select class="target">
        <option value="">-- Volume Target --</option>
        <option value="master">Master</option>
        <option value="music">Music</option>
        <option value="ambient">Ambient</option>
      </select>

      <button type="button" class="learn-btn">Learn</button>
      <button type="button" class="delete-btn">X</button>
    `;

    container.appendChild(div);
  }

  // --------------------
  // SAVE
  // --------------------
  async _save() {
    const rows = this.element.querySelectorAll(".mapping-row");
    const mappings = {};

    rows.forEach(row => {
      const keyEl = row.querySelector(".key");
      const typeEl = row.querySelector(".type");
      const valueEl = row.querySelector(".value");
      const targetEl = row.querySelector(".target");
    
      const key = keyEl?.value;
      const type = typeEl?.value;
      const value = valueEl?.value?.trim() ?? "";
      const target = targetEl?.value;
    
      if (!key) return;
    
      // 🎛 Volume mapping
      if (type === "volume") {
        if (!target) return;
    
        mappings[key] = {
          type: "volume",
          target
        };
        return;
      }
    
      // 🎯 Other mappings
      if (!value) return;
    
      mappings[key] = {
        type,
        ...(type === "roll"
          ? { formula: value }
          : { name: value })
      };
    });

    await game.settings.set("midi-controller", "mappings", mappings);

    ui.notifications.info("MIDI mappings saved");
    this.close();
  }
}
