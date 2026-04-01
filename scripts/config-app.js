import { learnState } from "./midi-controller.js";

export class MidiConfigApp extends foundry.applications.api.ApplicationV2 {
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

  activateListeners(html) {
    super.activateListeners(html);

    // 🎯 Learn
    html.querySelectorAll(".learn-btn").forEach(btn => {
      btn.onclick = async (e) => {
        const row = e.currentTarget.closest(".mapping-row");
        const keyInput = row.querySelector(".key");

        const result = await this._learnMidi();
        keyInput.value = result.key;
      };
    });

    // 🔄 Type change
    html.querySelectorAll(".type").forEach(select => {
      select.onchange = (e) => {
        const row = e.currentTarget.closest(".mapping-row");
        this._updateRow(row);
      };

      this._updateRow(select.closest(".mapping-row"));
    });

    // ➕ Add
    const addBtn = html.querySelector("#add-mapping");
    if (addBtn) {
      addBtn.onclick = () => {
        this._appendRow(html);
      };
    }

    // ❌ Delete
    html.querySelectorAll(".delete-btn").forEach(btn => {
      btn.onclick = (e) => {
        e.currentTarget.closest(".mapping-row").remove();
      };
    });

    // 💾 Save
    html.querySelector("#save")?.onclick = () => {
      this._save(html);
    };
  }

  /* -------------------------------------------- */

  _updateRow(row) {
    const type = row.querySelector(".type").value;

    const value = row.querySelector(".value-wrapper");
    const volume = row.querySelector(".volume-wrapper");

    // Hide everything first
    value.style.display = "none";
    volume.style.display = "none";

    if (type === "volume") {
      volume.style.display = "inline-block";
    } else {
      value.style.display = "inline-block";

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

  _appendRow(html) {
    const container = html.querySelector("#mappings");

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

    this.activateListeners(html);
    this._updateRow(div);
  }

  /* -------------------------------------------- */

  async _save(html) {
    const rows = html.querySelectorAll(".mapping-row");
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