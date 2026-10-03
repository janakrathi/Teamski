// ==========================================
// SMALL DIAGRAMS FOR THE LANDING PAGE
// ==========================================
//
// One per idea, drawn in SVG and HTML so they stay
// sharp and match the page. Each shows something the
// app really does - no invented numbers or customers.
// The motion is CSS (app/globals.css, "LANDING") and
// stops for reduced motion. Decorative: hidden from
// screen readers, since the text beside each says it.
//

// Order in a demo's play-in (app/globals.css, .t-seq).
const seq = (i: number) => ({ "--i": i }) as React.CSSProperties;

const LINE = "rgba(255,255,255,0.16)";
const FLOW = "rgba(255,255,255,0.55)";

function Node({
  x,
  y,
  width,
  label,
  strong = false,
  order,
}: {
  x: number;
  y: number;
  width: number;
  label: string;
  strong?: boolean;
  order?: number;
}) {
  return (
    <g className={order === undefined ? undefined : "t-seq"} style={order === undefined ? undefined : seq(order)}>
      <rect
        x={x - width / 2}
        y={y - 13}
        width={width}
        height={26}
        rx={7}
        fill="#0a0a0a"
        stroke={strong ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.16)"}
      />

      <text
        x={x}
        y={y + 3.5}
        textAnchor="middle"
        fontSize={10.5}
        fill={strong ? "#ededed" : "#bdbdbd"}
      >
        {label}
      </text>
    </g>
  );
}

function Wire({ d }: { d: string }) {
  return (
    <>
      <path d={d} fill="none" stroke={LINE} />
      <path d={d} fill="none" stroke={FLOW} className="lp-flow" />
    </>
  );
}


// A project, its channels, an agent in each.

export function ChannelTree() {
  const channels = [
    { x: 70, name: "# planning", agent: "Planner" },
    { x: 180, name: "# research", agent: "Research" },
    { x: 290, name: "# meetings", agent: "Meeting notes" },
  ];

  return (
    <svg viewBox="0 0 360 170" aria-hidden="true" className="h-full w-full" style={{ fontFamily: "inherit" }}>
      {channels.map((channel) => (
        <Wire key={channel.x} d={`M180 38 V72 H${channel.x} V97`} />
      ))}

      <Node x={180} y={25} width={124} label="Website launch" strong order={0} />

      {channels.map((channel, index) => (
        <g key={channel.name} className="t-seq" style={seq(index + 1)}>
          <Node x={channel.x} y={110} width={96} label={channel.name} />

          <circle cx={channel.x - 30} cy={146} r={2.5} fill="#c96442" className="lp-blink" />

          <text x={channel.x - 24} y={149} fontSize={9.5} fill="#7a7a7a">
            {channel.agent}
          </text>
        </g>
      ))}
    </svg>
  );
}


// A background task going round: it keeps working,
// can be paused and picked back up.

export function TaskLoop() {
  const stops = [
    { angle: -90, label: "Working", anchor: "middle" as const, dx: 0, dy: -12 },
    { angle: 0, label: "Paused", anchor: "start" as const, dx: 12, dy: 4 },
    { angle: 90, label: "Resumed", anchor: "middle" as const, dx: 0, dy: 20 },
    { angle: 180, label: "Step 3 of 8", anchor: "end" as const, dx: -12, dy: 4 },
  ];

  const cx = 180;
  const cy = 85;
  const r = 52;

  return (
    <svg viewBox="0 0 360 170" aria-hidden="true" className="h-full w-full" style={{ fontFamily: "inherit" }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={LINE} />

      {/* The part of the ring that is "now", going round. */}
      <g className="lp-spin" style={{ transformOrigin: `${cx}px ${cy}px` }}>
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.7)"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeDasharray={`${(2 * Math.PI * r) / 7} ${2 * Math.PI * r}`}
        />
      </g>

      {stops.map((stop) => {
        const radians = (stop.angle * Math.PI) / 180;

        const x = cx + Math.cos(radians) * r;
        const y = cy + Math.sin(radians) * r;

        return (
          <g key={stop.label} className="t-seq" style={seq(stops.indexOf(stop))}>
            <circle cx={x} cy={y} r={4} fill="#0a0a0a" stroke="rgba(255,255,255,0.45)" />

            <text x={x + stop.dx} y={y + stop.dy} textAnchor={stop.anchor} fontSize={10} fill="#a3a3a3">
              {stop.label}
            </text>
          </g>
        );
      })}

      <text x={cx} y={cy - 2} textAnchor="middle" fontSize={11} fill="#ededed">
        Background task
      </text>

      <text x={cx} y={cy + 13} textAnchor="middle" fontSize={9} fill="#6f6f6f">
        tab closed · still going
      </text>
    </svg>
  );
}


// What the agent did, and the one thing waiting for
// a person.

export function ApprovalLog() {
  const rows = [
    { time: "09:12", what: "Read plan.md", state: "done" },
    { time: "09:12", what: "Linear: list projects", state: "done" },
    { time: "09:13", what: "Drafted 6 tasks", state: "done" },
  ];

  return (
    <div aria-hidden="true" className="w-full max-w-[330px] overflow-hidden rounded-lg border border-white/10 bg-[#0a0a0a] text-[10.5px]">
      <div className="t-seq flex items-center gap-2 border-b border-white/10 px-3 py-2 text-white/50" style={seq(0)}>
        <span className="text-white/80"># planning</span>
        <span>activity</span>
        <span className="ml-auto flex items-center gap-1.5 text-[#c96442]">
          <span className="lp-blink h-1.5 w-1.5 rounded-full bg-[#c96442]" />
          waiting on you
        </span>
      </div>

      <div className="divide-y divide-white/5 font-mono">
        {rows.map((row, index) => (
          <div key={row.what} className="t-seq flex items-center gap-3 px-3 py-1.5" style={seq(index + 1)}>
            <span className="text-white/30">{row.time}</span>
            <span className="min-w-0 flex-1 truncate text-white/70">{row.what}</span>
            <span className="text-white/35">✓</span>
          </div>
        ))}

        <div className="t-seq flex items-center gap-3 bg-white/[0.03] px-3 py-2" style={seq(rows.length + 1)}>
          <span className="text-white/30">09:13</span>
          <span className="min-w-0 flex-1 truncate text-white/90">Linear: create 6 issues</span>
          <span className="lp-pulse rounded bg-[#ededed] px-1.5 py-0.5 font-sans text-[9.5px] font-medium text-black">
            Approve
          </span>
        </div>
      </div>
    </div>
  );
}


// One message, the model that suits it.

export function ModelRouter() {
  const models = [
    { x: 52, name: "Built-in", note: "every plan" },
    { x: 137, name: "Gemini", note: "free key" },
    { x: 223, name: "Claude", note: "your key" },
    { x: 308, name: "GPT", note: "your key" },
  ];

  return (
    <svg viewBox="0 0 360 170" aria-hidden="true" className="h-full w-full" style={{ fontFamily: "inherit" }}>
      {models.map((model) => (
        <Wire key={model.x} d={`M180 51 V82 H${model.x} V113`} />
      ))}

      <Node x={180} y={38} width={132} label="Each channel picks" strong order={0} />

      {models.map((model, index) => (
        <g key={model.name} className="t-seq" style={seq(index + 1)}>
          <Node x={model.x} y={126} width={74} label={model.name} />

          <text x={model.x} y={156} textAnchor="middle" fontSize={9} fill="#6f6f6f">
            {model.note}
          </text>
        </g>
      ))}
    </svg>
  );
}
