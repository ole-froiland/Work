import test from "node:test";
import assert from "node:assert/strict";

import { chooseLayout, MOBILE_MAX_EDGE, PANEL_LAYOUT_KEY } from "../src/dashboard.js";

function fakeStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

const iPhone = { width: 393, height: 852, coarse: true };
const iPadPortrett = { width: 768, height: 1024, coarse: true };
const iPadLandskap = { width: 1024, height: 768, coarse: true };

test("telefonen får mobilvisningen, iPad-en beholder panelet", () => {
  assert.equal(chooseLayout({ viewport: iPhone }), "mobil");
  assert.equal(chooseLayout({ viewport: iPadPortrett }), "ipad");
  assert.equal(chooseLayout({ viewport: iPadLandskap }), "ipad");
});

// Bredden alene sier ingenting om hva slags enhet man sitter med. Et panel som
// bytter utseende av at Mac-vinduet dras smalere, er et panel som gjetter.
test("et smalt vindu på Mac-en er ikke en telefon", () => {
  assert.equal(chooseLayout({ viewport: { width: 380, height: 900, coarse: false } }), "ipad");
});

test("grensen ligger der den er satt, ikke ett hakk over", () => {
  assert.equal(chooseLayout({ viewport: { width: MOBILE_MAX_EDGE, height: 900, coarse: true } }), "mobil");
  assert.equal(chooseLayout({ viewport: { width: MOBILE_MAX_EDGE + 1, height: 900, coarse: true } }), "ipad");
});

test("?layout= vinner over skjermen og huskes til neste gang", () => {
  const storage = fakeStorage();
  assert.equal(chooseLayout({ location: { search: "?layout=mobil" }, storage, viewport: iPadLandskap }), "mobil");
  assert.equal(storage.getItem(PANEL_LAYOUT_KEY), "mobil");
  // Uten adresselinja skal det huskede valget fortsatt gjelde.
  assert.equal(chooseLayout({ location: { search: "" }, storage, viewport: iPadLandskap }), "mobil");
});

test("?layout=ipad tar telefonen tilbake til panelet", () => {
  const storage = fakeStorage({ [PANEL_LAYOUT_KEY]: "mobil" });
  assert.equal(chooseLayout({ location: { search: "?layout=ipad" }, storage, viewport: iPhone }), "ipad");
  assert.equal(chooseLayout({ location: { search: "" }, storage, viewport: iPhone }), "ipad");
});

test("ukjent layout-verdi overstyrer ingenting", () => {
  assert.equal(chooseLayout({ location: { search: "?layout=tv" }, viewport: iPhone }), "mobil");
  assert.equal(chooseLayout({ storage: fakeStorage({ [PANEL_LAYOUT_KEY]: "tv" }), viewport: iPhone }), "mobil");
});

// Privat vindu: lagringen kaster i stedet for å svare. Valget skal fortsatt
// gjelde for dette besøket i stedet for å ta ned panelet.
test("blokkert lagring stopper ikke valget", () => {
  const blokkert = {
    getItem() { throw new Error("blokkert"); },
    setItem() { throw new Error("blokkert"); },
  };
  assert.equal(chooseLayout({ location: { search: "?layout=mobil" }, storage: blokkert, viewport: iPadLandskap }), "mobil");
  assert.equal(chooseLayout({ location: { search: "" }, storage: blokkert, viewport: iPhone }), "mobil");
});
