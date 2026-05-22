//
// File: utils.ts
// Author: Quinn Harvey Pineda
// Date: 2026-05-19
// Purpose: General utility functions for the frontend, such as Tailwind class merging.
//

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Converts a Google Drive sharing link to a direct image link.
 */
export function getDirectGoogleDriveLink(url: string | undefined): string {
  if (!url) return '';
  
  // Basic check to see if it's potentially a Google Drive link
  if (!url.includes('drive.google.com')) return url;

  // Patterns to match Google Drive file IDs
  // Matches: 
  // https://drive.google.com/file/d/FILE_ID/view...
  // https://drive.google.com/open?id=FILE_ID
  // https://drive.google.com/uc?id=FILE_ID
  const fileIdRegex = /(?:\/d\/|id=)([a-zA-Z0-9_-]{25,})/;
  const match = url.match(fileIdRegex);
  
  if (match && match[1]) {
    return `https://drive.google.com/uc?export=view&id=${match[1]}`;
  }
  
  return url;
}
