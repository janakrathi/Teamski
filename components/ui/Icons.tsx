// ==========================================
// ICONS
// ==========================================
//
// One family, one weight. Every icon is a
// 24-unit square drawn with a 1.5 stroke and
// no fill, so they sit at the same visual
// weight as the text beside them.
//

type IconProps = {
  className?: string;
};

function Svg({
  className,
  children,
}: IconProps & {
  children: React.ReactNode;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "h-4 w-4"}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}


export function ChevronDown(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  );
}

export function ChevronRight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m9 6 6 6-6 6" />
    </Svg>
  );
}

export function Plus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function Check(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m4 12 5 5L20 6" />
    </Svg>
  );
}

export function Hash(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 4 8 20M16 4l-2 16M4.5 9h15M3.5 15h15" />
    </Svg>
  );
}

export function Sparkle(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.5 13.7 9l5.3 1.7-5.3 1.7L12 18l-1.7-5.6L5 10.7 10.3 9 12 3.5Z" />
    </Svg>
  );
}

export function Settings(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3" />
    </Svg>
  );
}

export function Brain(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5.5a2.5 2.5 0 0 0-4.9-.6A2.6 2.6 0 0 0 5 9.4a2.6 2.6 0 0 0 .6 4.4A2.5 2.5 0 0 0 8 18a2.5 2.5 0 0 0 4-.7Z" />
      <path d="M12 5.5a2.5 2.5 0 0 1 4.9-.6A2.6 2.6 0 0 1 19 9.4a2.6 2.6 0 0 1-.6 4.4A2.5 2.5 0 0 1 16 18a2.5 2.5 0 0 1-4-.7Z" />
      <path d="M12 5.5v11.8" />
    </Svg>
  );
}

export function Trash(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7" />
      <path d="M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7" />
    </Svg>
  );
}

export function Close(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}

export function Sidebar(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M9.5 4.5v15" />
    </Svg>
  );
}

export function Clock(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Svg>
  );
}

export function Menu(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  );
}

export function Search(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </Svg>
  );
}

export function Paperclip(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M17.5 9.5 10 17a3.5 3.5 0 0 1-5-5l7.8-7.8a2.5 2.5 0 0 1 3.6 3.6l-7.7 7.7a1.5 1.5 0 0 1-2.2-2.1l7-7" />
    </Svg>
  );
}

export function Bell(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6.5 9.5a5.5 5.5 0 0 1 11 0c0 3.2.7 5 1.5 6H5c.8-1 1.5-2.8 1.5-6Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </Svg>
  );
}

export function Download(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 4v11m0 0 4-4m-4 4-4-4" />
      <path d="M5 19h14" />
    </Svg>
  );
}

export function Stop(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
    </Svg>
  );
}

export function ArrowUp(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 19V5m0 0-6 6m6-6 6 6" />
    </Svg>
  );
}
