import OBR, { buildShape, isImage, type Item } from "@owlbear-rodeo/sdk";

// Keys used by Battle Board (read-only — never write to these)
const BB_META_KEY = "com.missing-link-dev.battle-board/metadata";
const BB_SCENE_KEY = "com.missing-link-dev.battle-board/sceneState";

// Key this extension stamps on the shapes it creates
const MY_META_KEY = "com.cdelashmutt.turn-highlighter/highlight";

// Settings persisted to room metadata
const SETTINGS_KEY = "com.cdelashmutt.turn-highlighter/settings";

interface BattleBoardMeta {
  active: boolean;
  [key: string]: unknown;
}

interface SceneState {
  started: boolean;
  [key: string]: unknown;
}

interface HighlightMeta {
  ownerId: string;
}

interface Settings {
  enabled: boolean;
  color: string;
  strokeWidth: number;
}

const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  color: "#ffd700",
  strokeWidth: 10,
};

let currentSettings: Settings = { ...DEFAULT_SETTINGS };

// --- Debounce ---

let syncTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSyncHighlights() {
  if (syncTimer !== null) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    syncHighlights().catch((err) => {
      console.error("[TurnHighlighter] syncHighlights error:", err);
    });
  }, 50);
}

// --- Settings helpers ---

async function loadSettings(): Promise<Settings> {
  try {
    const meta = await OBR.room.getMetadata();
    const stored = (meta as Record<string, unknown>)[SETTINGS_KEY];
    if (stored && typeof stored === "object") {
      return { ...DEFAULT_SETTINGS, ...(stored as Partial<Settings>) };
    }
  } catch {
    // Room metadata unavailable; use defaults
  }
  return { ...DEFAULT_SETTINGS };
}

async function saveSettings(settings: Settings): Promise<void> {
  try {
    await OBR.room.setMetadata({ [SETTINGS_KEY]: settings });
  } catch {
    // Best-effort; ignore errors
  }
}

// --- Scene helpers ---

function getActiveMeta(item: Item): BattleBoardMeta | null {
  const meta = (item.metadata as Record<string, unknown>)[BB_META_KEY];
  if (meta && typeof meta === "object" && (meta as BattleBoardMeta).active === true) {
    return meta as BattleBoardMeta;
  }
  return null;
}

async function isCombatStarted(): Promise<boolean> {
  try {
    const sceneMeta = await OBR.scene.getMetadata();
    const state = (sceneMeta as Record<string, unknown>)[BB_SCENE_KEY] as SceneState | undefined;
    return state?.started === true;
  } catch {
    return false;
  }
}

function getTokenFootprintPx(token: Item): { w: number; h: number } {
  if (isImage(token)) {
    const img = token as unknown as {
      image?: { width?: number; height?: number };
      scale?: { x?: number; y?: number };
    };
    const naturalW = img.image?.width ?? 0;
    const naturalH = img.image?.height ?? 0;
    if (naturalW > 0 && naturalH > 0) {
      const scaleX = Math.abs(img.scale?.x ?? 1);
      const scaleY = Math.abs(img.scale?.y ?? 1);
      return { w: naturalW * scaleX, h: naturalH * scaleY };
    }
  }
  // Fallback: assume a standard 1-cell token at 150 dpi
  return { w: 150, h: 150 };
}

// --- Highlight management ---

async function removeAllHighlights(items: Item[]): Promise<void> {
  const ids = items
    .filter((it) => MY_META_KEY in (it.metadata as Record<string, unknown>))
    .map((it) => it.id);
  if (ids.length > 0) {
    await OBR.scene.items.deleteItems(ids);
  }
}

