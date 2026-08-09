import type { CSSProperties } from "react";
import { getProviderIcon, providerTileStyle } from "./providerIcons";

interface Props {
  providerId: string;
  size?: number;
  className?: string;
  title?: string;
  /**
   * Paint the brand tile around the mark. Use it wherever the icon stands on
   * its own; surfaces that already render their own `.provider-tile` wrapper
   * (tray cards, the footer switcher, the spend table) leave this off and
   * spread `providerTileStyle()` on that wrapper instead.
   */
  tile?: boolean;
}

/** Share of the tile the brand mark occupies when `tile` draws the badge. */
const GLYPH_RATIO = 0.62;

/**
 * Renders a provider brand icon. The bundled SVGs are flattened to a single
 * ink (see `tint`), so the mark always picks up `currentColor`: the brand
 * color when it stands alone, or the tile's contrast ink inside a badge.
 * Providers without an asset fall back to a letter in the same slot.
 */
export function ProviderIcon({
  providerId,
  size = 22,
  className,
  title,
  tile = false,
}: Props) {
  const entry = getProviderIcon(providerId);
  const glyph = tile ? Math.round(size * GLYPH_RATIO) : size;
  const style: CSSProperties = {
    width: glyph,
    height: glyph,
    ["--provider-brand" as string]: entry.brandColor,
  };

  const mark = entry.svgPath ? (
    <span
      className={`provider-icon provider-icon--svg${!tile && className ? " " + className : ""}`}
      style={style}
      title={tile ? undefined : title}
      aria-hidden={!tile && title ? undefined : true}
      // eslint-disable-next-line react/no-danger -- SVGs are bundled locally, no user input.
      dangerouslySetInnerHTML={{ __html: entry.svgPath }}
    />
  ) : (
    <span
      className={`provider-icon provider-icon--letter${!tile && className ? " " + className : ""}`}
      style={{ ...style, fontSize: Math.max(9, Math.round(glyph * 0.82)) }}
      title={tile ? undefined : title}
      aria-hidden={!tile && title ? undefined : true}
    >
      {entry.fallbackLetter}
    </span>
  );

  if (!tile) return mark;

  return (
    <span
      className={`provider-tile${className ? " " + className : ""}`}
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(4, Math.round(size * 0.29)),
        ...providerTileStyle(providerId),
      } as CSSProperties}
      title={title}
      aria-hidden={title ? undefined : true}
    >
      {mark}
    </span>
  );
}
