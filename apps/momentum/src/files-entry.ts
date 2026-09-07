// Real entry point that loads inside the Nextcloud Files app (frontend.md §
// File-Browser View Integration + § Ask AI Sidebar; M4.14/M4.16) — built as a
// second, separate bundle from the app-shell's `main.ts` since it must load
// on *every* Files page, not just `/apps/momentum/*` (see vite.config.ts's
// `files` build input and lib/Listener/LoadAdditionalScriptsListener.php,
// which injects it via NC's `LoadAdditionalScriptsEvent`).
//
// This is the one place `momentumFilesView.ts`/`momentumAskAiSidebar.ts`'s
// injectable deps are satisfied with the real `@nextcloud/files` exports —
// both modules stay unit-testable with stubbed deps precisely so this file
// can stay this thin.
import { File, Folder, View, getNavigation, registerSidebarTab } from '@nextcloud/files'
import { getCurrentUser } from '@nextcloud/auth'
import axios from '@nextcloud/axios'
import { generateRemoteUrl, generateUrl } from '@nextcloud/router'
import { t } from '@nextcloud/l10n'
import { registerMomentumView, type MomentumViewDeps } from './files-view/momentumFilesView'
import { registerAskAiSidebarTab, type MomentumSidebarDeps } from './sidebar/momentumAskAiSidebar'

const uid = getCurrentUser()?.uid ?? ''

// `MomentumViewDeps`/`MomentumSidebarDeps` declare narrower structural types
// than the real `@nextcloud/files` `IView`/`INode`/`ISidebarTab` (only the
// fields those modules actually read/write) so they stay dependency-free and
// easy to fake in unit tests. The real `View`/`File`/`Folder`/`registerSidebarTab`
// satisfy those narrower shapes at runtime, but TS's return-type variance
// checking can't verify that through the full real interfaces (which carry
// ~20 fields our modules never touch) — hence the casts at this one
// boundary, not inside the modules themselves.
void registerMomentumView({
  Navigation: getNavigation(),
  View: View as unknown as MomentumViewDeps['View'],
  File: File as unknown as MomentumViewDeps['File'],
  Folder: Folder as unknown as MomentumViewDeps['Folder'],
  axios,
  generateUrl,
  t,
  uid,
  davRootUrl: generateRemoteUrl(`dav/files/${encodeURIComponent(uid)}`),
})

registerAskAiSidebarTab({
  registerSidebarTab: registerSidebarTab as unknown as MomentumSidebarDeps['registerSidebarTab'],
  t,
})
