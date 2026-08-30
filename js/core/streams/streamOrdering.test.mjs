import test from "node:test";
import assert from "node:assert/strict";

import { orderSourceNames, orderStreamsByAddonOrder } from "./streamOrdering.js";

function stream(addonName, { addonId, kind = "addon", direct = false, orderIndex } = {}) {
  return {
    addonName,
    addonId: addonId || addonName,
    addonOrderIndex: orderIndex,
    direct,
    streamOrigin: {
      kind,
      addonId: addonId || addonName,
      addonName
    }
  };
}

const isDirectDebrid = (item) => item.direct === true;

test("reorders completion-order streams by the saved addon order", () => {
  const addonA = stream("Addon A", { addonId: "a" });
  const addonB = stream("Addon B", { addonId: "b" });
  const plugin = stream("Plugin", { kind: "plugin", addonId: "plugin" });

  const ordered = orderStreamsByAddonOrder(
    [addonB, plugin, addonA],
    [
      { name: "Addon A", orderIndex: 0 },
      { name: "Addon B", orderIndex: 1 }
    ],
    { isDirectDebrid }
  );

  assert.deepEqual(
    ordered.map((item) => item.addonName),
    ["Addon A", "Addon B", "Plugin"]
  );
});

test("puts a direct-Debrid group before installed addons and plugins", () => {
  const regularAddon = stream("Addon A", { addonId: "a" });
  const directAddon = stream("Addon B", { addonId: "b", direct: true });
  const plugin = stream("Plugin", { kind: "plugin", addonId: "plugin" });

  const ordered = orderStreamsByAddonOrder(
    [regularAddon, plugin, directAddon],
    [
      { name: "Addon A", orderIndex: 0 },
      { name: "Addon B", orderIndex: 1 }
    ],
    { isDirectDebrid }
  );

  assert.deepEqual(
    ordered.map((item) => item.addonName),
    ["Addon B", "Addon A", "Plugin"]
  );
});

test("moves a mixed direct-Debrid source as one Android-style group", () => {
  const regularAddon = stream("Addon A", { addonId: "a" });
  const directPart = stream("Addon B", { addonId: "b", direct: true });
  const regularPart = stream("Addon B", { addonId: "b" });

  const ordered = orderStreamsByAddonOrder(
    [regularAddon, directPart, regularPart],
    [
      { name: "Addon A", orderIndex: 0 },
      { name: "Addon B", orderIndex: 1 }
    ],
    { isDirectDebrid }
  );

  assert.deepEqual(
    ordered.map((item) => `${item.addonName}:${item.direct ? "direct" : "regular"}`),
    ["Addon B:direct", "Addon B:regular", "Addon A:regular"]
  );
});

test("keeps plugin groups in arrival order even when plugin chips exist", () => {
  const addon = stream("Addon A", { addonId: "a" });
  const pluginB = stream("Plugin B", { kind: "plugin", addonId: "plugin-b" });
  const pluginA = stream("Plugin A", { kind: "plugin", addonId: "plugin-a" });

  const ordered = orderStreamsByAddonOrder(
    [pluginB, addon, pluginA],
    [
      { name: "Addon A", orderIndex: 0 },
      { name: "Plugin A", orderIndex: Number.MAX_SAFE_INTEGER },
      { name: "Plugin B", orderIndex: Number.MAX_SAFE_INTEGER }
    ],
    { isDirectDebrid }
  );

  assert.deepEqual(
    ordered.map((item) => item.addonName),
    ["Addon A", "Plugin B", "Plugin A"]
  );
});

test("uses source metadata order when a player candidate lacks the top-level rank", () => {
  const addonA = stream("Addon A", { addonId: "a", orderIndex: 0 });
  const addonB = stream("Addon B", { addonId: "b", orderIndex: 1 });
  delete addonA.addonOrderIndex;
  delete addonB.addonOrderIndex;
  addonA.streamOrigin.addonOrderIndex = 0;
  addonB.streamOrigin.addonOrderIndex = 1;

  const ordered = orderStreamsByAddonOrder([addonB, addonA], [], { isDirectDebrid });

  assert.deepEqual(
    ordered.map((item) => item.addonName),
    ["Addon A", "Addon B"]
  );
});

test("puts filter names in the same order as returned Android groups", () => {
  const regularAddon = stream("Addon A", { addonId: "a" });
  const directAddon = stream("Addon B", { addonId: "b", direct: true });

  const ordered = orderSourceNames(
    [regularAddon, directAddon],
    [
      { name: "Addon A", orderIndex: 0 },
      { name: "Addon B", orderIndex: 1 },
      { name: "Addon C", orderIndex: 2 }
    ],
    { isDirectDebrid }
  );

  assert.deepEqual(ordered, ["Addon B", "Addon A", "Addon C"]);
});
