import React from 'react';

interface LogoMarkProps {
  className?: string;
}

/**
 * Custom geometric brand mark for Coding Harness:
 * Two precision code chevrons linked by a cobalt-blue harness bridge.
 */
export function LogoMark({ className = 'w-8 h-8' }: LogoMarkProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="ch-bg" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#171b26" />
          <stop offset="100%" stopColor="#0c0e14" />
        </linearGradient>
        <linearGradient id="ch-rim" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.08" />
        </linearGradient>
      </defs>

      {/* Outer squircle frame */}
      <rect x="0.75" y="0.75" width="30.5" height="30.5" rx="8.25" fill="url(#ch-bg)" stroke="url(#ch-rim)" strokeWidth="1.25" />

      {/* Left code chevron */}
      <path
        d="M12.25 10.25L6.75 16L12.25 21.75"
        stroke="#FAFAFA"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Right code chevron */}
      <path
        d="M19.75 10.25L25.25 16L19.75 21.75"
        stroke="#FAFAFA"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Cobalt-blue harness link bar + anchor nodes */}
      <path
        d="M12.25 16H19.75"
        stroke="#3B82F6"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="16" cy="16" r="2.1" fill="#60A5FA" />
    </svg>
  );
}
