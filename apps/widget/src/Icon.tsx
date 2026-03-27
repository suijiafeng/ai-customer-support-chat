import React from 'react';

type IconName = 'smile' | 'zap' | 'image' | 'send' | 'x' | 'message-circle' | 'chevron-down';

const PATHS: Record<IconName, React.ReactNode> = {
  smile: <><circle cx="12" cy="12" r="10" /><path d="M8 13s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></>,
  zap: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
  image: <><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></>,
  send: <><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></>,
  x: <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>,
  'message-circle': <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  'chevron-down': <polyline points="6 9 12 15 18 9" />,
};

interface IconProps {
  name: IconName;
  size?: number;
  style?: React.CSSProperties;
  className?: string;
}

export default function Icon({ name, size = 16, style, className }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
