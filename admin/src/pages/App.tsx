import { Page } from '@strapi/strapi/admin';
import { Route, Routes } from 'react-router-dom';

import { HomePage } from './HomePage';
import { HistoryStorePage } from './HistoryStorePage';
import { MemoryStorePage } from './MemoryStorePage';
import { NoteStorePage } from './NoteStorePage';

/**
 * The chat, plus a management page per store.
 *
 * The panels beside the chat are for glancing and quick fixes; these pages are
 * for when there are thirty of something and you need to search. Both go
 * through the same per-user endpoints, which is why this is not simply left to
 * Strapi's Content Manager: that has no per-ROW scoping, so exposing these
 * types there would show every admin everyone else's memories, notes and
 * transcripts.
 */
export default function App() {
  return (
    <Routes>
      <Route index element={<HomePage />} />
      <Route path="memories" element={<MemoryStorePage />} />
      <Route path="notes" element={<NoteStorePage />} />
      <Route path="history" element={<HistoryStorePage />} />
      <Route path="*" element={<Page.Error />} />
    </Routes>
  );
}
