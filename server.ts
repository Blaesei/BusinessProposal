//
// File: server.ts
// Author: Quinn Harvey Pineda
// Date: 2026-05-19
// Purpose: Main backend server handling Google Docs generation, Gmail API integration, and OAuth2 flows.
//

import express from 'express';
import path from 'path';
import { google } from 'googleapis';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

// ─── Standard Hourly Rates ────────────────────────────────────────────────────
// These are inserted dynamically into the hourly rates table in every template.
// To update rates, edit only this array — no other changes needed.
const HOURLY_RATES = [
  ['Partners',                           'Php 4,000.00'],
  ['Senior Associates / S. Accountants', 'Php 3,500.00'],
  ['Associates / Accountants',           'Php 3,000.00'],
  ['Paralegals',                         'Php 2,500.00'],
];

// ─── Proposal Type Resolver ───────────────────────────────────────────────────
// Accepts selectedServices array AND templateName as fallback.
// Runs keyword matching against both so it works regardless of which the
// frontend sends. Add new service combinations here as needed.
const resolveProposalType = (services: string[], templateName?: string): string => {
  // Combine services array + templateName into one pool of text to search
  const pool = [...services, templateName ?? ''].join(' ').toLowerCase();
  const has = (keyword: string) => pool.includes(keyword.toLowerCase());

  const hasLOA        = has('loa');
  const hasAFS        = has('audited financial');
  const hasForensic   = has('forensic');
  const hasTaxR       = has('tax retainer');
  const hasTaxC       = has('tax compliance');
  const hasAccounting = has('general accounting');

  // ── Group A — single-service types (mutually exclusive) ───────────────────
  if (hasLOA)      return 'LOA ASSISTANCE';
  if (hasAFS)      return 'AUDITED FINANCIAL STATEMENT';
  if (hasForensic) return 'FORENSIC AUDIT';

  // ── Group B — combinable tax / accounting services ─────────────────────────
  const hasTax = hasTaxR || hasTaxC;

  if (hasTax && hasAccounting) return 'GENERAL ACCOUNTING AND TAX SERVICES';
  if (hasTax && !hasAccounting) return 'TAX SERVICES';
  if (!hasTax && hasAccounting) return 'GENERAL ACCOUNTING SERVICES';

  // ── Fallback ───────────────────────────────────────────────────────────────
  return 'SERVICES';
};

// ─── Helper: Number to Words (Currency) ─────────────────────────────────────
const numberToWords = (num: number): string => {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const scales = ["", "Thousand", "Million", "Billion"];

  if (num === 0) return "Zero";

  const convertGroup = (n: number) => {
    let res = "";
    if (n >= 100) {
      res += ones[Math.floor(n / 100)] + " Hundred ";
      n %= 100;
    }
    if (n >= 20) {
      res += tens[Math.floor(n / 10)] + " ";
      n %= 10;
    }
    if (n > 0) {
      res += ones[n] + " ";
    }
    return res.trim();
  };

  let wordResult = "";
  let scaleIndex = 0;
  let remaining = Math.floor(num);

  while (remaining > 0) {
    const group = remaining % 1000;
    if (group > 0) {
      wordResult = convertGroup(group) + (scales[scaleIndex] ? " " + scales[scaleIndex] : "") + (wordResult ? " " + wordResult : "");
    }
    remaining = Math.floor(remaining / 1000);
    scaleIndex++;
  }

  return wordResult.trim();
};

const formatCurrencyWithWords = (amount: number | null | undefined): string => {
  if (amount == null) return "";   // ← was === null
  const words = numberToWords(Number(amount));
  const formattedAmount = Number(amount).toLocaleString('en-PH', { minimumFractionDigits: 2 });
  return `${words} Pesos (₱${formattedAmount})`;
};

const formatCurrencyWithWordsUpper = (amount: number | null | undefined): string => {
  if (amount == null) return "";   // ← was === null
  const words = numberToWords(Number(amount)).toUpperCase();
  const formattedAmount = Number(amount).toLocaleString('en-PH', { minimumFractionDigits: 2 });
  return `${words} PESOS (P${formattedAmount})`;
};

