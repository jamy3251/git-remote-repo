import { useEffect, useRef, useState, useCallback } from "react";

type Direction = "left" | "right" | "down" | "up";
type CharState = "walk" | "idle" | "sit" | "drag";

const WALK_SPEED = 0.6;
const IDLE_MIN = 2000;
const IDLE_MAX = 5000;
const DRAG_THRESHOLD = 8; // px moved before it counts as drag (not click)

interface Props {
  id: string;
  name: string;
  color: string;
  status: string;
  initialX: number;
  initialY: number;
  bounds: { width: number; height: number };
  onClick: () => void;
  onDrop?: (x: number, y: number) => void;
  seated?: boolean;
  suggestion?: string | null; // latest pending suggestion to show as bubble
  agentType?: string; // "web" | "cli"
}

export function PixelCharacter({
  id,
  name,
  color,
  status,
  initialX,
  initialY,
  bounds,
  onClick,
  onDrop,
  seated,
  suggestion,
  agentType,
}: Props) {
  const [pos, setPos] = useState({ x: initialX, y: initialY });
  const [charState, setCharState] = useState<CharState>(seated ? "sit" : "idle");
  const [direction, setDirection] = useState<Direction>("down");
  const [frame, setFrame] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const dragStart = useRef({ x: 0, y: 0 });
  const didDrag = useRef(false);
  const animRef = useRef<number>(0);
  const stateTimer = useRef<ReturnType<typeof setTimeout>>();
  const targetPos = useRef<{ x: number; y: number } | null>(null);

  // Sync pos when seated state changes externally
  useEffect(() => {
    if (seated) {
      setCharState("sit");
      targetPos.current = null;
    }
  }, [seated]);

  // Animation frame loop
  useEffect(() => {
    let lastTime = 0;
    const animate = (time: number) => {
      if (lastTime === 0) lastTime = time;
      lastTime = time;
      setFrame((f) => (f + 1) % 4);

      if (charState === "walk" && targetPos.current && !isDragging) {
        setPos((prev) => {
          const dx = targetPos.current!.x - prev.x;
          const dy = targetPos.current!.y - prev.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 2) {
            targetPos.current = null;
            setCharState("idle");
            return prev;
          }

          const nx = prev.x + (dx / dist) * WALK_SPEED;
          const ny = prev.y + (dy / dist) * WALK_SPEED;

          if (Math.abs(dx) > Math.abs(dy)) {
            setDirection(dx > 0 ? "right" : "left");
          } else {
            setDirection(dy > 0 ? "down" : "up");
          }

          return {
            x: Math.max(16, Math.min(bounds.width - 48, nx)),
            y: Math.max(60, Math.min(bounds.height - 48, ny)),
          };
        });
      }

      animRef.current = requestAnimationFrame(animate);
    };
    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, [charState, isDragging, bounds]);

  // State machine: idle -> walk -> idle (skip if seated or dragging)
  useEffect(() => {
    if (isDragging || seated || charState === "sit") return;

    const scheduleNext = () => {
      if (charState === "idle") {
        const delay = IDLE_MIN + Math.random() * (IDLE_MAX - IDLE_MIN);
        stateTimer.current = setTimeout(() => {
          const tx = 32 + Math.random() * (bounds.width - 80);
          const ty = 80 + Math.random() * (bounds.height - 120);
          targetPos.current = { x: tx, y: ty };
          setCharState("walk");
        }, delay);
      } else if (charState === "walk" && !targetPos.current) {
        stateTimer.current = setTimeout(() => setCharState("idle"), 500);
      }
    };
    scheduleNext();
    return () => clearTimeout(stateTimer.current);
  }, [charState, isDragging, bounds, seated]);

  // --- Pointer handlers with proper drag/click separation ---
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    dragStart.current = { x: e.clientX, y: e.clientY };
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    didDrag.current = false;
    setIsDragging(true);
    setCharState("drag");
    targetPos.current = null;
  }, [pos.x, pos.y]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    e.preventDefault();

    const totalDx = Math.abs(e.clientX - dragStart.current.x);
    const totalDy = Math.abs(e.clientY - dragStart.current.y);

    if (totalDx > DRAG_THRESHOLD || totalDy > DRAG_THRESHOLD) {
      didDrag.current = true;
    }

    if (didDrag.current) {
      const nx = e.clientX - dragOffset.current.x;
      const ny = e.clientY - dragOffset.current.y;
      setPos({
        x: Math.max(16, Math.min(bounds.width - 48, nx)),
        y: Math.max(60, Math.min(bounds.height - 48, ny)),
      });
    }
  }, [isDragging, bounds]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);

    if (!didDrag.current) {
      // It was a tap/click, not a drag
      setCharState("idle");
      onClick();
    } else {
      // It was a real drag
      setCharState("idle");
      onDrop?.(pos.x, pos.y);
    }
  }, [isDragging, onClick, onDrop, pos.x, pos.y]);

  // Rendering
  const walkOffset = charState === "walk" ? (frame % 2 === 0 ? -1 : 1) : 0;
  const dragScale = isDragging && didDrag.current ? 1.2 : 1;
  const shadowSize = isDragging && didDrag.current ? 20 : 14;
  const isSitting = charState === "sit";

  const STATUS_EMOJI: Record<string, string> = {
    idle: "",
    working: "...",
    done: "!",
    error: "?!",
  };

  return (
    <div
      style={{
        position: "absolute",
        left: pos.x,
        top: pos.y,
        transform: `scale(${dragScale})`,
        transition: isDragging ? "transform 0.1s" : "transform 0.2s",
        zIndex: isDragging ? 1000 : Math.floor(pos.y),
        cursor: isDragging ? "grabbing" : "pointer",
        touchAction: "none",
        userSelect: "none",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Shadow */}
      <div
        style={{
          position: "absolute",
          bottom: isSitting ? 2 : -4,
          left: "50%",
          transform: "translateX(-50%)",
          width: shadowSize,
          height: 6,
          background: "rgba(0,0,0,0.3)",
          borderRadius: "50%",
        }}
      />

      {/* Character body */}
      <div
        style={{
          width: 32,
          height: isSitting ? 30 : 40,
          position: "relative",
          imageRendering: "pixelated",
          transform: `translateY(${isSitting ? 0 : walkOffset}px) ${direction === "left" ? "scaleX(-1)" : ""}`,
        }}
      >
        {/* Head */}
        <div style={{ width: 20, height: 20, background: "#FFD5B0", border: `2px solid ${color}`, position: "absolute", top: 0, left: 6 }} />
        {/* Eyes */}
        <div style={{ position: "absolute", top: 8, left: direction === "up" ? -100 : 10, width: 3, height: 3, background: "#333", boxShadow: "8px 0 0 #333" }} />
        {/* Hair */}
        <div style={{ width: 22, height: 8, background: color, position: "absolute", top: -2, left: 5 }} />
        {/* Body */}
        <div style={{ width: 18, height: 14, background: color, position: "absolute", top: 20, left: 7, opacity: 0.9 }} />
        {/* Legs */}
        {!isSitting ? (
          <>
            <div style={{ position: "absolute", top: 34, left: charState === "walk" ? (frame % 2 === 0 ? 8 : 12) : 9, width: 5, height: 6, background: "#555" }} />
            <div style={{ position: "absolute", top: 34, left: charState === "walk" ? (frame % 2 === 0 ? 18 : 14) : 18, width: 5, height: 6, background: "#555" }} />
          </>
        ) : (
          /* Sitting: legs bent forward */
          <div style={{ position: "absolute", top: 30, left: 7, width: 18, height: 4, background: "#555" }} />
        )}
      </div>

      {/* Name tag */}
      <div style={{ position: "absolute", top: -18, left: "50%", transform: "translateX(-50%)", background: "rgba(0,0,0,0.7)", color: color, padding: "1px 6px", fontSize: 10, fontFamily: "'DungGeunMo', monospace", whiteSpace: "nowrap", border: `1px solid ${color}` }}>
        {name}
        {STATUS_EMOJI[status] && (
          <span style={{ marginLeft: 3, color: status === "working" ? "#e2b714" : status === "done" ? "#4ade80" : status === "error" ? "#e94560" : undefined }}>
            {STATUS_EMOJI[status]}
          </span>
        )}
      </div>

      {/* Working bubble */}
      {status === "working" && !isDragging && (
        <div style={{ position: "absolute", top: -36, left: "50%", transform: "translateX(-50%)", fontSize: 16, animation: "blink 1s step-start infinite" }}>
          &#x1F4AD;
        </div>
      )}

      {/* Suggestion bubble */}
      {suggestion && !isDragging && status !== "working" && (
        <div style={{
          position: "absolute",
          top: -58,
          left: "50%",
          transform: "translateX(-50%)",
          background: "#f5f0e0",
          color: "#333",
          border: `2px solid ${color}`,
          padding: "3px 8px",
          fontSize: 9,
          fontFamily: "'DungGeunMo', monospace",
          maxWidth: 140,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          boxShadow: "2px 2px 0 rgba(0,0,0,0.3)",
          zIndex: 50,
        }}>
          <span style={{ color, marginRight: 3 }}>TIP</span>
          {suggestion.length > 25 ? suggestion.slice(0, 25) + "..." : suggestion}
          <div style={{
            position: "absolute",
            bottom: -6,
            left: "50%",
            transform: "translateX(-50%)",
            width: 0, height: 0,
            borderLeft: "5px solid transparent",
            borderRight: "5px solid transparent",
            borderTop: `6px solid ${color}`,
          }} />
        </div>
      )}

      {/* CLI badge */}
      {agentType === "cli" && !isDragging && (
        <div style={{
          position: "absolute",
          bottom: -14,
          left: "50%",
          transform: "translateX(-50%)",
          background: "#333",
          color: "#4ade80",
          padding: "0 4px",
          fontSize: 8,
          fontFamily: "'DungGeunMo', monospace",
          border: "1px solid #4ade80",
          whiteSpace: "nowrap",
        }}>
          CLI
        </div>
      )}
    </div>
  );
}
