/**
 * Generate a QR code for depositing USDC on Base.
 *
 * Encodes the plain 0x address for maximum wallet compatibility.
 * EIP-681 URIs are not reliably supported by Rabby, Rainbow, etc.
 */

import QRCode from "qrcode";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "../store/paths.js";

/**
 * Generate a QR code as a base64-encoded PNG.
 * Returns the raw base64 string (without the data:image/png;base64, prefix).
 */
export async function generateDepositQrBase64(recipientAddress: string): Promise<string> {
  const dataUrl = await QRCode.toDataURL(recipientAddress, {
    width: 256,
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
  });
  return dataUrl.replace(/^data:image\/png;base64,/, "");
}

/**
 * Generate a terminal-friendly UTF-8 QR code string.
 */
export async function generateDepositQrText(recipientAddress: string): Promise<string> {
  return QRCode.toString(recipientAddress, { type: "utf8" });
}

/**
 * Save a QR code PNG to ~/.x402-wallet/deposit-qr.png.
 * Returns the file path.
 */
export async function saveDepositQrFile(recipientAddress: string): Promise<string> {
  const buffer = await QRCode.toBuffer(recipientAddress, {
    width: 512,
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
  });
  const filePath = join(getDataDir(), "deposit-qr.png");
  writeFileSync(filePath, buffer);
  return filePath;
}