// ─── startServer ────────────────────────────────────────────────────────────
export async function startServer() {
  const app  = express();
  const PORT = 3000;

  app.use(express.json());

  // ─── OAuth2 Setup ─────────────────────────────────────────────────────────
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  let refreshToken   = process.env.GOOGLE_REFRESH_TOKEN || '';

  // Load from temp file cache if exists
  try {
    const cachedPath = '/tmp/google_refresh_token_db.json';
    if (fs.existsSync(cachedPath)) {
      const parsed = JSON.parse(fs.readFileSync(cachedPath, 'utf8'));
      if (parsed.refresh_token) {
        refreshToken = parsed.refresh_token;
        console.log('[Google Auth] Initialized with cached refresh token from /tmp');
      }
    }
  } catch (error) {
    console.warn('[Google Auth] Failed to read dynamic refresh token cache:', error);
  }

  // Load firebase config safely for Admin validation
  let firebaseConfig: any = {};
  try {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) {
    console.error('[Firebase] Failed to load firebase-applet-config.json:', e);
  }

  if (!clientId || !clientSecret || !refreshToken) {
    console.warn('[Google Auth] Missing one or more OAuth2 credentials:');
    if (!clientId)     console.warn('  - GOOGLE_CLIENT_ID is not set');
    if (!clientSecret) console.warn('  - GOOGLE_CLIENT_SECRET is not set');
    if (!refreshToken) console.warn('  - GOOGLE_REFRESH_TOKEN is not set');
  } else {
    console.log('[Google Auth] OAuth2 credentials loaded successfully.');
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  if (refreshToken) {
    auth.setCredentials({ refresh_token: refreshToken });
  }

  const docs  = google.docs({ version: 'v1', auth });
  const drive = google.drive({ version: 'v3', auth });

  // ─── Template IDs ─────────────────────────────────────────────────────────
  // ⚠️ Replace these IDs with your actual converted Google Doc IDs
  // (after doing File → Save as Google Docs on each template)
  const TEMPLATES: Record<string, string> = {
    'LOA Assistance'                                     : '1LHpQKNHtpxco5GOgDvqp2qotCJplZMdcHaymNLATUTA',
    'Audited Financial Statement'                        : '1jcaLNqvg-jIDI2atnkumaJJItOh5LsTC4AkYuBVxrkY',
    'Tax Retainer'                                       : '1grHCSIEsYo-esZhEof8dX13eVP6tNYRbfhzEoMdq58g',
    'Tax Compliance'                                     : '1YiVyffgkL19mM6w27fnfABBD4Qq54ZpFrmJ1vJdew30',
    'General Accounting Services'                        : '1YiVyffgkL19mM6w27fnfABBD4Qq54ZpFrmJ1vJdew30',
    'Tax Retainer + Tax Compliance'                      : '1YiVyffgkL19mM6w27fnfABBD4Qq54ZpFrmJ1vJdew30',
    'Tax Retainer + General Accounting Services'         : '1YiVyffgkL19mM6w27fnfABBD4Qq54ZpFrmJ1vJdew30',
    'Tax Compliance + General Accounting Services'       : '1YiVyffgkL19mM6w27fnfABBD4Qq54ZpFrmJ1vJdew30',
    'Tax Retainer + Tax Compliance + General Accounting' : '1YiVyffgkL19mM6w27fnfABBD4Qq54ZpFrmJ1vJdew30',
    'Forensic Audit'                                     : '1tyvGf7uznXSa8n27S0S6nlL7noW47pkj8D9b5bTg4Eg',
  };

  // ─── Helper: Build Group B section content based on selected services ──────
  const buildGroupBSections = (selectedServices: string[]) => {
    const has = (s: string) => selectedServices.includes(s);

    const taxRetainer = has('Tax Retainer (Phase 1)')
      ? `Phase I. Tax Retainer\n\nFrom time to time, you may need to request answers for your tax and accounting concerns. Tax and Accounting Advice shall be rendered. However, appearances before the BIR and the Court of Tax Appeals shall not be included in the scope of our retainer services.\n\nThis shall include advice on the taxability and tax consequences in relation to your transactions and the maintaining and recording of such transactions within the company's books of accounts in accordance with Philippine Accounting Standards (PAS) and the Client's established accounting policies and procedures particularly General Ledger, General Journal, Cash Receipts and Cash Disbursements.\n\n`
      : '';

    const taxCompliance = has('Tax Compliance (Phase 2)')
      ? `Phase II. Tax Compliance\n\nAlso, we can prepare, assist and advise on the following tax returns to ensure proper filing with Bureau of Internal Revenue (BIR):\n\n1. Monthly Tax Filing\n- Income tax withheld at source (BIR Form 0619-E)\n- Withholding tax on Compensation (BIR Form 1601-C)\n- Value added tax (BIR Form 2550M)\n- Final withholding tax, if applicable (BIR Form 0619-F)\n\n2. Quarterly Tax Filing Compliances\n- Quarterly Income tax return (BIR Form 1702Q)\n- Value added tax (BIR Form 2550Q) with SLSP\n- Income tax withheld at source (BIR Form 1601EQ) with QAP\n- Final withholding tax, if applicable (BIR Form 1601FQ) with QAP\n- Certificate of creditable tax withheld at source (BIR Form 2307)\n\n`
      : '';

    const generalAccounting = has('General Accounting Services (Phase 3)')
      ? `Phase III. Services for General Accounting\n\nAs needed in your business, you may need to request an answer for your tax and accounting concerns. Tax and Accounting support shall be rendered. However, appearances before the BIR and Court of Tax Appeals shall not be included in the scope of our retainer services.\n\nOur services upon request shall include:\n- Examination and review of invoices/supporting documents\n- Assistance in the preparation of sales report/summary\n- Assistance in the preparation of collection report and Accounts receivable aging\n- Assistance in the preparation of payable voucher/check vouchers\n- Assistance in the preparation of payables aging report\n- Assistance in the preparation of the lapsing schedules of fixed assets\n- Monthly/annual financial statements\n- Statement of financial position\n- Statement of comprehensive income\n- Statement of Cash Flow\n\n`
      : '';

    return { taxRetainer, taxCompliance, generalAccounting };
  };

  // ─── Helper: Find all tables in document body ─────────────────────────────
  const findTables = (bodyContent: any[]) =>
    bodyContent
      .filter(el => el.table)
      .map(el => ({ startIndex: el.startIndex as number, table: el.table }));

  // ─── Helper: Insert rows into table then fill with values ─────────────────
  const insertAndFillTableRows = async (
    documentId     : string,
    tableStartIndex: number,
    rowData        : string[][],
    afterRowIndex  : number = 0,
  ) => {
    // Step A — Insert blank rows (in reverse order so the first item ends up at the top)
    const reversedRowsForInsertion = [...rowData].reverse();
    const insertRequests = reversedRowsForInsertion.map(() => ({
      insertTableRow: {
        tableCellLocation: {
          tableStartLocation: { index: tableStartIndex },
          rowIndex          : afterRowIndex,
          columnIndex       : 0,
        },
        insertBelow: true,
      },
    }));

    await docs.documents.batchUpdate({
      documentId,
      requestBody: { requests: insertRequests },
    });

    // Step B — Re-fetch doc to get fresh indexes after row insertion
    const updated     = await docs.documents.get({ documentId });
    const updatedBody = updated.data.body?.content || [];
    const tables      = findTables(updatedBody);
    const targetTable = tables.find(t => t.startIndex === tableStartIndex)?.table;

    if (!targetTable) {
      console.warn('[Table] Could not re-locate target table after insertion.');
      return;
    }

    // Step C — Fill cells
    const fillRequests: any[] = [];
    
    // Now rows 1 to N are our new rows (if afterRowIndex is 0)
    rowData.forEach((row, rowIdx) => {
      const actualRowIdx = afterRowIndex + 1 + rowIdx;
      row.forEach((cellValue, cellIdx) => {
        const cell      = targetTable.tableRows?.[actualRowIdx]?.tableCells?.[cellIdx];
        const cellStart = cell?.content?.[0]?.paragraph?.elements?.[0]?.startIndex;
        if (cellStart !== undefined) {
          fillRequests.push({
            insertText: {
              location: { index: cellStart },
              text    : cellValue,
            },
          });
        }
      });
    });

    // Step D — Delete the placeholder row (row 0)
    fillRequests.push({
      deleteTableRow: {
        tableCellLocation: {
          tableStartLocation: { index: tableStartIndex },
          rowIndex: 0
        }
      }
    });

    if (fillRequests.length > 0) {
      // Sort text insertions by index descending to preserve indexes
      const textInsertions = fillRequests.filter(r => r.insertText).sort((a,b) => b.insertText.location.index - a.insertText.location.index);
      const otherRequests = fillRequests.filter(r => !r.insertText);
      
      await docs.documents.batchUpdate({
        documentId,
        requestBody: { requests: [...textInsertions, ...otherRequests] },
      });
    }

    console.log(`[Table] Dynamically inserted ${rowData.length} hourly rate rows.`);
  };

  // ─── Format Google API Errors into Helpful Action Guides ──────────────────────
  function getGoogleErrorMessage(error: any): string {
    const errMsg = error?.message || '';
    const errDesc = error?.response?.data?.error_description || '';
    const errCode = error?.response?.data?.error || '';
    
    const isInvalidGrant = 
      errMsg.includes('invalid_grant') || 
      errDesc.includes('invalid_grant') || 
      errCode === 'invalid_grant' || 
      (error?.response?.status === 400 && error?.response?.data?.error === 'invalid_grant');

    if (isInvalidGrant) {
      return (
        "Google Authorization Error: Your refresh token has EXPIRED, BEEN REVOKED, or is INVALID (invalid_grant).\n\n" +
        "TO RESOLVE THIS immediately, please do the following:\n" +
        "1. Open a new browser tab and visit your application's authorization debug link:\n" +
        "   👉 /api/debug/auth-url\n\n" +
        "2. Click the 'Authorize App' button, log in with your Google account, and VERY IMPORTANTLY:\n" +
        "   👉 Manually CHECK EVERY SINGLE CHECKBOX for Google Drive and Gmail permissions on the Google consent screen! If you skip checking the boxes, the app will return 403 Forbidden errors.\n\n" +
        "3. Copy the newly generated refresh token displayed on the screen.\n\n" +
        "4. In AI Studio, click the 'Settings' gear icon on the left/top sidebar to open your app settings.\n\n" +
        "5. Update the 'GOOGLE_REFRESH_TOKEN' environment variable (Secret) with that brand new value, click Save, and restart the server (or click the restart dev server button)."
      );
    }

    const isInvalidClient =
      errMsg.includes('invalid_client') ||
      errDesc.includes('invalid_client') ||
      errCode === 'invalid_client';

    if (isInvalidClient) {
      return (
        "Google Authorization Error: Your GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is invalid (invalid_client).\n\n" +
        "TO RESOLVE:\n" +
        "1. Ensure that GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set correctly in your AI Studio Environment Variables/Secrets settings.\n" +
        "2. Double check your Google Cloud Console credentials parameters."
      );
    }

    return errMsg || 'Google API Failure';
  }

  app.get('/api/ping', (req, res) => {
    res.json({ pong: true, time: new Date().toISOString() });
  });

  app.get('/api/debug/scopes', async (req, res) => {
    try {
      const accessToken = await auth.getAccessToken();
      if (!accessToken.token) {
        throw new Error('Could not retrieve access token. Check your GOOGLE_REFRESH_TOKEN.');
      }
      const tokenInfo = await auth.getTokenInfo(accessToken.token);
      const required = [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/gmail.send'
      ];
      const missing = required.filter(s => !tokenInfo.scopes.includes(s));

      res.json({ 
        scopes: tokenInfo.scopes,
        status: missing.length === 0 ? "✅ All required scopes found" : "❌ Missing: " + missing.join(', '),
        required_scopes: required,
        message: "If status is not success, please visit /api/debug/auth-url to re-authorize and ENSURE YOU CHECK ALL THE BOXES on the Google consent screen."
      });
    } catch (error: any) {
      console.error('[Debug] Scope check failed:', error.message);
      res.status(500).json({ error: getGoogleErrorMessage(error) });
    }
  });

  // Helper to resolve the correct base URL dynamically based on the current request, or fall back to APP_URL
  const getDynamicBaseUrl = (req: express.Request): string => {
    const host = req.headers['x-forwarded-host'] || req.headers['host'] || req.get('host') || '';
    const hostStr = Array.isArray(host) ? host[0] : host;
    
    // Default to 'https' for all Cloud Run deployments. Only use 'http' on localhost/local dev port
    let proto = 'https';
    if (hostStr.includes('localhost') || hostStr.includes('127.0.0.1') || hostStr.includes('3000')) {
      proto = 'http';
    }
    
    if (hostStr) {
      return `${proto}://${hostStr}`;
    }
    return process.env.APP_URL || 'https://ais-dev-ogfhbqk46jsegpq76uchjf-149125843392.asia-northeast1.run.app';
  };

  // ─── Debug Route: Generate Auth URL ───────────────────────────────────────
  // Visit this to get a link to authorize the app with the correct scopes.
  app.get('/api/debug/auth-url', (req, res) => {
    // Dynamically choose the correct environment URL so callback matches the domain they are initiating the auth from
    const baseUrl = getDynamicBaseUrl(req);
    const redirectUri = `${baseUrl}/api/debug/auth-callback`;

    // Static listings for both environments to make console setup fully clear
    const devRedirectUri = 'https://ais-dev-ogfhbqk46jsegpq76uchjf-149125843392.asia-northeast1.run.app/api/debug/auth-callback';
    const preRedirectUri = 'https://ais-pre-ogfhbqk46jsegpq76uchjf-149125843392.asia-northeast1.run.app/api/debug/auth-callback';

    const SCOPES = [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/drive.metadata.readonly',
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/gmail.send',
    ];

    const authUrlAuth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    const url = authUrlAuth.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
    });

    res.send(`
      <div style="font-family: sans-serif; padding: 40px; max-width: 650px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; margin-top: 50px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);">
        <h2 style="color: #1e293b; margin-top: 0;">Google Authorization</h2>
        
        <p style="color: #475569; font-size: 15px; line-height: 1.5;">
          To completely resolve the <b>redirect_uri_mismatch</b> error, you must register the redirect URIs in your Google Cloud Console. 
          We recommend adding <b>BOTH</b> URLs below to ensure seamless authorization across your Development and Published/Pre-release environments:
        </p>
        
        <div style="margin: 20px 0;">
          <p style="font-weight: bold; color: #0f172a; margin-bottom: 5px; font-size: 14px;">1. Development Environment Callback URI:</p>
          <div style="background: #f8fafc; padding: 10px 14px; border: 1px dashed #cbd5e1; border-radius: 6px; font-family: monospace; font-size: 13px; word-break: break-all; color: #0f172a;">
            ${devRedirectUri}
          </div>
          
          <p style="font-weight: bold; color: #0f172a; margin-bottom: 5px; margin-top: 15px; font-size: 14px;">2. Published (Pre-release) Environment Callback URI:</p>
          <div style="background: #f8fafc; padding: 10px 14px; border: 1px dashed #cbd5e1; border-radius: 6px; font-family: monospace; font-size: 13px; word-break: break-all; color: #0f172a;">
            ${preRedirectUri}
          </div>
        </div>

        <div style="background: #f0fdf4; padding: 14px; border-radius: 8px; border: 1px solid #bbf7d0; margin-bottom: 25px;">
          <p style="color: #166534; font-weight: bold; margin-top: 0; font-size: 14px; margin-bottom: 8px;">🔑 CURRENTLY REQUESTED CALLBACK URI:</p>
          <p style="color: #1e3a1e; font-size: 13px; margin: 0; line-height: 1.5;">
            By clicking the button below, you are authorizing from:
          </p>
          <div style="background: #ffffff; padding: 8px 12px; border: 1px solid #86efac; border-radius: 4px; font-family: monospace; font-size: 12px; word-break: break-all; margin-top: 8px; color: #14532d;">
            ${redirectUri}
          </div>
        </div>

        <p style="color: #475569; font-size: 14px; margin-bottom: 30px; line-height: 1.5;">
          💡 <b>Action Steps:</b> Go to <a href="https://console.cloud.google.com/apis/credentials" target="_blank" style="color: #3b82f6; font-weight: 500;">Google Cloud Console &rarr; Credentials</a>, select your OAuth 2.0 Web Client ID, paste both URIs under <b>Authorized redirect URIs</b>, and save.
        </p>

        <div style="background: #eff6ff; padding: 15px; border-radius: 8px; border: 1px solid #bfdbfe; margin-bottom: 25px; text-align: left;">
          <p style="color: #1e40af; font-weight: bold; margin-top: 0;">🛠️ PRE-REQUISITE:</p>
          <p style="color: #1e40af; font-size: 14px; margin-bottom: 0;">
            Make sure the <b>Gmail API</b> is enabled in your Google Cloud Console:<br/>
            <a href="https://console.developers.google.com/apis/api/gmail.googleapis.com/overview?project=566927052843" target="_blank" style="color: #2563eb; font-weight: bold;">Enable Gmail API Here</a>
          </p>
        </div>

        <div style="background: #fff7ed; padding: 15px; border-radius: 8px; border: 1px solid #fed7aa; margin-bottom: 25px; text-align: left;">
          <p style="color: #9a3412; font-weight: bold; margin-top: 0;">⚠️ CRITICAL STEP:</p>
          <p style="color: #9a3412; font-size: 14px; margin-bottom: 0;">On the Google consent screen, you <b>MUST manually check the boxes</b> to grant permission for Drive and Gmail. If you just click 'Continue' without checking the boxes, the app will fail with a 403 error.</p>
        </div>

        <div style="text-align: center; margin-top: 30px;">
          <a href="${url}" style="display: inline-block; padding: 14px 32px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px; box-shadow: 0 2px 4px rgb(0 0 0 / 0.1);">
            Authorize App
          </a>
        </div>
      </div>
    `);
  });

  // ─── Debug Route: Auth Callback ───────────────────────────────────────────
  // Handles the response from Google and displays/stores the refresh token.
  app.get('/api/debug/auth-callback', async (req, res) => {
    const code = req.query.code as string;
    if (!code) return res.status(400).send('No code provided');

    const baseUrl = getDynamicBaseUrl(req);
    const redirectUri = `${baseUrl}/api/debug/auth-callback`;

    try {
      const authCallbackClient = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
      const { tokens } = await authCallbackClient.getToken(code);
      
      let tokenAutoSaved = false;
      if (tokens.refresh_token) {
        // Cache the token dynamically
        refreshToken = tokens.refresh_token;
        auth.setCredentials({ refresh_token: tokens.refresh_token });
        try {
          fs.writeFileSync('/tmp/google_refresh_token_db.json', JSON.stringify({ refresh_token: tokens.refresh_token }), 'utf8');
          tokenAutoSaved = true;
          console.log('[Google Auth] Automatically cached new refresh token from auth flow.');
        } catch (e: any) {
          console.error('[Google Auth] Failed to save callback refresh token to /tmp:', e.message);
        }
      }

      res.send(`
        <div style="font-family: sans-serif; padding: 40px; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; margin-top: 50px; text-align: center; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);">
          <h2 style="color: #0d9488; margin-top: 0; font-size: 24px;">✅ Authorization Successful!</h2>
          
          ${tokenAutoSaved ? `
            <div style="background: #ecfdf5; border: 1px solid #a7f3d0; padding: 16px; border-radius: 8px; margin: 20px 0; text-align: left;">
              <p style="color: #047857; font-weight: bold; margin-top: 0; font-size: 15px;">💾 AUTOMATICALLY SAVED & ACTIVATED!</p>
              <p style="color: #065f46; font-size: 14px; margin: 0; line-height: 1.5;">
                We have successfully saved this Refresh Token directly into the active system context! The Google Doc generation and Gmail features are now fully functional. You do <b>NOT</b> need to copy-paste anything.
              </p>
            </div>
          ` : `
            <div style="background: #fff7ed; border: 1px solid #ffedd5; padding: 16px; border-radius: 8px; margin: 20px 0; text-align: left;">
              <p style="color: #c2410c; font-weight: bold; margin-top: 0; font-size: 15px;">⚠️ RE-AUTHENTICATION NOTE</p>
              <p style="color: #9a3412; font-size: 14px; margin: 0; line-height: 1.5;">
                Google did not return a new refresh token because this app was already approved. To receive a new one, please ensure you use the "Authorize App" button which prompts consent, or copy your existing token.
              </p>
            </div>
          `}

          <p style="color: #475569; font-size: 15px; margin-bottom: 5px;">Your Google Refresh Token:</p>
          <div style="background: #f1f5f9; padding: 16px; border-radius: 8px; font-family: monospace; word-break: break-all; border: 1px solid #e2e8f0; margin: 10px 0; color: #0f172a; font-size: 13px; text-align: left;">
            ${tokens.refresh_token || '<i>[Hidden or already authorized]</i>'}
          </div>

          <p style="color: #64748b; font-size: 14px; line-height: 1.5; margin-top: 25px;">
            You can now close this tab. You can also view or update this token anytime via your <b>Settings &rarr; Google Integration</b> dashboard.
          </p>
          
          <div style="margin-top: 30px;">
            <button onclick="window.close()" style="padding: 10px 24px; background: #e2e8f0; color: #334155; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 14px;">
              Close Window
            </button>
          </div>
        </div>
      `);
    } catch (error: any) {
      console.error('[Debug] Callback error:', error.message);
      res.status(500).send(`Error getting token: ${error.message}`);
    }
  });

  // Verify Firebase user ID token as Administrator
  async function verifyFirebaseAdmin(authorizationHeader?: string): Promise<{ uid: string; email: string } | null> {
    if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
      return null;
    }
    const idToken = authorizationHeader.split('Bearer ')[1];
    try {
      if (!firebaseConfig.apiKey) {
        console.warn('[Google Auth] No Firebase API key configured to verify admin token.');
        return null;
      }
      const response = await globalThis.fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseConfig.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken })
      });
      const data = await response.json();
      if (!data.users || data.users.length === 0) return null;
      const user = data.users[0];
      
      const adminEmails = ['damoncrz2872@gmail.com', 'stlaf.acc08@gmail.com'];
      const adminUids = ['wY4rgbtqAWgzXz0hlrLLVvRrGWM2'];
      const isUserAdmin = adminEmails.includes(user.email) || adminUids.includes(user.localId);
      
      if (isUserAdmin) {
        return { uid: user.localId, email: user.email };
      }
      return null;
    } catch (error) {
      console.error('[Google Auth] Error verifying Firebase token:', error);
      return null;
    }
  }

  // Admin endpoint: Retrieve current Google Credentials Status
  app.get('/api/admin/google-status', async (req, res) => {
    try {
      const adminUser = await verifyFirebaseAdmin(req.headers.authorization);
      if (!adminUser) {
        return res.status(401).json({ error: 'Unauthorized: Admin privileges required.' });
      }

      res.json({
        googleClientId: clientId || '',
        googleClientSecretSet: !!clientSecret,
        hasToken: !!refreshToken,
        refreshToken: refreshToken,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin endpoint: Save Google Refresh Token manually
  app.post('/api/admin/set-google-token', async (req, res) => {
    try {
      const adminUser = await verifyFirebaseAdmin(req.headers.authorization);
      if (!adminUser) {
        return res.status(401).json({ error: 'Unauthorized: Admin privileges required.' });
      }

      const { token } = req.body;
      if (!token) {
        return res.status(400).json({ error: 'Refresh token cannot be empty.' });
      }

      // Update in memory and shared client
      refreshToken = token;
      auth.setCredentials({ refresh_token: token });

      // Persist to cache file
      try {
        fs.writeFileSync('/tmp/google_refresh_token_db.json', JSON.stringify({ refresh_token: token }), 'utf8');
      } catch (fsErr: any) {
        console.error('[Google Auth] Failed to write token cache file:', fsErr.message);
      }
      
      res.json({
        success: true,
        message: 'Google Refresh Token successfully updated and activated.',
        hasToken: true,
        refreshToken: token,
      });
    } catch (err: any) {
      console.error('[Google Auth] Failed to save/update refresh token:', err.message);
      res.status(500).json({ error: 'Failed to update refresh token: ' + err.message });
    }
  });

  // ─── Folder Resolver ────────────────────────────────────────────────────────
  // Determines the target Google Drive folder ID based on selected services.
  const GDRIVE_FOLDERS: Record<string, string> = {
    MAIN: process.env.GOOGLE_DRIVE_FOLDER_ID || '1S4YMjpYBkrxxesWFGJgJUsinQvAX0-I9',
    LOA_ASSISTANCE: '1Cq0CkJySLdwURDwNBOBnuTR8ilG2B1R3',
    FORENSIC_AUDIT: '1FD0FSL7lyvfJ0fbaA0SQzzYb3THp-GOG',
    AUDITED_FINANCIAL_STATEMENT: '1BVww4NTszshD77khR3cjXw6TwOChhn4Q',
    TAX_RETAINER: '1qk1R77SeRMnQDJm3iBQMVK17PWzSDSHg',
    TAX_RETAINER_COMBO: '1OweT2K7gtt4QMLZLmiZ444Z83y3e6_fU'
  };

  const resolveTargetFolderId = (services: string[]): string => {
    if (!services || services.length === 0) return GDRIVE_FOLDERS.MAIN;
    
    const has = (s: string) => services.some(srv => srv.includes(s));
    
    // Priority 1: Specific Group A items
    if (has('LOA Assistance')) return GDRIVE_FOLDERS.LOA_ASSISTANCE;
    if (has('Forensic Audit')) return GDRIVE_FOLDERS.FORENSIC_AUDIT;
    if (has('Audited Financial Statement')) return GDRIVE_FOLDERS.AUDITED_FINANCIAL_STATEMENT;

    // Priority 2: Group B items
    const hasRetainer = has('Tax Retainer');
    const hasCompliance = has('Tax Compliance');
    const hasAccounting = has('General Accounting');

    if (hasRetainer && !hasCompliance && !hasAccounting) {
      return GDRIVE_FOLDERS.TAX_RETAINER;
    }
    
    if (hasRetainer || hasCompliance || hasAccounting) {
      return GDRIVE_FOLDERS.TAX_RETAINER_COMBO;
    }

    return GDRIVE_FOLDERS.MAIN;
  };

  // ─── API Route: Delete Doc (called on Preview → Cancel) ───────────────────
  // The frontend should call this whenever the user cancels out of Preview
  // so the temporary Google Doc is cleaned up from Drive immediately.
  app.post('/api/delete-doc', async (req, res) => {
    try {
      const { docId } = req.body;
      if (!docId) return res.status(400).json({ error: 'docId is required' });

      console.log(`[Google Drive] Deleting doc on cancel: ${docId}`);
      await drive.files.delete({ fileId: docId });
      console.log(`[Google Drive] Successfully deleted doc: ${docId}`);
      res.json({ success: true });
    } catch (error: any) {
      // If file is already gone (404), treat as success — no need to surface an error
      if (error.code === 404) {
        console.warn(`[Google Drive] Doc ${req.body.docId} already deleted or not found.`);
        return res.json({ success: true, note: 'File was already deleted or not found.' });
      }
      console.error('[Google Drive] Error deleting doc:', error.message);
      res.status(500).json({ error: getGoogleErrorMessage(error) });
    }
  });

  // ─── API Route: Generate Proposal Doc ─────────────────────────────────────
  app.post('/api/generate-proposal', async (req, res) => {
    try {
      const {
        companyName,
        title,
        contactPerson,
        position,
        date,
        address,
        email,
        feeAmount,
        feeType,
        periodCover,        // general period cover (kept for backward compat)
        periodFrom,         // LOA: period start e.g. "January 1, 2024"
        periodTo,           // LOA: period end   e.g. "December 31, 2024"
        loaStartDate,
        loaEndDate,
        retainerFee,        // Group B: monthly retainer fee e.g. "Php 50,000.00/month"
        monthlyTaxRetainerFee,
        acceptanceFee,      // LOA: acceptance fee
        maxCap,             // LOA: max cap
        successFee,         // LOA: success fee
        timeBasedFee,       // LOA: time based fee
        afsProposalSuffix,
        yearEndYear,
        yearEndDate,
        feeTotal,
        afsFeeTable,
        engagementStart,    // Group B: e.g. "March 10, 2026"
        engagementEnd,      // Group B: e.g. "March 09, 2027"
        serviceDescription,
        selectedServices,   // string[] e.g. ["Tax Retainer", "Tax Compliance"]
        hourlyRates,        // { position: string, rate: number }[]
        templateName,
        customFileName,
      } = req.body;

      const combinedContactPerson = title ? `${title} ${contactPerson}` : contactPerson;

      console.log(`[Generate Proposal] Company: ${companyName} | Template: ${templateName}`);

      // ── Determine Hourly Rates Data ───────────────────────────────────────
      let finalHourlyRates = HOURLY_RATES;
      if (Array.isArray(hourlyRates) && hourlyRates.length > 0) {
        finalHourlyRates = hourlyRates.map(r => [
          r.position || '', 
          r.rate ? `Php ${Number(r.rate).toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : 'Php 0.00'
        ]);
      }

      // ── Validate credentials ───────────────────────────────────────────────
      if (!clientId || !clientSecret || !refreshToken) {
        return res.status(500).json({
          error: 'Google OAuth2 credentials are not fully configured. Please set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN in your .env file.',
        });
      }

      // ── Validate template ──────────────────────────────────────────────────
      const templateId = TEMPLATES[templateName];
      if (!templateId) {
        return res.status(400).json({
          error: `No template found for service type: "${templateName}". Please check your TEMPLATES map in server.ts.`,
        });
      }

      // ── Step 0.5: Resolve clean Proposal Type string ───────────────────────
      const services = Array.isArray(selectedServices) ? selectedServices : [];
      console.log(`[Generate Proposal] selectedServices received:`, JSON.stringify(services));
      console.log(`[Generate Proposal] templateName received: "${templateName}"`);
      const proposalType = resolveProposalType(services, templateName);
      console.log(`[Generate Proposal] Resolved proposalType: "${proposalType}"`);

      // ── Step 0.6: Resolve target Folder ID ─────────────────────────────────
      const folderId = resolveTargetFolderId(services);
      console.log(`[Google Drive] Copying template ${templateId} → folder ${folderId}`);

      // ── Determine Filename ────────────────────────────────────────────────
      let finalFileName = customFileName;
      if (!finalFileName) {
        const cleanCompany = (companyName || 'CLIENT').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const now = new Date();
        const dateStr = `${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}${now.getFullYear()}`;
        
        let serviceDetail = 'SERVICES';
        const has = (s: string) => services.some(srv => srv.includes(s));
        
        if (has('LOA Assistance')) {
          serviceDetail = 'LOA_ASSISTANCE';
        } else if (has('Audited Financial Statement')) {
          serviceDetail = 'AUDIT';
        } else if (has('Forensic Audit')) {
          serviceDetail = 'FRAUD_AUDIT';
        } else if (services.length === 1 && has('Tax Retainer')) {
          serviceDetail = 'TAX_FILING';
        } else if (services.some(s => s.includes('Tax Compliance') || s.includes('General Accounting'))) {
          serviceDetail = 'General Accounting Services and Tax Compliance';
        }
        
        finalFileName = `${cleanCompany}_${serviceDetail}_${dateStr}`;
      }

      // ── Step 1: Copy template into target Drive folder ────────────────────
      let finalDocId = '';
      try {
        const copyResponse = await drive.files.copy({
          fileId     : templateId,
          requestBody: {
            name   : finalFileName,
            parents: [folderId],
          },
        });
        finalDocId = copyResponse.data.id!;
        console.log(`[Google Drive] New doc created: ${finalDocId} in folder ${folderId}`);
      } catch (copyError: any) {
        console.error('[Google Drive] Error copying template:', copyError.message);
        if (copyError.code === 404) {
          return res.status(500).json({
            error: `Template Doc not found (ID: ${templateId}). Make sure the Google Doc exists and your Gmail account has access to it.`,
          });
        }
        if (copyError.code === 403) {
          return res.status(500).json({
            error: `Permission denied when copying template (ID: ${templateId}). Make sure your Gmail account has at least Viewer access to this Doc.`,
          });
        }
        throw copyError;
      }

      // ── Step 2: Build Group B dynamic sections ────────────────────────────
      const { taxRetainer, taxCompliance, generalAccounting } = buildGroupBSections(services);

      // ── Step 3: Replace all placeholder tokens ────────────────────────────
      const requests = [
        { replaceAllText: { containsText: { text: '{{PROPOSAL_TYPE}}',             matchCase: true }, replaceText: proposalType             } },
        { replaceAllText: { containsText: { text: '{{PROPOSAL_TYPE_SUFFIX}}',      matchCase: true }, replaceText: afsProposalSuffix        || '' } },
        { replaceAllText: { containsText: { text: '{{YEAR_END_YEAR}}',             matchCase: true }, replaceText: yearEndYear              || '' } },
        { replaceAllText: { containsText: { text: '{{YEAR_END_DATE}}',             matchCase: true }, replaceText: yearEndDate              || '' } },
        { replaceAllText: { containsText: { text: '{{COMPANY_NAME}}',              matchCase: true }, replaceText: companyName              || '' } },
        { replaceAllText: { containsText: { text: '{{CONTACT_PERSON}}',            matchCase: true }, replaceText: combinedContactPerson    || '' } },
        { replaceAllText: { containsText: { text: '{{POSITION}}',                  matchCase: true }, replaceText: position                 || '' } },
        { replaceAllText: { containsText: { text: '{{DATE}}',                      matchCase: true }, replaceText: date                     || '' } },
        { replaceAllText: { containsText: { text: '{{ADDRESS}}',                   matchCase: true }, replaceText: address                  || '' } },
        { replaceAllText: { containsText: { text: '{{EMAIL}}',                     matchCase: true }, replaceText: email                    || '' } },
        { replaceAllText: { containsText: { text: '{{FEE_AMOUNT}}',                matchCase: true }, replaceText: feeAmount ? (templateName === 'Forensic Audit' ? `Php ${Number(feeAmount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : feeAmount.toString()) : '' } },
        { replaceAllText: { containsText: { text: '{{FEE_TOTAL}}',                 matchCase: true }, replaceText: feeTotal != null ? formatCurrencyWithWordsUpper(Number(feeTotal)) : '' } },
        { replaceAllText: { containsText: { text: '{{FEE_TYPE}}',                  matchCase: true }, replaceText: feeType                  || '' } },
        { replaceAllText: { containsText: { text: '{{PERIOD_COVER}}',              matchCase: true }, replaceText: periodCover              || '' } },
        { replaceAllText: { containsText: { text: '{{PERIOD_FROM}}',               matchCase: true }, replaceText: periodFrom || loaStartDate || '' } },
        { replaceAllText: { containsText: { text: '{{PERIOD_TO}}',                 matchCase: true }, replaceText: periodTo   || loaEndDate   || '' } },
        { replaceAllText: { containsText: { text: '{{RETAINER_FEE}}',              matchCase: true }, replaceText: retainerFee || (monthlyTaxRetainerFee ? `Php ${Number(monthlyTaxRetainerFee).toLocaleString('en-PH', { minimumFractionDigits: 2 })}/month` : '') } },
        { replaceAllText: { containsText: { text: '{{MONTHLY_TAX_RETAINER_FEE}}',  matchCase: true }, replaceText: monthlyTaxRetainerFee ? Number(monthlyTaxRetainerFee).toLocaleString('en-PH', { minimumFractionDigits: 2 }) : '' } },
        { replaceAllText: { containsText: { text: '{{ACCEPTANCE_FEE}}',            matchCase: true }, replaceText: (acceptanceFee ?? 10000) != null ? (templateName === 'Tax Retainer' ? Number(acceptanceFee ?? 10000).toLocaleString('en-PH', { minimumFractionDigits: 2 }) : formatCurrencyWithWords(Number(acceptanceFee ?? 10000))) : '' } },
        { replaceAllText: { containsText: { text: '{{TIME_BASED_FEE}}',            matchCase: true }, replaceText: timeBasedFee  != null ? formatCurrencyWithWords(Number(timeBasedFee))  : '' } },
        { replaceAllText: { containsText: { text: '{{TIME_BASED FEE}}',             matchCase: true }, replaceText: timeBasedFee  != null ? formatCurrencyWithWords(Number(timeBasedFee))  : '' } },
        { replaceAllText: { containsText: { text: '{{MAX_CAP}}',                   matchCase: true }, replaceText: maxCap                   || '' } },
        { replaceAllText: { containsText: { text: '{{SUCCESS_FEE}}',               matchCase: true }, replaceText: successFee    != null ? formatCurrencyWithWords(Number(successFee))    : '' } },
        { replaceAllText: { containsText: { text: '{{ENGAGEMENT_START}}',          matchCase: true }, replaceText: engagementStart          || '' } },
        { replaceAllText: { containsText: { text: '{{ENGAGEMENT_END}}',            matchCase: true }, replaceText: engagementEnd            || '' } },
        { replaceAllText: { containsText: { text: '{{SERVICE_DESCRIPTION}}',       matchCase: true }, replaceText: serviceDescription       || '' } },
        // Group B dynamic phase sections
        { replaceAllText: { containsText: { text: '{{TAX_RETAINER_SECTION}}',      matchCase: true }, replaceText: taxRetainer                   } },
        { replaceAllText: { containsText: { text: '{{TAX_COMPLIANCE_SECTION}}',    matchCase: true }, replaceText: taxCompliance                 } },
        { replaceAllText: { containsText: { text: '{{GENERAL_ACCOUNTING_SECTION}}',matchCase: true }, replaceText: generalAccounting             } },
      ];

      try {
        await docs.documents.batchUpdate({
          documentId : finalDocId,
          requestBody: { requests },
        });
        console.log(`[Google Docs] Placeholders replaced in doc: ${finalDocId}`);
      } catch (docsError: any) {
        console.error('[Google Docs] Error replacing placeholders:', docsError.message);
        throw docsError;
      }

      // ── Step 4: Insert Tables (Hourly Rates and AFS Fee) ─────────────────
      try {
        const docData     = await docs.documents.get({ documentId: finalDocId });
        const bodyContent = docData.data.body?.content || [];
        const tables      = findTables(bodyContent);

        if (tables.length > 0) {
          // Identify AFS Fee Table if exists
          if (Array.isArray(afsFeeTable) && afsFeeTable.length > 0) {
            const afsData = afsFeeTable.map(r => [
              String(r.fee || ''),
              String(r.description || ''),
              `₱${Number(r.amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
            ]);

            // Assume AFS table is one that has "Fee" or "Description" in header
            let afsTableIndex = -1;
            for (let i = 0; i < tables.length; i++) {
              const headerText = tables[i].table.tableRows?.[0]?.tableCells?.map((c: any) => c.content?.[0]?.paragraph?.elements?.map((e: any) => e.textRun?.content).join('')).join(' ') || '';
              if (headerText.toLowerCase().includes('fee') && headerText.toLowerCase().includes('description')) {
                afsTableIndex = i;
                break;
              }
            }

            if (afsTableIndex !== -1) {
              await insertAndFillTableRows(
                finalDocId,
                tables[afsTableIndex].startIndex,
                afsData,
                0,
              );
            }
          }

          // ONLY insert hourly rates if NOT Audited Financial Statement
          if (templateName !== 'Audited Financial Statement') {
            // Refresh tables after AFS insertion
            const docDataFresh = await docs.documents.get({ documentId: finalDocId });
            const bodyContentFresh = docDataFresh.data.body?.content || [];
            const tablesFresh = findTables(bodyContentFresh);

            // Find the table that likely contains hourly rates
            let ratesTable = tablesFresh[tablesFresh.length - 1]; 
            for (const t of tablesFresh) {
              const firstRowText = t.table.tableRows?.[0]?.tableCells?.map((c: any) => c.content?.[0]?.paragraph?.elements?.map((e: any) => e.textRun?.content).join('')).join(' ') || '';
              if (firstRowText.toLowerCase().includes('rate') || firstRowText.toLowerCase().includes('position') || firstRowText.toLowerCase().includes('role')) {
                ratesTable = t;
                break;
              }
            }

            if (ratesTable) {
              await insertAndFillTableRows(
                finalDocId,
                ratesTable.startIndex,
                finalHourlyRates,
                0, // insert below row 0
              );
            }
          }
        }
      } catch (tableError: any) {
        console.error('[Table] Error inserting tables:', tableError.message);
      }

      // ── Step 5: Signature Formatting & Rule ───────────────────────────────
      // Rule: "Sincerely yours," and "ATTY. CHRIS C. TAMESIS" should be on the same page.
      // We use paragraphStyle property 'keepWithNext' to achieve this reliably.
      try {
        const docData = await docs.documents.get({ documentId: finalDocId });
        const content = docData.data.body?.content || [];
        const updateRequests: any[] = [];

        let signatureIndex = -1;
        let lastInBlockIndex = -1;

        content.forEach((el: any) => {
          if (el.paragraph) {
            const text = el.paragraph.elements?.map((e: any) => e.textRun?.content).join('') || '';
            if (text.includes('Sincerely yours,')) {
              signatureIndex = el.startIndex;
            }
            if (text.includes('ATTY. CHRIS C. TAMESIS') || text.includes('Date Signed:')) {
              lastInBlockIndex = el.endIndex;
            }
          }
        });

        if (signatureIndex !== -1 && lastInBlockIndex !== -1) {
          // Rule: Ensure "Sincerely yours" and the entire following block stay together.
          
          let blockParagraphs: any[] = [];
          content.forEach((el: any) => {
            if (el.paragraph && el.startIndex >= signatureIndex && el.startIndex < lastInBlockIndex) {
              blockParagraphs.push(el);
            }
          });

          blockParagraphs.forEach((el, idx) => {
            const isLast = idx === blockParagraphs.length - 1;
            updateRequests.push({
              updateParagraphStyle: {
                range: { startIndex: el.startIndex, endIndex: el.endIndex },
                paragraphStyle: {
                  keepWithNext: !isLast,
                  keepLinesTogether: true,
                  spaceAbove: { magnitude: 0, unit: 'PT' },
                  spaceBelow: { magnitude: 0, unit: 'PT' }
                },
                fields: 'keepWithNext,keepLinesTogether,spaceAbove,spaceBelow'
              }
            });
          });

          // Check if it's at the top of a page to potentially add spacing (removed as requested)
          /*
          let isAtTop = false;
          for (let i = 0; i < content.length; i++) {
            if (content[i].startIndex === signatureIndex) {
              const prev = content[i-1];
              if (!prev || prev.sectionBreak || prev.paragraph?.elements?.some((e: any) => e.pageBreak)) {
                isAtTop = true;
              }
              break;
            }
          }

          if (isAtTop) {
            updateRequests.push({ 
              insertText: { 
                location: { index: signatureIndex }, 
                text: '\n\n\n\n' 
              } 
            });
          } else {
            updateRequests.push({ 
              insertText: { 
                location: { index: signatureIndex }, 
                text: '\n\n' 
              } 
            });
          }
          */
        }

        if (updateRequests.length > 0) {
          await docs.documents.batchUpdate({
            documentId: finalDocId,
            requestBody: { requests: updateRequests }
          });
          console.log(`[Google Docs] Signature formatting rules applied to ${updateRequests.length} paragraphs.`);
        }
      } catch (formatError: any) {
        console.error('[Google Docs] Error applying signature formatting:', formatError.message);
      }

      // ── Step 6: Make doc viewable/editable for iframe embed ───────────────
      try {
        await drive.permissions.create({
          fileId     : finalDocId,
          requestBody: { role: 'writer', type: 'anyone' },
        });
        console.log(`[Google Drive] Public write permission set on doc: ${finalDocId}`);
      } catch (permError: any) {
        console.error('[Google Drive] Error setting permissions:', permError.message);
        throw permError;
      }

      // ── Success ────────────────────────────────────────────────────────────
      res.json({
        success: true,
        docId  : finalDocId,
        docUrl : `https://docs.google.com/document/d/${finalDocId}/edit`,
      });

    } catch (error: any) {
      console.error('[Error] generate-proposal failed:', error.message);
      res.status(500).json({
        error: getGoogleErrorMessage(error),
      });
    }
  });

  // ─── API Route: Send Email with PDF Attachment (via Gmail API) ────────────────
  app.post('/api/send-email', async (req, res) => {
    try {
      const { 
        to, 
        cc, 
        subject, 
        message, 
        docId, 
        proposalId,
        senderEmail
      } = req.body;

      const gmail = google.gmail({ version: 'v1', auth });
      let recipientEmail = to;

      // If 'to' is missing, fallback to the authenticated user's own email.
      if (!recipientEmail) {
        try {
          console.log('[Email] Recipient address ("to") missing. Fetching authenticated user profile...');
          const profile = await gmail.users.getProfile({ userId: 'me' });
          recipientEmail = profile.data.emailAddress;
          console.log(`[Email] Defaulting recipient to authenticated user: ${recipientEmail}`);
        } catch (profileError: any) {
          console.warn('[Email] Failed to fetch user profile for fallback recipient:', profileError.message);
        }
      }

      console.log(`[Email] Received request to send email to: ${recipientEmail}, CC: ${cc}, Subject: ${subject}`);
      console.log(`[Email] docId: ${docId}, proposalId: ${proposalId}, senderEmail: ${senderEmail}`);

      if (!recipientEmail || !subject || !message || !docId) {
        console.warn('[Email] Missing required fields (to/recipientEmail, subject, message, or docId)');
        return res.status(400).json({ error: 'Recipient address (to), subject, message, and docId are required.' });
      }

      console.log(`[Email] Initiating Gmail send for proposal ${proposalId} to ${recipientEmail} (Sender: ${senderEmail})`);

      // 1. Export Google Doc as PDF
      let pdfBuffer;
      let actualFileName = 'proposal.pdf';
      try {
        console.log(`[Email] Ensuring fresh access token for export...`);
        await auth.getAccessToken();

        console.log(`[Google Drive] Exporting doc ${docId} to PDF...`);
        
        // Fetch the file name so the attachment has a nice name
        try {
          const fileMeta = await drive.files.get({ fileId: docId, fields: 'name' });
          if (fileMeta.data.name) {
            actualFileName = fileMeta.data.name.endsWith('.pdf') 
              ? fileMeta.data.name 
              : `${fileMeta.data.name}.pdf`;
          }
          console.log(`[Google Drive] Resolved attachment filename: ${actualFileName}`);
        } catch (nameError: any) {
          console.warn(`[Google Drive] Could not fetch file name, defaulting to proposal.pdf: ${nameError.message}`);
        }

        const driveExport = await drive.files.export({
          fileId: docId,
          mimeType: 'application/pdf',
        }, { responseType: 'arraybuffer' });
        
        pdfBuffer = Buffer.from(driveExport.data as any);
        console.log(`[Google Drive] PDF export successful. Size: ${pdfBuffer.length} bytes`);
      } catch (exportError: any) {
        console.error('[Google Drive] Error exporting doc to PDF:', exportError.message);
        if (exportError.response) {
          console.error('[Google Drive] Export Error Response Data:', JSON.stringify(exportError.response.data));
          console.error('[Google Drive] Export Error Status:', exportError.response.status);
        }
        
        const isForbidden = exportError.status === 403 || exportError.response?.status === 403;
        if (isForbidden) {
          console.error('[Google Drive] 403 Forbidden - Insufficient Scopes detected.');
          return res.status(403).json({ 
            error: 'Google Drive Access Denied (403).',
            details: 'Your token does not have permission to export files. You MUST re-authorize and check the boxes for Google Drive access.',
            action: 'Visit /api/debug/auth-url to get a new token.'
          });
        }
        
        return res.status(500).json({ error: `Failed to export document to PDF: ${exportError.message}` });
      }

      // 2. Construct MIME Message
      const boundary = 'foo_bar_baz';
      const nl = '\r\n';
      
      const headers = [
        senderEmail && senderEmail.includes('@') ? `From: ${senderEmail}` : null,
        `To: ${recipientEmail}`,
        cc ? `Cc: ${cc}` : null,
        `Subject: ${subject}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/mixed; boundary="${boundary}"`
      ].filter(Boolean);

      const str = [
        ...headers,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: 7bit',
        '',
        message,
        '',
        `--${boundary}`,
        'Content-Type: application/pdf',
        `Content-Disposition: attachment; filename="${actualFileName}"`,
        'Content-Transfer-Encoding: base64',
        '',
        pdfBuffer.toString('base64'),
        '',
        `--${boundary}--`
      ].join(nl);

      const encodedMessage = Buffer.from(str)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      // 3. Send Email via Gmail API
      await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedMessage,
        },
      });

      console.log(`[Email] Successfully sent to ${to} via Gmail API`);
      res.json({ success: true });

    } catch (error: any) {
      console.error('[Email] Failed:', error.message);
      
      const isScopeError = error.message?.toLowerCase().includes('insufficient authentication scopes') || 
                          error.message?.toLowerCase().includes('insufficient permissions');
      
      if (isScopeError) {
        return res.status(403).json({ 
          error: 'Gmail API scope missing. Your GOOGLE_REFRESH_TOKEN must be authorized with: https://www.googleapis.com/auth/gmail.send AND https://www.googleapis.com/auth/drive' 
        });
      }
      
      res.status(500).json({ error: getGoogleErrorMessage(error) });
    }
  });

  // ─── Vite Dev / Production Middleware ─────────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server : { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (!process.env.VERCEL) {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // ─── Global Error Handler ────────────────────────────────────────────────
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('❌ [Unhandled Error]', err);
    res.status(500).json({ 
      error: err.message || 'Internal Server Error',
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  });

  if (!process.env.VERCEL) {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`✅ Server running on http://localhost:${PORT}`);
    });
  }

  return app;
}

if (!process.env.VERCEL) {
  startServer().catch(err => {
    console.error("Failed to start server:", err);
  });
}