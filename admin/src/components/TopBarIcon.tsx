import type { ReactNode } from 'react';
import styled from 'styled-components';

/**
 * The chat's top-bar controls.
 *
 * Ported from the reference plugin's `ToggleSidebarBtn` in Chat.tsx — same
 * 32x32 square, same 16px icon, same hover treatment — and the SVGs below are
 * its own, so the two panels read alike. Colours come from the Strapi theme
 * rather than the reference's literal hexes, as everywhere else in this port,
 * so the bar survives dark mode.
 *
 * THE TOOLTIP IS AN ADDITION. The reference labels these for screen readers
 * only, which leaves a sighted user hovering an unlabelled square. It appears
 * after 0.5s: instantly would make it flicker as the pointer crosses the bar,
 * and the delay is only on the way IN — leaving is immediate, so moving along
 * the row does not drag a stale label with it.
 */
const Button = styled.button<{ $active?: boolean }>`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid
    ${({ $active, theme }) => ($active ? theme.colors.primary600 : theme.colors.neutral200)};
  border-radius: 4px;
  background: ${({ $active, theme }) =>
    $active ? theme.colors.primary100 : theme.colors.neutral0};
  color: ${({ $active, theme }) => ($active ? theme.colors.primary600 : theme.colors.neutral600)};
  cursor: pointer;
  flex-shrink: 0;

  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.colors.neutral100};
    color: ${({ theme }) => theme.colors.primary600};
    border-color: ${({ theme }) => theme.colors.primary600};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  svg {
    width: 16px;
    height: 16px;
  }

  /* The label, drawn from the same string as the accessible name. */
  &::after {
    content: attr(data-tip);
    position: absolute;
    top: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 40;
    padding: 4px 8px;
    border-radius: 4px;
    background: ${({ theme }) => theme.colors.neutral800};
    color: ${({ theme }) => theme.colors.neutral0};
    font-size: 11px;
    font-weight: 400;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.12s ease;
  }

  &:hover::after,
  &:focus-visible::after {
    opacity: 1;
    /* Only on the way in. Leaving is immediate. */
    transition-delay: 0.5s;
  }

  @media (prefers-reduced-motion: reduce) {
    &::after {
      transition: none;
    }
  }
`;

interface TopBarIconProps {
  /** Used as both the accessible name and the tooltip text. */
  label: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  expanded?: boolean;
}

export function TopBarIcon({
  label,
  onClick,
  children,
  active,
  disabled,
  expanded,
}: TopBarIconProps) {
  return (
    <Button
      type="button"
      $active={active}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      data-tip={label}
      {...(expanded === undefined ? {} : { 'aria-expanded': expanded })}
    >
      {children}
    </Button>
  );
}

/*
 * The reference plugin's own icons, copied so the two panels look like
 * siblings. Inline rather than from @strapi/icons because these are the exact
 * shapes it uses, and picking near-equivalents from an icon set is how two
 * things that should match stop matching.
 */

/** A panel beside a page — the conversation sidebar. */
export const HistoryIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <rect x="1" y="2" width="14" height="12" rx="1.5" />
    <line x1="5.5" y1="2" x2="5.5" y2="14" />
  </svg>
);

/** A head and shoulders — what the assistant remembers about you. */
export const MemoryIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <circle cx="8" cy="6" r="4" />
    <path d="M4 10.5C4 10.5 5 14 8 14s4-3.5 4-3.5" />
  </svg>
);

/** A written page — research notes. */
export const NoteIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M4 2v12h8V5l-3-3H4z" />
    <path d="M9 2v3h3" />
    <path d="M6 8h4M6 10.5h4" />
  </svg>
);

/** The reference's tool-picker glyph. */
export const ToolsIcon = () => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M9.5 2.5L13 6l-7 7H2.5v-3.5l7-7z" />
    <path d="M8 4l4 4" />
  </svg>
);

/** Start again. */
export const NewChatIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M8 3v10M3 8h10" />
  </svg>
);
