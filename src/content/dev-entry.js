// Content script entry of development builds (npm run build:dev): the normal
// content script plus the page-driven test bridge. Store builds use
// src/content/index.js directly.
import { exportAllImages, getDocumentType, handleToolbarAction } from './index.js';
import { installDevBridge } from './dev-bridge.js';

// eslint-disable-next-line no-undef
if (getDocumentType()) installDevBridge({ exportAllImages, handleToolbarAction, buildId: __IMGLOUPE_BUILD_ID__ });
