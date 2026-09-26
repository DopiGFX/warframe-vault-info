
import { DOMParser, Element } from "@b-fuze/deno-dom";
import { encodeHex } from "@std/encoding/hex";
import Items from "@wfcd/items";
import { PrimeVaultInfoEntry } from "./types.ts";

const wikiaVaultURL = "https://wiki.warframe.com/w/Prime_Vault";
const wikiaVaultPage = await fetch(wikiaVaultURL).then((res) => res.text());
const wikiaVaultHash = encodeHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(wikiaVaultPage)));
const oldHash = JSON.parse(Deno.readTextFileSync("data/hash.json")).hash;
if (wikiaVaultHash === oldHash) {
  console.log("Wikia vault page has not changed since the last run. No need to update the vault state.");
  Deno.exit(0);
}
const wikiaVaultDocument = new DOMParser().parseFromString(wikiaVaultPage, "text/html");

// Scince data attributes are generated dynamically, we cannot rely on them to find the tables containing vaulted items.
const [vaultedItems, formerlyVaulted, notYetVaulted, neverVaulted] = wikiaVaultDocument?.querySelectorAll('#mw-customcollapsible-vaulted > div > div > table');
if (!vaultedItems || !formerlyVaulted || !notYetVaulted || !neverVaulted) {
  throw new Error("Could not find the tables containing vaulted items.");
}

function extractVaultedItems(row: Element) {
  // For some reason, the first row of each table contains the column headers
  if (row.querySelector("th")) {
    return;
  }
  const name = row.querySelector("td:nth-child(1) > span")?.getAttribute("data-param-name") ?? row.querySelector("td:nth-child(1) > a")?.textContent?.trim();
  const vaultDate = row.querySelector("td:nth-child(2)")?.textContent?.trim() ?? "";
  if (!name || !vaultDate) {
    throw new Error("Could not extract name or vault date for a vaulted item.");
  }
  unmappedEntries.push({ name, vaulted: true, vaultDate });
}

function extractNotVaultedItems(row: Element) {
  // For some reason, the first row of each table contains the column headers
  if (row.querySelector("th")) {
    return;
  }
  const name = row.querySelector("td:nth-child(1) > span")?.getAttribute("data-param-name") ?? row.querySelector("td:nth-child(1) > a")?.textContent?.trim();
  if (!name) {
    throw new Error("Could not extract name for a not yet vaulted item.");
  }
  unmappedEntries.push({ name, vaulted: false });
}

const unmappedEntries: Omit<PrimeVaultInfoEntry, "uniqueName">[] = [];

// We want this items to be listed as vaulted, but they are not listed on the wiki page
unmappedEntries.push({ name: "Excalibur Prime", vaulted: true });
unmappedEntries.push({ name: "Lato Prime", vaulted: true });
unmappedEntries.push({ name: "Skana Prime", vaulted: true });

vaultedItems.querySelectorAll("tbody > tr").forEach(extractVaultedItems);
formerlyVaulted.querySelectorAll("tbody > tr").forEach(extractVaultedItems);
notYetVaulted.querySelectorAll("tbody > tr").forEach(extractNotVaultedItems);
neverVaulted.querySelectorAll("tbody > tr").forEach(extractNotVaultedItems);

const primes = new Items().filter(a => a.name.includes("Prime"));

const mappedEntries: PrimeVaultInfoEntry[] = unmappedEntries.map((entry) => {
  const item = primes.find((item) => item.name === entry.name);
  if (!item) {
    throw new Error(`Could not find item with name ${entry.name} in the items database.`);
  }
  return { uniqueName: item.uniqueName, ...entry };
});

Deno.writeTextFile("data/hash.json", JSON.stringify({ hash: encodeHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(wikiaVaultPage))) }));
Deno.writeTextFile("data/vaultstate.json", JSON.stringify(mappedEntries));