//
// File: /api/index.ts
// Author: Quinn Harvey Pineda
// Date: 2026-05-23
// Purpose: Serverless entry point for Vercel deployment forwarding to Express router.
//

let cachedApp: any = null;

export default async function handler(req: any, res: any) {
  try {
    if (!cachedApp) {
      // Dynamic import to catch any module-load / top-level errors in server.ts
      const { startServer } = await import('../server');
      cachedApp = await startServer();
    }
    
    // Wrap execution to catch runtime routing errors
    return cachedApp(req, res);
  } catch (err: any) {
    console.error("Vercel Serverless Function Crash:", err);
    return res.status(500).json({
      error: err?.message || "An unexpected error occurred at the serverless function boundary.",
      stack: err?.stack,
      name: err?.name,
      code: err?.code
    });
  }
}

