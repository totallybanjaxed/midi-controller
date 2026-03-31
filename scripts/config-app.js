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
      width: 720,
      height: "auto"
    }
  };

  static PARTS = {
    content: {
      template: "modules/midi-controller/templates/midi-config.html"
    }
  };

  /* -------------------------------------------- */

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

    html.addEventListener("change", (e) => {
      const row = e.target.closest(".mapping-row");
      if (!row) return;

      if (e.target.classList.contains("type")) {
        this._updateRowUI(row);
      }
    });

    html.addEventListener("click", async (e) => {
      const row = e.target.closest(".mapping-row");

      if (e.target.classList.contains("learn-btn")) {
        const keyInput = row.querySelector(".key");
        const result = await this._learnMidi();
        keyInput.value = result.key;
      }

      if (e.target.classList.contains("delete-btn")) {
        row.remove();
      }

      if (e.target.id === "add-mapping") {
        this._appendRow(html);
      }

      if (e.target.id === "save") {
        this._save(html);
      }
    });

    // Initial pass
    html.querySelectorAll(".mapping-row").forEach(row => {
      this._updateRowUI(row);
    });
  }

  /* -------------------------------------------- */

  _updateRowUI(row) {
    const type = row.querySelector(".type")?.value;

    const macro = row.querySelector(".macro-select");
    const scene = row.querySelector(".scene-select");
    const roll = row.querySelector(".roll-input");
    const volume = row.querySelector(".volume-target");

    [macro, scene, roll, volume].forEach(el => {
      if (el) el.closest(".field").style.display = "none";
    });

    switch (type) {
      case "macro":
        macro.closest(".field").style.display = "flex";
        break;

      case "scene":
        scene.closest(".field").style.display = "flex";
        break;

      case "roll":
        roll.closest(".field").style.display = "flex";
        break;

      case "volume":
        volume.closest(".field").style.display = "flex";
        break;
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

    div.innerHTML = html.querySelector("#row-template").innerHTML;

    container.appendChild(div);
    this._updateRowUI(div);
  }

  /* -------------------------------------------- */

  async _save(html) {
    const rows = html.querySelectorAll(".mapping-row");
    const mappings = {};

    rows.forEach(row => {
      const key = row.querySelector(".key")?.value?.trim();
      const type = row.querySelector(".type")?.value;

      if (!key || !type) return;

      let data = { type };

      switch (type) {
        case "macro":
          data.name = row.querySelector(".macro-select")?.value;
          break;

        case "scene":
          data.name = row.querySelector(".scene-select")?.value;
          break;

        case "roll":
          data.formula = row.querySelector(".roll-input")?.value?.trim();
          break;

        case "volume":
          data.target = row.querySelector(".volume-target")?.value;
          break;
      }

      mappings[key] = data;
    });

    await game.settings.set("midi-controller", "mappings", mappings);

    ui.notifications.info("MIDI mappings saved");
    this.close();
  }
}
