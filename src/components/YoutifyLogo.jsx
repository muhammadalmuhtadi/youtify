import React from 'react';

const VARIANTS = {
  green: { bg: '#1ED760', fg: '#000000' },
  white: { bg: '#FFFFFF', fg: '#000000' },
  red: { bg: '#FF0000', fg: '#FFFFFF' },
  dark: { bg: '#181818', fg: '#1ED760' },
};

export default function YoutifyLogo({
  className = 'w-8 h-8',
  variant = 'green',
  title = 'Youtify Logo',
}) {
  const palette = VARIANTS[variant] || VARIANTS.green;

  return (
    <svg
      viewBox="0 0 40 40"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : 'true'}
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="20" cy="20" r="19" fill={palette.bg} />
      {/* Play triangle */}
      <path
        d="M14.5 10.2 C14.5 9.1 15.7 8.4 16.7 9 L30.2 17.3 C31.1 17.9 31.1 19.1 30.2 19.7 L16.7 28 C15.7 28.6 14.5 27.9 14.5 26.8 Z"
        fill={palette.fg}
      />
      {/* Letter Y carved inside Play button */}
      <path
        d="M17.2 14.2 L20.6 18.8 L24 14.2 M20.6 18.8 L20.6 23.6"
        fill="none"
        stroke={palette.bg}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
