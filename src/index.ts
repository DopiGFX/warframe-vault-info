
import { DOMParser, Element } from "@b-fuze/deno-dom";
import { encodeHex } from "@std/encoding/hex";
import Items from "@wfcd/items";
import { PrimeVaultInfoEntry } from "./types.ts";

const wikiaVaultURL = "https://wiki.warframe.com/w/Prime_Vault";
const wikiaVaultPage = await fetch(wikiaVaultURL).then((res) => res.text());
const wikiaVaultHash = encodeHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(wikiaVaultPage)));
const oldHash = JSON.parse(Deno.readTextFileSync("data/hash.json")).hash;
console.info("[prime-vault parser] Downloaded Prime Vault page.", { url: wikiaVaultURL, hash: wikiaVaultHash });
if (wikiaVaultHash === oldHash) {
  console.info("[prime-vault parser] Wikia vault page has not changed since the last run. No need to update the vault state.");
  Deno.exit(0);
}
const wikiaVaultDocument = new DOMParser().parseFromString(wikiaVaultPage, "text/html");

// Scince data attributes are generated dynamically, we cannot rely on them to find the tables containing vaulted items.
const [vaultedItems, formerlyVaulted, notYetVaulted, neverVaulted] = wikiaVaultDocument?.querySelectorAll('#mw-customcollapsible-vaulted > div > div > table');
if (!vaultedItems || !formerlyVaulted || !notYetVaulted || !neverVaulted) {
  throw new Error("Could not find the tables containing vaulted items.");
}

const unmappedEntries: Omit<PrimeVaultInfoEntry, "uniqueName">[] = [];

type TableCategory = "vaulted" | "formerly vaulted" | "not yet vaulted" | "never vaulted";

function summarizeCellText(text: string | null | undefined) {
  return text?.replace(/\s+/g, " ").trim() || "<empty>";
}

function failUnparsableRow(category: TableCategory, reason: string, row: Element): never {
  const rowText = summarizeCellText(row.textContent);
  const rowHtml = summarizeCellText(row.outerHTML);
  console.error(`[prime-vault parser] Failed to parse ${category} row: ${reason}.`, { text: rowText, html: rowHtml });
  throw new Error(`Failed to parse ${category} row: ${reason}.`);
}

function extractItemName(row: Element, category: TableCategory) {
  // For some reason, the first row of each table contains the column headers
  if (row.querySelector("th")) {
    return;
  }

  const firstCell = row.querySelector("td:first-child");
  if (!firstCell) {
    failUnparsableRow(category, "missing first cell", row);
  }

  // The first <a> is usually just the item's icon image and has no text, so it can't be used as-is.
  const linkNames = Array.from(firstCell.querySelectorAll("a")).map((a) => a.textContent?.trim()).filter((text) => !!text);
  // The wiki uses &nbsp; between words, which must be normalized to a regular space to match the items database.
  const name = (linkNames[0]
    ?? firstCell.querySelector("span[data-param-name]")?.getAttribute("data-param-name")?.trim()
    ?? firstCell.textContent?.trim()
    ?? "").replace(/\s+/g, " ");

  if (!name) {
    failUnparsableRow(category, "missing item name", row);
  }

  return name;
}

function extractVaultedItems(row: Element, category: TableCategory) {
  const name = extractItemName(row, category);
  if (!name) {
    return;
  }

  const vaultDate = row.querySelector("td:nth-child(2)")?.textContent?.trim();
  if (!vaultDate) {
    failUnparsableRow(category, `missing vault date for ${name}`, row);
  }

  unmappedEntries.push({ name, vaulted: true, vaultDate });
}

function extractNotVaultedItems(row: Element, category: TableCategory) {
  const name = extractItemName(row, category);
  if (!name) {
    return;
  }

  unmappedEntries.push({ name, vaulted: false });
}

// We want this items to be listed as vaulted, but they are not listed on the wiki page
unmappedEntries.push({ name: "Excalibur Prime", vaulted: true });
unmappedEntries.push({ name: "Lato Prime", vaulted: true });
unmappedEntries.push({ name: "Skana Prime", vaulted: true });

vaultedItems.querySelectorAll("tbody > tr").forEach((row) => extractVaultedItems(row, "vaulted"));
formerlyVaulted.querySelectorAll("tbody > tr").forEach((row) => extractVaultedItems(row, "formerly vaulted"));
notYetVaulted.querySelectorAll("tbody > tr").forEach((row) => extractNotVaultedItems(row, "not yet vaulted"));
neverVaulted.querySelectorAll("tbody > tr").forEach((row) => extractNotVaultedItems(row, "never vaulted"));
console.info("[prime-vault parser] Parsed vault rows.", {
  vaulted: vaultedItems.querySelectorAll("tbody > tr").length,
  formerlyVaulted: formerlyVaulted.querySelectorAll("tbody > tr").length,
  notYetVaulted: notYetVaulted.querySelectorAll("tbody > tr").length,
  neverVaulted: neverVaulted.querySelectorAll("tbody > tr").length,
  parsedEntries: unmappedEntries.length,
});

const primes = new Items().filter(a => a.name.includes("Prime"));
const primesByName = new Map(primes.map((item) => [item.name, item]));
const missingEntries = unmappedEntries.filter((entry) => !primesByName.has(entry.name));
if (missingEntries.length > 0) {
  console.error("[prime-vault parser] Failed to map parsed names to wfcd/items Prime inventory.", {
    totalParsed: unmappedEntries.length,
    totalPrimesInDatabase: primes.length,
    missingNames: missingEntries.map((entry) => entry.name),
  });
  throw new Error(`Could not map ${missingEntries.length} parsed item(s) to the items database.`);
}
const mappedEntries: PrimeVaultInfoEntry[] = unmappedEntries.map((entry) => {
  const item = primesByName.get(entry.name)!;
  return { uniqueName: item.uniqueName, ...entry };
});

Deno.writeTextFile("data/hash.json", JSON.stringify({ hash: encodeHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(wikiaVaultPage))) }));
Deno.writeTextFile("data/vaultstate.json", JSON.stringify(mappedEntries));
