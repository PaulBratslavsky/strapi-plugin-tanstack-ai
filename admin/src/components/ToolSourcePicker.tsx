import { useEffect, useRef, useState } from 'react';
import { Typography } from '@strapi/design-system';
import styled from 'styled-components';
import type { ToolSource } from '../utils/tool-sources-api';
import { ToolsIcon, TopBarIcon } from './TopBarIcon';

/**
 * What tools the model has, and which plugin each one came from.
 *
 * Ported from the reference plugin's `ToolSourcePicker`, with one deliberate
 * addition: it lists the TOOL NAMES, not just a count per source. "3 tools"
 * tells you a plugin is contributing; it does not tell you whether the thing
 * you are about to ask for is among them, which is the question someone opens
 * this menu to answer.
 *
 * Built-in groups render with a disabled, checked box rather than being
 * omitted. Leaving them out would suggest the model has only the contributed
 * tools; showing them as fixed says what is there and that it is not
 * negotiable.
 */

const Wrapper = styled.div`
  position: relative;
  flex-shrink: 0;
`;


const Popover = styled.div`
  position: absolute;
  top: 36px;
  left: 0;
  z-index: 20;
  width: 320px;
  max-height: 420px;
  overflow-y: auto;
  padding: 8px 0;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: 4px;
  background: ${({ theme }) => theme.colors.neutral0};
  box-shadow: ${({ theme }) => theme.shadows.popupShadow};
`;

const GroupHeader = styled.div`
  padding: 6px 12px 2px;
`;

const SourceRow = styled.label<{ $fixed: boolean }>`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 12px;
  cursor: ${({ $fixed }) => ($fixed ? 'default' : 'pointer')};

  &:hover {
    background: ${({ $fixed, theme }) => ($fixed ? 'transparent' : theme.colors.neutral100)};
  }
`;

const SourceBody = styled.div`
  flex: 1;
  min-width: 0;
`;

const ToolName = styled.code`
  display: inline-block;
  margin: 2px 4px 0 0;
  padding: 1px 5px;
  border-radius: 3px;
  background: ${({ theme }) => theme.colors.neutral150};
  color: ${({ theme }) => theme.colors.neutral700};
  font-size: 11px;
  word-break: break-all;
`;

interface ToolSourcePickerProps {
  sources: ToolSource[];
  enabled: Set<string>;
  onToggle: (id: string) => void;
}

export function ToolSourcePicker({ sources, enabled, onToggle }: ToolSourcePickerProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape. Without the key handler the menu is a
  // trap for anyone not using a mouse.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (sources.length === 0) return null;

  const fixed = sources.filter((source) => !source.toggleable);
  const contributed = sources.filter((source) => source.toggleable);
  const activeCount =
    fixed.reduce((total, source) => total + source.tools.length, 0) +
    contributed
      .filter((source) => enabled.has(source.id))
      .reduce((total, source) => total + source.tools.length, 0);

  const renderSource = (source: ToolSource) => (
    <SourceRow key={source.id} $fixed={!source.toggleable}>
      <input
        type="checkbox"
        checked={source.toggleable ? enabled.has(source.id) : true}
        disabled={!source.toggleable}
        onChange={() => source.toggleable && onToggle(source.id)}
        aria-label={`Enable ${source.label}`}
        style={{ marginTop: 3 }}
      />
      <SourceBody>
        <Typography variant="omega" textColor="neutral800" style={{ fontWeight: 600 }}>
          {source.label}
        </Typography>
        {source.description && (
          <Typography variant="pi" textColor="neutral600" style={{ display: 'block' }}>
            {source.description}
          </Typography>
        )}
        <div>
          {source.tools.map((tool) => (
            <ToolName key={tool.name} title={tool.description}>
              {tool.name}
            </ToolName>
          ))}
        </div>
      </SourceBody>
    </SourceRow>
  );

  return (
    <Wrapper ref={wrapperRef}>
      <TopBarIcon
        label={`Tools (${activeCount})`}
        active={open}
        expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ToolsIcon />
      </TopBarIcon>
      {open && (
        <Popover role="dialog" aria-label="Tool sources">
          {fixed.length > 0 && (
            <>
              <GroupHeader>
                <Typography variant="sigma" textColor="neutral600">
                  ALWAYS ON
                </Typography>
              </GroupHeader>
              {fixed.map((source) => renderSource(source))}
            </>
          )}
          {contributed.length > 0 && (
            <>
              <GroupHeader>
                <Typography variant="sigma" textColor="neutral600">
                  FROM OTHER PLUGINS
                </Typography>
              </GroupHeader>
              {contributed.map((source) => renderSource(source))}
            </>
          )}
        </Popover>
      )}
    </Wrapper>
  );
}
