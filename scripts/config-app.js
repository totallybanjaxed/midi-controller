import { learnState } from "./midi-controller.js";

export class MidiConfigApp extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "midi-config",
    tag: "form",
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
      mappings: Object.entries(mappings).map(([key, val]) => ({
        key,
        type: val.type,
        value: val.name ?? val.formula ?? "",
        target: val.target ?? "master"
      })),
      macros: game.macros.contents.map(m => m.name),
      scenes: game.scenes.contents.map(s => s.name)
    };
  }

  /* -------------------------------------------- */

  _onRender(context, options) {
    super._onRender(context, options);

    const html = this.element;

    // 🎯 Type change - update visibility
    html.querySelectorAll(".type").forEach(select => {
      select.addEventListener("change", (e) => {
        const row = e.currentTarget.closest(".mapping-row");
        this._updateRow(row);
      });

      this._updateRow(select.closest(".mapping-row"));
    });

    // 📍 Event delegation on root element
    html.addEventListener("click", async (e) => {
      // 🎯 Learn
      if (e.target.matches(".learn-btn")) {
        const row = e.target.closest(".mapping-row");
        const keyInput = row.querySelector(".key");

        const result = await this._learnMidi();
        keyInput.value = result.key;
      }

      // ➕ Add
      if (e.target.matches("#add-mapping")) {
        this._appendRow();
      }

      // ❌ Delete
      if (e.target.matches(".delete-btn")) {
        e.target.closest(".mapping-row").remove();
      }

      // 💾 Save
      if (e.target.matches("#save")) {
        this._save();
      }
    });
  }

  /* -------------------------------------------- */

  _updateRow(row) {
    const type = row.querySelector(".type").value;

    const value = row.querySelector(".value-wrapper");
    const volume = row.querySelector(".volume-wrapper");

    if (type === "volume") {
      value.classList.add("hidden");
      volume.classList.remove("hidden");
    } else {
      value.classList.remove("hidden");
      volume.classList.add("hidden");

      const input = row.querySelector(".value");

      if (type === "macro") input.placeholder = "Macro name";
      if (type === "scene") input.placeholder = "Scene name";
      if (type === "roll") input.placeholder = "1d20+5";
    }
  }

  /* -------------------------------------------- */

  async _learnMidi() {
    return new Promise(resolve => {
      learnState.active = true;
      learnState.resolve = resolve;
      ui.notifications.info("Waiting for MIDI input...");
    });
  }

  /* -------------------------------------------- */

  _appendRow() {
    const container = this.element.querySelector("#mappings");

    const div = document.createElement("div");
    div.classList.add("mapping-row");

    div.innerHTML = `
      <input class="key" type="text" placeholder="cc-1 / note-60"/>

      <select class="type">
        <option value="macro">Macro</option>
        <option value="scene">Scene</option>
        <option value="roll">Roll</option>
        <option value="volume">Volume</option>
      </select>

      <div class="value-wrapper">
        <input class="value" type="text"/>
      </div>

      <div class="volume-wrapper">
        <select class="volume-target">
          <option value="master">Master</option>
          <option value="music">Music</option>
          <option value="ambient">Ambient</option>
        </select>
      </div>

      <button type="button" class="learn-btn">🎯</button>
      <button type="button" class="delete-btn">✕</button>
    `;

    container.appendChild(div);

    // Attach type change listener to new row
    const typeSelect = div.querySelector(".type");
    typeSelect.addEventListener("change", (e) => {
      this._updateRow(div);
    });

    this._updateRow(div);
  }

  /* -------------------------------------------- */

  async _save() {
    const rows = this.element.querySelectorAll(".mapping-row");
    const mappings = {};

    rows.forEach(row => {
      const key = row.querySelector(".key")?.value?.trim();
      const type = row.querySelector(".type")?.value;

      if (!key) return;

      if (type === "volume") {
        mappings[key] = {
          type,
          target: row.querySelector(".volume-target")?.value
        };
      } else {
        const value = row.querySelector(".value")?.value?.trim();
        if (!value) return;

        mappings[key] = {
          type,
          ...(type === "roll"
            ? { formula: value }
            : { name: value })
        };
      }
    });

    await game.settings.set("midi-controller", "mappings", mappings);

    ui.notifications.info("MIDI mappings saved");
    this.close();
  }
}