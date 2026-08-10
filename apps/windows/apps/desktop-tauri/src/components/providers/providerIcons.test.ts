import { describe, expect, it } from "vitest";
import { TEST_PROVIDER_CATALOG } from "../../test/providerCatalog";
import { PROVIDER_ICON_REGISTRY } from "./providerIcons";

describe("provider icon registry", () => {
  it("has explicit icon metadata for every provider in the catalog", () => {
    for (const [id] of TEST_PROVIDER_CATALOG) {
      expect(PROVIDER_ICON_REGISTRY[id], id).toBeDefined();
    }
  });

  it("renders Grok as a transparent single-ink mark instead of a solid tile", () => {
    const svg = PROVIDER_ICON_REGISTRY.grok.svgPath;

    expect(svg).toBeDefined();
    expect(svg).toContain('fill="currentColor"');
    expect(svg).not.toContain("<rect");
  });
});
