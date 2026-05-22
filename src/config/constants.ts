
//
// File: constants.ts
// Author: Quinn Harvey Pineda
// Date: 2026-05-19
// Purpose: Global constants and configuration for Google Drive integration.
//

export const GDRIVE_FOLDERS = {
  LOA_ASSISTANCE: 'https://drive.google.com/drive/u/0/folders/1Cq0CkJySLdwURDwNBOBnuTR8ilG2B1R3',
  FORENSIC_AUDIT: 'https://drive.google.com/drive/u/0/folders/1FD0FSL7lyvfJ0fbaA0SQzzYb3THp-GOG',
  AUDITED_FINANCIAL_STATEMENT: 'https://drive.google.com/drive/u/0/folders/1BVww4NTszshD77khR3cjXw6TwOChhn4Q',
  TAX_RETAINER: 'https://drive.google.com/drive/u/0/folders/1qk1R77SeRMnQDJm3iBQMVK17PWzSDSHg',
  TAX_RETAINER_COMBO: 'https://drive.google.com/drive/u/0/folders/1OweT2K7gtt4QMLZLmiZ444Z83y3e6_fU'
};

export const SERVICES = {
  LOA: 'LOA Assistance',
  AFS: 'Audited Financial Statement',
  FORENSIC: 'Forensic Audit',
  TAX_RETAINER: 'Tax Retainer (Phase 1)',
  TAX_COMPLIANCE: 'Tax Compliance (Phase 2)',
  TAX_ACCOUNTING: 'General Accounting Services (Phase 3)'
};

export interface GDriveFolder {
  name: string;
  url: string;
}

export function getGDriveFolders(services: string[] = []): GDriveFolder[] {
  if (!services || !Array.isArray(services)) return [];
  
  const folders: GDriveFolder[] = [];
  const has = (s: string) => services.includes(s);
  
  // 1. Group A - Highest specificity, usually single choice
  if (has(SERVICES.LOA)) {
    folders.push({ name: 'LOA Assistance', url: GDRIVE_FOLDERS.LOA_ASSISTANCE });
  }
  
  if (has(SERVICES.FORENSIC)) {
    folders.push({ name: 'Forensic Audit', url: GDRIVE_FOLDERS.FORENSIC_AUDIT });
  }
  
  if (has(SERVICES.AFS)) {
    folders.push({ name: 'Audited Financial Statement', url: GDRIVE_FOLDERS.AUDITED_FINANCIAL_STATEMENT });
  }

  // 2. Group B - Tax Services
  const hasRetainer = has(SERVICES.TAX_RETAINER);
  const hasCompliance = has(SERVICES.TAX_COMPLIANCE);
  const hasAccounting = has(SERVICES.TAX_ACCOUNTING);

  if (hasRetainer && hasCompliance && hasAccounting) {
    // Exact match for the "Trio" request
    folders.push({ name: 'Tax Combo', url: GDRIVE_FOLDERS.TAX_RETAINER_COMBO });
  } else if (hasRetainer && !hasCompliance && !hasAccounting) {
    // Only Retainer
    folders.push({ name: 'Tax Retainer', url: GDRIVE_FOLDERS.TAX_RETAINER });
  } else if (hasRetainer || hasCompliance || hasAccounting) {
    // Any other mix of Group B
    folders.push({ name: 'Tax Services', url: GDRIVE_FOLDERS.TAX_RETAINER_COMBO });
  }
  
  return folders;
}

export function getGDriveFolderUrl(services: string[] = []): string | null {
  const folders = getGDriveFolders(services);
  if (folders.length === 0) return null;
  
  // Priority: Specific Group A items FIRST, then Combo, then single Retainer
  const loa = folders.find(f => f.url === GDRIVE_FOLDERS.LOA_ASSISTANCE);
  if (loa) return loa.url;

  const forensic = folders.find(f => f.url === GDRIVE_FOLDERS.FORENSIC_AUDIT);
  if (forensic) return forensic.url;

  const afs = folders.find(f => f.url === GDRIVE_FOLDERS.AUDITED_FINANCIAL_STATEMENT);
  if (afs) return afs.url;

  const trio = folders.find(f => f.url === GDRIVE_FOLDERS.TAX_RETAINER_COMBO);
  if (trio) return trio.url;

  return folders[0].url;
}
