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
      width: 600,
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
        value: val.name ?? val.formula ?? ""
      }))
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    // 🎯 Learn buttons
    html.querySelectorAll(".learn-btn").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        const row = e.currentTarget.closest(".mapping-row");
        const keyInput = row.querySelector(".key");

        const key = await this._learnMidi();
        keyInput.value = key;
      });
    });

    // ➕ Add row
    html.querySelector("#add-mapping")?.addEventListener("click", () => {
      this._appendRow(html);
    });

    // ❌ Delete row
    html.querySelectorAll(".delete-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.currentTarget.closest(".mapping-row").remove();
      });
    });

    // 💾 Save
    html.querySelector("#save")?.addEventListener("click", () => {
      this._save(html);
    });
  }

  async _learnMidi() {
    return new Promise(resolve => {
      learnState.active = true;
      learnState.resolve = resolve;
      ui.notifications.info("Waiting for MIDI input...");
    });
  }

  _appendRow(html) {
    const container = html.querySelector("#mappings");

    const div = document.createElement("div");
    div.classList.add("mapping-row");

    div.innerHTML = `
      <input class="key" type="text" placeholder="MIDI Key" />

      <select class="type">
        <option value="macro">Macro</option>
        <option value="scene">Scene</option>
        <option value="roll">Roll</option>
      </select>

      <input class="value" type="text" placeholder="Name or Formula" />

      <button type="button" class="learn-btn">Learn</button>
      <button type="button" class="delete-btn">X</button>
    `;

    container.appendChild(div);

    // Re-bind listeners for new buttons
    this.activateListeners(html);
  }

  async _save(html) {
    const rows = html.querySelectorAll(".mapping-row");
    const mappings = {};

    rows.forEach(row => {
      const key = row.querySelector(".key").value.trim();
      const type = row.querySelector(".type").value;
      const value = row.querySelector(".value").value.trim();

      if (!key || !value) return;

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
