//
// File: /api/index.ts
// Author: Quinn Harvey Pineda
// Date: 2026-05-23
// Purpose: Serverless entry point for Vercel deployment forwarding to Express router.
//

import { startServer } from '../server';

let cachedApp: any = null;

export default async function handler(req: any, res: any) {
  if (!cachedApp) {
    // startServer builds the Express app and registers all routes
    cachedApp = await startServer();
  }
  return cachedApp(req, res);
}
