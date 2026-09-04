import type { ReactNode } from 'react';
import {
  Box,
  Button,
  Flex,
  Main,
  Searchbar,
  SearchForm,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { Layouts } from '@strapi/strapi/admin';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { PLUGIN_ID } from '../../pluginId';

/**
 * The chrome every store page shares: header, search, table, pager.
 *
 * Ported from the reference plugin's `MemoryStorePage`, which builds all of
 * this inline. There are three of these pages here rather than one, so the
 * frame is separated from the columns — the alternative is the same header and
 * the same pager written three times, drifting apart one fix at a time.
 */

export const ActionBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: ${({ theme }) => theme.colors.neutral600};
  cursor: pointer;

  &:hover {
    background: ${({ theme }) => theme.colors.neutral200};
    color: ${({ theme }) => theme.colors.primary600};
  }

  svg {
    width: 16px;
    height: 16px;
  }
`;

export const DeleteBtn = styled(ActionBtn)`
  &:hover {
    color: ${({ theme }) => theme.colors.danger600};
  }
`;

/** A cell that must not let one long value stretch the table. */
export const Clamp = styled.div`
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  max-width: 520px;
`;

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface StoreShellProps {
  title: string;
  subtitle: string;
  /** e.g. "Add memory". Omitted where the model is the only author. */
  primaryAction?: ReactNode;
  searchPlaceholder: string;
  search: string;
  onSearch: (value: string) => void;
  columns: string[];
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
  /** Rows, already paginated. */
  children: ReactNode;
  /** Shown in place of rows when there are none. */
  empty: string;
  isEmpty: boolean;
}

export function StoreShell({
  title,
  subtitle,
  primaryAction,
  searchPlaceholder,
  search,
  onSearch,
  columns,
  page,
  pageCount,
  onPage,
  children,
  empty,
  isEmpty,
}: StoreShellProps) {
  const navigate = useNavigate();

  return (
    <Main>
      <Layouts.Header
        title={title}
        subtitle={subtitle}
        primaryAction={primaryAction}
        navigationAction={
          <Button variant="ghost" onClick={() => navigate(`/plugins/${PLUGIN_ID}`)}>
            Back to chat
          </Button>
        }
      />
      <Layouts.Content>
        <Box paddingBottom={4}>
          <SearchForm>
            <Searchbar
              name="search"
              value={search}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => onSearch(event.target.value)}
              onClear={() => onSearch('')}
              placeholder={searchPlaceholder}
            >
              Search
            </Searchbar>
          </SearchForm>
        </Box>

        <Table colCount={columns.length} rowCount={1}>
          <Thead>
            <Tr>
              {columns.map((column) => (
                <Th key={column}>
                  <Typography variant="sigma">{column}</Typography>
                </Th>
              ))}
            </Tr>
          </Thead>
          <Tbody>
            {isEmpty ? (
              <Tr>
                <Td colSpan={columns.length}>
                  <Box padding={4}>
                    <Typography textColor="neutral500">{empty}</Typography>
                  </Box>
                </Td>
              </Tr>
            ) : (
              children
            )}
          </Tbody>
        </Table>

        {pageCount > 1 && (
          <Box paddingTop={4}>
            <Flex justifyContent="center" gap={2} alignItems="center">
              <Button variant="tertiary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
                Previous
              </Button>
              <Typography variant="pi" textColor="neutral600">
                Page {page} of {pageCount}
              </Typography>
              <Button
                variant="tertiary"
                disabled={page >= pageCount}
                onClick={() => onPage(page + 1)}
              >
                Next
              </Button>
            </Flex>
          </Box>
        )}
      </Layouts.Content>
    </Main>
  );
}
