import { useGameState, type MapLayer } from "../../stores/gameState";

const LAYERS: { id: MapLayer; label: string; icon: string }[] = [
  { id: "default", label: "Map", icon: "\u{1F5FA}" },
  { id: "cost", label: "Cost", icon: "\u{1F4B0}" },
  { id: "errors", label: "Errors", icon: "\u26A0" },
  { id: "activity", label: "Activity", icon: "\u23F1" },
  { id: "fog", label: "Fog", icon: "\u{1F32B}" },
];

const btnBase: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  padding: "4px 8px",
  border: "1px solid #3f4147",
  borderRadius: 4,
  background: "#2b2d31",
  color: "#8b9aab",
  fontFamily: "monospace",
  fontSize: 11,
  cursor: "pointer",
  transition: "background 0.15s, color 0.15s, border-color 0.15s",
};

const btnActive: React.CSSProperties = {
  ...btnBase,
  background: "#3a3a3a",
  color: "#dbdee1",
  borderColor: "#5b8abf",
  boxShadow: "0 0 6px rgba(91,138,191,0.3)",
};

export function LayerControls() {
  const activeLayer = useGameState((s) => s.activeLayer);
  const setActiveLayer = useGameState((s) => s.setActiveLayer);

  return (
    <div
      style={{
        position: "absolute",
        top: 8,
        right: 8,
        display: "flex",
        gap: 4,
        zIndex: 10,
        pointerEvents: "auto",
      }}
    >
      {LAYERS.map((l) => (
        <button
          key={l.id}
          style={activeLayer === l.id ? btnActive : btnBase}
          onClick={() => setActiveLayer(l.id)}
          title={l.label}
        >
          <span>{l.icon}</span>
          <span>{l.label}</span>
        </button>
      ))}
    </div>
  );
}
