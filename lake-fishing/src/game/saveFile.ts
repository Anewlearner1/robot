import { exportSaveJson } from "../services";
import type { GameSave } from "../services";
import { exportFileName } from "./format";

export interface ExportOutcome {
  downloaded: boolean;
  copied: boolean;
}

/** Download the save as a .json file and also copy the text to the clipboard (each may fail). */
export async function exportSave(save: GameSave, now = new Date()): Promise<ExportOutcome> {
  const text = exportSaveJson(save);
  let downloaded = false;
  try {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = exportFileName(now);
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    downloaded = true;
  } catch {
    downloaded = false;
  }
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    copied = false;
  }
  return { downloaded, copied };
}

/** Read an imported file as text (the services validate it). */
export function readFileText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("讀取檔案失敗"));
    reader.readAsText(file);
  });
}

/** The raw text of a corrupt-save backup (`localStorage[backupKey]`), or null when it cannot be read. */
export function readBackupText(backupKey: string | null): string | null {
  if (!backupKey) return null;
  try {
    return localStorage.getItem(backupKey);
  } catch {
    return null;
  }
}

/** Copy text to the clipboard; resolves false (never throws) when the browser refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
