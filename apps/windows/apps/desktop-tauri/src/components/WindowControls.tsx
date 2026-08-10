/**
 * Windows caption glyphs.
 *
 * The shell draws its own title bars (native decorations are off so the warm
 * theme survives), so the caption buttons have to be redrawn too. These match
 * the Segoe Fluent Icons metrics Windows 11 uses — a 10x10 glyph box, 1px
 * strokes, square corners — rather than the macOS traffic lights this app
 * previously shipped on both platforms.
 */
export type WinGlyphKind = "minimize" | "maximize" | "restore" | "close";

export function WinGlyph({ kind }: { kind: WinGlyphKind }) {
  return (
    <svg
      className="win-caption-glyph"
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      shapeRendering="crispEdges"
      aria-hidden
      focusable="false"
    >
      {kind === "minimize" && <path d="M0.5 5.5h9" />}
      {kind === "maximize" && <rect x="0.5" y="0.5" width="9" height="9" />}
      {kind === "restore" && (
        <>
          <rect x="0.5" y="2.5" width="7" height="7" />
          <path d="M2.5 2.5v-2h7v7h-2" />
        </>
      )}
      {kind === "close" && <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />}
    </svg>
  );
}