async function syncHighlights(): Promise<void> {
  if (!currentSettings.enabled) {
    // Clean up any existing highlights and bail
    const allItems = await OBR.scene.items.getItems();
    await removeAllHighlights(allItems);
    return;
  }

  const started = await isCombatStarted();
  const allItems = await OBR.scene.items.getItems();

  if (!started) {
    await removeAllHighlights(allItems);
    return;
  }

  const activeTokens = allItems.filter((it) => getActiveMeta(it) !== null);
  const activeIds = new Set(activeTokens.map((t) => t.id));

  const existingHighlights = allItems.filter(
    (it) => MY_META_KEY in (it.metadata as Record<string, unknown>)
  );

  // Delete highlights whose owner is no longer active
  const staleIds = existingHighlights
    .filter((h) => {
      const hMeta = (h.metadata as Record<string, unknown>)[MY_META_KEY] as HighlightMeta;
      return !activeIds.has(hMeta.ownerId);
    })
    .map((h) => h.id);

  if (staleIds.length > 0) {
    await OBR.scene.items.deleteItems(staleIds);
  }

  // Build a lookup from ownerId -> existing highlight
  const highlightByOwner = new Map<string, Item>();
  for (const h of existingHighlights) {
    const hMeta = (h.metadata as Record<string, unknown>)[MY_META_KEY] as HighlightMeta;
    if (!staleIds.includes(h.id)) {
      highlightByOwner.set(hMeta.ownerId, h);
    }
  }

  const toAdd: ReturnType<typeof buildShape>[] = [];
  const toUpdateIds: string[] = [];
  const toUpdateSizes: Array<{ w: number; h: number }> = [];

  for (const token of activeTokens) {
    const { w, h } = getTokenFootprintPx(token);
    const ringW = w * 1.15;
    const ringH = h * 1.15;
    const existing = highlightByOwner.get(token.id);

    if (existing) {
      toUpdateIds.push(existing.id);
      toUpdateSizes.push({ w: ringW, h: ringH });
    } else {
      const shape = buildShape()
        .shapeType("CIRCLE")
        .width(ringW)
        .height(ringH)
        .position(token.position)
        .fillOpacity(0)
        .strokeColor(currentSettings.color)
        .strokeWidth(currentSettings.strokeWidth)
        .strokeOpacity(1)
        .attachedTo(token.id)
        .locked(true)
        .disableHit(true)
        .layer("DRAWING")
        .visible(true)
        .metadata({ [MY_META_KEY]: { ownerId: token.id } satisfies HighlightMeta })
        .build();
      toAdd.push(shape as unknown as ReturnType<typeof buildShape>);
    }
  }

  if (toUpdateIds.length > 0) {
    await OBR.scene.items.updateItems(toUpdateIds, (items) => {
      items.forEach((item, i) => {
        const size = toUpdateSizes[i];
        if (!size) return;
        // Update dimensions and stroke style in case settings changed
        const shape = item as unknown as {
          width: number;
          height: number;
          style: { strokeColor: string; strokeWidth: number };
        };
        shape.width = size.w;
        shape.height = size.h;
        shape.style.strokeColor = currentSettings.color;
        shape.style.strokeWidth = currentSettings.strokeWidth;
      });
    });
  }

  if (toAdd.length > 0) {
    await OBR.scene.items.addItems(toAdd as unknown as Item[]);
  }
}

// --- Settings UI ---

function initSettingsUI(): void {
  const enabledInput = document.getElementById("enabled") as HTMLInputElement | null;
  const colorInput = document.getElementById("color") as HTMLInputElement | null;
  const widthInput = document.getElementById("width") as HTMLInputElement | null;
  const widthValue = document.getElementById("width-value") as HTMLElement | null;

  if (!enabledInput || !colorInput || !widthInput || !widthValue) return;

  // Populate UI from loaded settings
  enabledInput.checked = currentSettings.enabled;
  colorInput.value = currentSettings.color;
  widthInput.value = String(currentSettings.strokeWidth);
  widthValue.textContent = String(currentSettings.strokeWidth);

  const persist = () => {
    currentSettings = {
      enabled: enabledInput.checked,
      color: colorInput.value,
      strokeWidth: Number(widthInput.value),
    };
    saveSettings(currentSettings).catch(() => {});
    scheduleSyncHighlights();
  };

  enabledInput.addEventListener("change", persist);
  colorInput.addEventListener("input", persist);
  widthInput.addEventListener("input", () => {
    widthValue.textContent = widthInput.value;
    persist();
  });
}

// --- Entry point ---

OBR.onReady(async () => {
  currentSettings = await loadSettings();
  initSettingsUI();

  // Initial sync
  scheduleSyncHighlights();

  // Re-sync whenever scene items change (token added/moved/removed, turn advanced)
  OBR.scene.items.onChange(() => scheduleSyncHighlights());

  // Re-sync when scene metadata changes (combat started/stopped, round changed)
  OBR.scene.onMetadataChange(() => scheduleSyncHighlights());

  // Re-sync when room metadata changes (our own settings updated from another client)
  OBR.room.onMetadataChange(async () => {
    currentSettings = await loadSettings();
    initSettingsUI();
    scheduleSyncHighlights();
  });
});
