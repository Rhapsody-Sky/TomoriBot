(() => {
  const palettes = [
    { id: "lilya", label: "Lilya", color: "oklch(.72 .12 195)" },
    { id: "aphel", label: "Aphel", color: "oklch(.72 .13 350)" },
    { id: "nerine", label: "Nerine", color: "oklch(.72 .12 145)" },
    { id: "tomori", label: "Tomori", color: "oklch(.72 .16 28)" },
    { id: "zaya", label: "Zaya", color: "oklch(.72 .15 300)" },
    { id: "locke", label: "Locke", color: "oklch(.43 .16 20)" },
    { id: "temari", label: "Temari", color: "oklch(.55 .17 250)" },
  ];
  const designStorageKey = "tomoribot.dashboard.rememberedDesign";
  let storedDesign = null;
  try {
    const stored = JSON.parse(localStorage.getItem(designStorageKey));
    if (stored && typeof stored === "object" && !Array.isArray(stored)) storedDesign = stored;
  } catch {}
  const rememberDesign = storedDesign !== null;

  const appearance = {
    palette: palettes.some(({ id }) => id === storedDesign?.palette) ? storedDesign.palette : "tomori",
    theme: storedDesign?.theme === "light" ? "light" : "dark",
    surface: storedDesign?.surface === "solid" ? "solid" : "glass",
    colorMode: storedDesign?.colorMode === "reduced" ? "reduced" : "colorful",
    motion: ["subtle", "off"].includes(storedDesign?.motion) ? storedDesign.motion : "full",
    layout: storedDesign?.layout === "full" ? "full" : "boxed",
    personaColors: storedDesign?.personaColors !== false,
    lighting: { dark: { angle: 350, spread: 150, intensity: 50 }, light: { angle: 45, spread: 300, intensity: 50 } },
  };
  for (const theme of ["dark", "light"]) {
    for (const [key, min, max] of [
      ["angle", 0, 359],
      ["spread", 50, 500],
      ["intensity", 0, 200],
    ]) {
      const value = storedDesign?.lighting?.[theme]?.[key];
      if (Number.isFinite(value) && value >= min && value <= max) appearance.lighting[theme][key] = value;
    }
  }

  const applyAppearance = () => {
    document.body.dataset.palette = palettes.some((palette) => palette.id === appearance.palette)
      ? appearance.palette
      : "tomori";
    document.body.dataset.theme = appearance.theme === "light" ? "light" : "dark";
    document.body.dataset.surface = appearance.surface === "solid" ? "solid" : "glass";
    document.body.dataset.colorMode = appearance.colorMode === "reduced" ? "reduced" : "colorful";
    document.body.dataset.motion = ["full", "subtle", "off"].includes(appearance.motion) ? appearance.motion : "full";
    document.body.dataset.layout = appearance.layout;
    const light = appearance.lighting[document.body.dataset.theme];
    document.body.style.setProperty("--glass-angle", `${(light.angle + 180) % 360}deg`);
    document.body.style.setProperty("--light-spread", light.spread / 100);
    document.body.style.setProperty("--light-intensity", light.intensity / 100);
  };

  applyAppearance();
  window.TomoriDesign = { palettes, designStorageKey, appearance, applyAppearance, remembered: rememberDesign };
})();
