/**
 * The theme bootstrap string.
 *
 * It runs BEFORE first paint, which is the only reason there is no flash of the
 * wrong theme. It is inlined into index.html by hand rather than injected at
 * build time, because an inline script that changes on every build defeats a
 * CSP hash.
 *
 * tools/themes/check.ts fails if this string and the one in index.html drift
 * apart, and also fails if it disagrees with THEME_BOOTSTRAP in lib/themes.ts.
 */
export const THEME_BOOTSTRAP =
  `(function(){try{var k="milo.theme";var s=localStorage.getItem(k);` +
  `var m={"spartan-night":1,"hellas-marble":0,"milo-dark":1,"milo-light":0,"ion-purple":1,"halo-ring":1,"forge-red":1};` +
  `var id=s&&m[s]!==undefined?s:null;` +
  `if(!id){id=window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches?"hellas-marble":"spartan-night"}` +
  `var r=document.documentElement;r.setAttribute("data-theme",id);r.classList.toggle("dark",m[id]===1);` +
  `r.style.colorScheme=m[id]===1?"dark":"light"}catch(e){` +
  `document.documentElement.setAttribute("data-theme","spartan-night");document.documentElement.classList.add("dark")}})();`;
