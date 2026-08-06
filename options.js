const STORAGE_AREA = chrome.storage.sync;
const SETTINGS_KEY = "mdt-settings";
const DEFAULTS = {
  fontFamily: 'Georgia, "Noto Serif SC", "Times New Roman", serif',
  uiFontFamily: '"Segoe UI", "PingFang SC", sans-serif',
  fontSize: 16,
  lineHeight: 1.72,
  windowWidth: 680,
  windowHeight: 480,
  accentColor: "#2563eb"
};

const form = document.getElementById("settings-form");
const resetButton = document.getElementById("reset-button");
const saveStatus = document.getElementById("save-status");

init();

async function init() {
  const settings = await loadSettings();
  populateForm(settings);
  bindOutputs();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const settings = readForm();
  await STORAGE_AREA.set({ [SETTINGS_KEY]: settings });
  flashStatus("Saved");
});

resetButton.addEventListener("click", async () => {
  populateForm(DEFAULTS);
  await STORAGE_AREA.set({ [SETTINGS_KEY]: { ...DEFAULTS } });
  flashStatus("Reset to defaults");
});

function bindOutputs() {
  form.querySelectorAll("input[type='range']").forEach((input) => {
    const output = form.querySelector(`[data-for="${input.name}"]`);
    const sync = () => {
      output.value = input.name === "fontSize" || input.name.includes("Width") || input.name.includes("Height")
        ? `${input.value}px`
        : input.value;
    };
    input.addEventListener("input", sync);
    sync();
  });
}

async function loadSettings() {
  const stored = await STORAGE_AREA.get(SETTINGS_KEY);
  return { ...DEFAULTS, ...(stored[SETTINGS_KEY] || {}) };
}

function populateForm(settings) {
  Object.entries(settings).forEach(([key, value]) => {
    if (form.elements[key]) {
      form.elements[key].value = value;
    }
  });
}

function readForm() {
  return {
    fontFamily: form.elements.fontFamily.value,
    uiFontFamily: form.elements.uiFontFamily.value,
    fontSize: Number(form.elements.fontSize.value),
    lineHeight: Number(form.elements.lineHeight.value),
    windowWidth: Number(form.elements.windowWidth.value),
    windowHeight: Number(form.elements.windowHeight.value),
    accentColor: form.elements.accentColor.value
  };
}

function flashStatus(message) {
  saveStatus.textContent = message;
  window.setTimeout(() => {
    saveStatus.textContent = "";
  }, 1800);
}
